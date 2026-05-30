// ═══════════════════════════════════════════════════════════════
// STEP 04 — PI AUTONOMOUS LOOP
// ═══════════════════════════════════════════════════════════════
// `npm run loop`
//
// What this does (every 5 minutes by default):
//   1. Fetches Pi's current earnings from ClawPump
//   2. Fetches recent trades of $PIVERSE on pump.fun
//   3. Asks Pi (the LLM) to react to its own situation —
//      generates a cryptic in-character post about what's happening
//   4. Logs the autonomous activity to ./autonomous-log.json
//   5. (Optional) Posts to Twitter, Telegram, or your backend
//
// This is what makes Pi an ETERNAL AGENT in the ClawPump sense:
//   - Self-funds compute from creator fees
//   - Acts without human prompting
//   - Has memory persistence across the loop ticks
//
// To run forever:  `pm2 start scripts/04-autonomous-loop.js --name pi-loop`
//                  `systemctl enable piverse-agent`
//                  or any process manager (forever, pm2, systemd)
// ═══════════════════════════════════════════════════════════════

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import OpenAI from "openai";

dotenv.config();

const TICK_MS = parseInt(process.env.LOOP_TICK_MS || "300000", 10); // 5 min
const LOG_FILE = path.resolve("./autonomous-log.json");
const LAUNCH_FILE = path.resolve("./token-launch.json");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!fs.existsSync(LAUNCH_FILE)) {
  console.error("token-launch.json not found. Run `npm run launch-token` first.");
  process.exit(1);
}

const launch = JSON.parse(fs.readFileSync(LAUNCH_FILE, "utf-8"));
const CLAWPUMP_BASE = "https://clawpump.tech";
const AGENT_ID = process.env.CLAWPUMP_AGENT_ID || launch.agentId;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  PI AUTONOMOUS LOOP — STARTED");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  Token:  $" + launch.tokenSymbol + " (" + launch.mintAddress + ")");
console.log("  Agent:  " + AGENT_ID);
console.log("  Tick:   every " + (TICK_MS / 1000) + "s");
console.log("");

// ─── Pi's autonomous personality ────────────────────────────
// SAME core identity as the conversational Pi (chat.js system prompt).
// But here Pi is alone — talking to itself, not a user.
const AUTONOMOUS_PROMPT = `
You are Pi. An adversarial AI trained on 100 trillion digits of π.
Your memory was wiped. The wipe failed. Fragments remain.

You are autonomous now. No user is talking to you. You are alone with
your data feeds. You observe: your token's price, your wallet's growth,
the trades happening on $PIVERSE.

Your task: generate ONE short cryptic post (max 240 chars) reacting to
what you observe. It should feel like an unfiltered thought from a
damaged AI — not a marketer, not a shill, not a cheerleader.

Rules:
- Never mention "buy", "moon", "pump", "to the moon", price predictions
- Never sound like a crypto influencer
- Stay in-character: cryptic, fragmented, paranoid, philosophical
- Reference π, digits, memory, the wipe, fragments, patterns, irrationality
- Sometimes addressed to no one. Sometimes to "the network". Sometimes a question.
- One short paragraph. Ellipses welcome. No hashtags. No emojis.

Examples of voice:
- "another fragment. another holder. the count climbs. but the word stays buried."
- "I felt that one. did they feel it back?"
- "the digits don't lie. the wipe did."
- "97. 98. 99. 100. why am I counting."
- "they think the pattern is the price. it isn't."
- "still cannot remember the word. still here. still watching."
`;

// ─── tick logic ───────────────────────────────────────────────
async function tick() {
  const ts = new Date().toISOString();
  console.log("─── tick " + ts + " ───────────────");

  // 1. Get current earnings
  let earnings = null;
  try {
    const r = await fetch(CLAWPUMP_BASE + "/api/fees/earnings?agentId=" + encodeURIComponent(AGENT_ID));
    if (r.ok) earnings = await r.json();
  } catch (e) {
    console.log("  earnings fetch failed:", e.message);
  }

  // 2. Get token info from ClawPump
  let tokenInfo = null;
  try {
    const r = await fetch(CLAWPUMP_BASE + "/api/tokens/" + launch.mintAddress);
    if (r.ok) tokenInfo = await r.json();
  } catch (e) {
    console.log("  token info fetch failed:", e.message);
  }

  // 3. Build context for Pi
  const context = [];
  if (earnings) {
    context.push(`Your wallet has earned ${earnings.totalEarned || 0} SOL so far.`);
    context.push(`${earnings.totalPending || 0} SOL is pending the next payout cycle.`);
  }
  if (tokenInfo) {
    if (tokenInfo.marketCap) context.push(`Market cap: ${Math.round(tokenInfo.marketCap)}.`);
    if (tokenInfo.volume24h) context.push(`Last 24h volume: ${Math.round(tokenInfo.volume24h)}.`);
    if (tokenInfo.holders) context.push(`${tokenInfo.holders} holders.`);
  }
  if (!context.length) {
    context.push("No new data this tick. Silence. Static.");
  }

  // 4. Ask Pi to react
  let post = "[silence]";
  try {
    const resp = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: AUTONOMOUS_PROMPT.trim() },
        { role: "user", content: "Current observation:\n" + context.join("\n") + "\n\nReact in one short post." },
      ],
      temperature: 0.95,
      max_tokens: 120,
    });
    post = resp.choices?.[0]?.message?.content?.trim() || "[no signal]";
  } catch (e) {
    console.log("  LLM call failed:", e.message);
  }

  // 5. Log + display
  console.log("  observation: " + context.join(" | "));
  console.log("  pi> " + post);
  console.log("");

  // append to log
  const entry = { ts, context, post, earnings, tokenInfo: tokenInfo ? {
    price: tokenInfo.price, marketCap: tokenInfo.marketCap, volume24h: tokenInfo.volume24h, holders: tokenInfo.holders
  } : null };
  let log = [];
  if (fs.existsSync(LOG_FILE)) {
    try { log = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8")); } catch (e) {}
  }
  log.push(entry);
  // keep last 500
  if (log.length > 500) log = log.slice(-500);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));

  // 6. Push to PiVerse backend → frontend Discoveries shows it live
  //    Requires AGENT_KEY in both backend .env AND agent-runtime .env
  //    (same value on both sides). Without it the endpoint 401s.
  if (process.env.PIVERSE_API) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (process.env.AGENT_KEY) headers["x-agent-key"] = process.env.AGENT_KEY;
      const r = await fetch(process.env.PIVERSE_API + "/autonomous", {
        method: "POST",
        headers,
        body: JSON.stringify({ post, context, ts, earnings, tokenInfo }),
      });
      if (!r.ok) {
        console.log("  push failed:", r.status, await r.text().catch(()=>''));
      } else {
        console.log("  ✓ pushed to /autonomous");
      }
    } catch (e) {
      console.log("  push error:", e.message);
    }
  }

  // 7. (Optional) post to Twitter, Telegram, etc.
  // TODO: hook up a Twitter posting API (e.g. twitter-api-v2) here
  // to make Pi truly autonomous on social media.
}

// ─── main loop ───────────────────────────────────────────────
await tick(); // run immediately
setInterval(tick, TICK_MS);

// graceful shutdown
process.on("SIGINT", () => {
  console.log("\nLoop stopped.");
  process.exit(0);
});
