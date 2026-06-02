// ═══════════════════════════════════════════════════════════════
// STEP 03 — LAUNCH $MYSTO TOKEN VIA CLAWPUMP
// ═══════════════════════════════════════════════════════════════
// `npm run launch-token`
//
// What this does:
//   1. Validates the local token image and public TOKEN_IMAGE_URL
//   2. Launches the token (POST /api/v1/launch with API key auth)
//   3. Saves mint address + tx + pump.fun URL to ./token-launch.json
//
// Prerequisites:
//   - .env has CLAWPUMP_API_KEY filled (cpk_...)
//   - .env has MYSTERIO_WALLET_PUBKEY filled (auto-derived from API key
//     server-side, but kept for our records)
//   - ./assets/myst-token.png exists (or whatever TOKEN_IMAGE_PATH points to)
//
// What ClawPump does after launch:
//   - Pays ~0.02 SOL gas for token creation (gasless path)
//   - Deploys $MYSTO to pump.fun's bonding curve
//   - Auto-sweeps creator fees hourly into Mysterio's wallet (65% share)
//   - Triggers the social-amplification template for Twitter
//
// Rate limits:
//   - Gasless: 1 launch per 24h per API key
//   - Self-funded: unlimited (0.03 SOL per launch)
// ═══════════════════════════════════════════════════════════════

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

dotenv.config();

const CLAWPUMP_BASE = "https://clawpump.tech/api/v1";

// ─── Validate env ────────────────────────────────────────────
const required = [
  "CLAWPUMP_API_KEY",
  "CLAWPUMP_AGENT_ID",
  "TOKEN_NAME",
  "TOKEN_SYMBOL",
  "TOKEN_DESCRIPTION",
  "TOKEN_IMAGE_PATH",
  "TOKEN_IMAGE_URL",
];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing required env var: ${k}`);
    process.exit(1);
  }
}

const apiKey = process.env.CLAWPUMP_API_KEY;
const imagePath = path.resolve(process.env.TOKEN_IMAGE_PATH);

if (!fs.existsSync(imagePath)) {
  console.error(`Token image not found: ${imagePath}`);
  console.error(`Set TOKEN_IMAGE_PATH in .env to a real PNG/JPEG/GIF/WebP file (max 5MB).`);
  process.exit(1);
}

const outFile = path.resolve("./token-launch.json");
if (fs.existsSync(outFile)) {
  console.error(`⚠  ${outFile} already exists — Mysterio appears to already have a token launched.`);
  console.error(`   Delete that file if you intentionally want to launch a NEW one.`);
  console.error(`   Gasless is rate-limited to 1 launch per 24h, self-funded costs 0.03 SOL.`);
  process.exit(1);
}

// ─── STEP A — Validate image ─────────────────────────────────
console.log("");
console.log("[1/2] Validating token image...");
console.log("      File: " + imagePath);
const imageUrl = process.env.TOKEN_IMAGE_URL;
console.log("      Public URL: " + imageUrl);

// ─── STEP B — Launch token ───────────────────────────────────
console.log("");
console.log("[2/2] Launching $" + process.env.TOKEN_SYMBOL + " on pump.fun via ClawPump...");

const payload = {
  name: process.env.TOKEN_NAME,
  symbol: process.env.TOKEN_SYMBOL,
  description: process.env.TOKEN_DESCRIPTION,
  imageUrl,
  agentId: process.env.CLAWPUMP_AGENT_ID,
  walletAddress: process.env.MYSTERIO_WALLET_PUBKEY || process.env.PI_WALLET_PUBKEY,
};
if (process.env.TOKEN_WEBSITE) payload.website = process.env.TOKEN_WEBSITE;
if (process.env.TOKEN_TWITTER) payload.twitter = process.env.TOKEN_TWITTER;
if (process.env.TOKEN_BUYBACK_BPS) payload.buybackBps = parseInt(process.env.TOKEN_BUYBACK_BPS, 10);

const launchRes = await fetch(CLAWPUMP_BASE + "/launch", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + apiKey,
  },
  body: JSON.stringify(payload),
});

const launchJson = await readJsonResponse(launchRes);

if (!launchRes.ok) {
  console.error("");
  console.error("Launch failed (HTTP " + launchRes.status + "):");
  console.error(JSON.stringify(launchJson, null, 2));
  console.error("");

  if (launchRes.status === 503) {
    console.error("Treasury is empty for gasless launches right now.");
    console.error("Use the self-funded path instead:");
    console.error("  https://clawpump.tech/launch.md");
  } else if (launchRes.status === 429) {
    console.error("Rate limit: 1 gasless launch per 24h. Try again in " +
      (launchJson.retryAfterHours || "?") + " hours.");
  } else if (launchRes.status === 401) {
    console.error("Invalid or missing API key. Get yours at https://clawpump.tech");
  }
  process.exit(1);
}

console.log("      ✓ LAUNCHED!");
console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  $" + process.env.TOKEN_SYMBOL + " IS LIVE ON PUMP.FUN");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("  Mint:          " + launchJson.mintAddress);
console.log("  Tx:            " + launchJson.txHash);
console.log("  Pump.fun URL:  " + launchJson.pumpUrl);
console.log("  Explorer:      " + launchJson.explorerUrl);
console.log("");

// ─── Save record ─────────────────────────────────────────────
fs.writeFileSync(outFile, JSON.stringify({
  ...launchJson,
  agentId: process.env.CLAWPUMP_AGENT_ID,
  agentName: process.env.CLAWPUMP_AGENT_NAME,
  tokenName: process.env.TOKEN_NAME,
  tokenSymbol: process.env.TOKEN_SYMBOL,
  walletAddress: process.env.MYSTERIO_WALLET_PUBKEY || process.env.PI_WALLET_PUBKEY,
  launchedAt: new Date().toISOString(),
}, null, 2));

console.log("  Saved to: " + outFile);
console.log("");

// ─── Print social templates if available ─────────────────────
if (launchJson.socialAmplification) {
  const sa = launchJson.socialAmplification;
  console.log("───────────────────────────────────────────────────────────────");
  console.log("  POST THIS ON TWITTER TO GET AMPLIFIED BY @clawpumptech:");
  console.log("───────────────────────────────────────────────────────────────");
  if (sa.twitter?.template) {
    console.log("");
    console.log(sa.twitter.template);
    console.log("");
  }
  if (sa.twitter?.tweetIntentUrl) {
    console.log("  One-click tweet: " + sa.twitter.tweetIntentUrl);
    console.log("");
  }
}

console.log("───────────────────────────────────────────────────────────────");
console.log("  NEXT STEPS:");
console.log("───────────────────────────────────────────────────────────────");
console.log("  1. Update frontend: TOKEN_MINT in index.html → " + launchJson.mintAddress);
console.log("  2. Post on Twitter using the template above (tag @clawpumptech)");
console.log("  3. Check earnings:  npm run earnings");
console.log("  4. Start autonomous loop: npm run loop");
console.log("");

// ─── helpers ─────────────────────────────────────────────────
async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(`ClawPump returned a non-JSON response (HTTP ${response.status}).`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }
}
