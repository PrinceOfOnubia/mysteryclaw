// Railway worker for MysteryClaw / Mysterio automation.
// Runs independently from the web backend so X/autopost failures cannot
// take the public API offline.

import "dotenv/config";
import OpenAI from "openai";
import { auditLog, closePool, getSetting, hasDatabase, query, setSetting, sha256 } from "../worker/db.js";
import { missingXCredentials, postTweet, xConfigured } from "../worker/x-client.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const AUTOPOST_ENABLED = process.env.AUTOPOST_ENABLED === "true";
const INTERVAL_MINUTES = clampNumber(process.env.AUTOPOST_INTERVAL_MINUTES, 5, 1440, 60);
const TICK_MS = clampNumber(process.env.WORKER_TICK_MS, 30000, 3600000, Math.min(INTERVAL_MINUTES * 60 * 1000, 300000));
const API_BASE = (process.env.MYSTERYCLAW_API || "").replace(/\/$/, "");
const X_HANDLE = process.env.X_HANDLE || "MysteryClawPump";
const WORKER_NAME = "mysterio-worker";

let openai = null;

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  MYSTERIO RAILWAY WORKER");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  Mode:       " + (process.env.MYSTERIO_MODE || "development"));
console.log("  Autopost:   " + (AUTOPOST_ENABLED ? "enabled" : "disabled"));
console.log("  Interval:   " + INTERVAL_MINUTES + " min");
console.log("  Tick:       " + Math.round(TICK_MS / 1000) + "s");
console.log("  Database:   " + (hasDatabase() ? "configured" : "not configured"));
console.log("  X:          " + (xConfigured() ? "configured @" + X_HANDLE : "missing " + missingXCredentials().join(", ")));
console.log("");

async function tick() {
  const startedAt = Date.now();
  console.log("─── worker tick @ " + new Date().toISOString() + " ───");

  if (!AUTOPOST_ENABLED) {
    console.log("  [skip] AUTOPOST_ENABLED is not true");
    return;
  }
  if (!hasDatabase()) {
    console.log("  [skip] DATABASE_URL missing; refusing to rely on local Railway filesystem state");
    return;
  }
  if (!xConfigured()) {
    console.log("  [skip] X credentials missing: " + missingXCredentials().join(", "));
    await auditLog("mysterio_worker_x_missing", { missing: missingXCredentials() });
    return;
  }

  try {
    const clue = await getDueClue();
    if (clue) {
      await postDueClue(clue);
      return;
    }

    if (!(await intervalElapsed())) {
      console.log("  [skip] interval guard active");
      return;
    }

    const epoch = await getCurrentEpoch();
    const text = await generateMysterioPost(epoch);
    await postWithDuplicateProtection(text, {
      kind: "autopost",
      details: {
        epoch: epoch?.epoch_number || null,
        slug: epoch?.slug || null,
      },
    });
  } catch (err) {
    console.log("  [error] " + (err.message || "worker_tick_failed"));
    await auditLog("mysterio_worker_tick_failed", { error: err.message || "unknown" }).catch(() => {});
  } finally {
    console.log("  [done] " + ((Date.now() - startedAt) / 1000).toFixed(1) + "s\n");
  }
}

async function getDueClue() {
  const result = await query(
    `select c.id, c.clue_number, c.post_copy, c.scheduled_at, e.epoch_number, e.slug, e.title
     from epoch_clues c
     join prize_epochs e on e.id = c.epoch_id
     where e.status in ('live', 'active', 'open', 'pending')
       and c.status in ('draft', 'scheduled')
       and c.scheduled_at is not null
       and c.scheduled_at <= now()
     order by c.scheduled_at asc, c.clue_number asc
     limit 1`
  );
  return result.rows[0] || null;
}

async function postDueClue(clue) {
  const text = clue.post_copy;
  const result = await postWithDuplicateProtection(text, {
    kind: "clue",
    details: {
      clueId: clue.id,
      clueNumber: clue.clue_number,
      epoch: clue.epoch_number,
      slug: clue.slug,
    },
  });

  if (result.posted && result.tweetId) {
    const url = `https://x.com/${X_HANDLE}/status/${result.tweetId}`;
    await query(
      `update epoch_clues
       set status = 'posted', x_url = $1, posted_at = now(), updated_at = now()
       where id = $2`,
      [url, clue.id]
    );
    console.log("  [clue] marked posted: " + url);
  }
}

async function intervalElapsed() {
  const last = await getSetting("mysterio_worker_last_post_at", null);
  if (!last) return true;
  const elapsedMs = Date.now() - new Date(last).getTime();
  return elapsedMs >= INTERVAL_MINUTES * 60 * 1000;
}

async function getCurrentEpoch() {
  const result = await query(
    `select epoch_number, title, slug, status, starts_at, closes_at, x_thread_url, metadata
     from prize_epochs
     where paid_out_at is null
     order by epoch_number desc
     limit 1`
  );
  return result.rows[0] || null;
}

async function generateMysterioPost(epoch) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackPost(epoch);
  }
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = [
    "Write one short X post for MysteryClaw's Mysterio.",
    "Voice: cryptic, intelligent, premium mystery society, no emojis, no hashtags, no price talk, no shilling.",
    "Never reveal or imply the hidden answer.",
    "Mention Echo/trials/fragments/countdown only if natural.",
    "Max 220 characters.",
    epoch ? `Current epoch: ${epoch.title || epoch.slug} (${epoch.status}).` : "No epoch data available.",
  ].join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "You are Mysterio. You guard the word. You post like a signal from a sealed archive." },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 90,
    });
    const text = response.choices?.[0]?.message?.content?.trim();
    return text || fallbackPost(epoch);
  } catch (err) {
    console.log("  [openai] failed: " + err.message);
    return fallbackPost(epoch);
  }
}

async function postWithDuplicateProtection(text, { kind, details = {} }) {
  const clean = text.replace(/\s+/g, " ").trim();
  const hash = sha256(clean.toLowerCase());
  const lastHash = await getSetting("mysterio_worker_last_text_hash", null);
  const prior = await query(
    `select id from audit_logs
     where event_type = 'mysterio_worker_tweet_posted'
       and details->>'hash' = $1
     limit 1`,
    [hash]
  );
  if (hash === lastHash || prior.rows[0]) {
    console.log("  [skip] duplicate text");
    await auditLog("mysterio_worker_duplicate_skipped", { kind, hash, ...details });
    return { posted: false, duplicate: true };
  }

  const result = await postTweet(clean);
  const now = new Date().toISOString();
  await setSetting("mysterio_worker_last_post_at", now, WORKER_NAME);
  await setSetting("mysterio_worker_last_text_hash", hash, WORKER_NAME);
  if (result.id) await setSetting("mysterio_worker_last_tweet_id", result.id, WORKER_NAME);
  await auditLog("mysterio_worker_tweet_posted", {
    kind,
    tweetId: result.id || null,
    hash,
    ...details,
  });
  await mirrorToMysteryClawFeed(clean, kind, result.id || null, details);
  console.log("  [tweet] posted " + (result.id || "(no id)"));
  return { posted: true, tweetId: result.id || null, text: clean };
}

async function mirrorToMysteryClawFeed(text, kind, tweetId, details) {
  if (!API_BASE) return;
  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.AGENT_KEY) headers["x-agent-key"] = process.env.AGENT_KEY;
    const response = await fetch(API_BASE + "/autonomous", {
      method: "POST",
      headers,
      body: JSON.stringify({
        post: text,
        context: [
          "source:railway-worker",
          "kind:" + kind,
          tweetId ? "tweet:" + tweetId : "tweet:unknown",
        ],
        mood: kind === "clue" ? "observant" : "fragmented",
        tokenInfo: {
          worker: WORKER_NAME,
          epoch: details.epoch || null,
          slug: details.slug || null,
        },
        ts: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.log("  [mirror] backend HTTP " + response.status);
    }
  } catch (err) {
    console.log("  [mirror] failed: " + err.message);
  }
}

function fallbackPost(epoch) {
  if (epoch?.slug === "echo") {
    return "Echo keeps returning the same shape. The word is still sealed. The archive is waiting for someone who notices what repeats.";
  }
  return "A signal moved through the archive. No one sent it. Everyone heard it.";
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

await tick();

if (process.env.RUN_ONCE === "true") {
  await closePool();
  console.log("RUN_ONCE=true; exiting after one worker tick.");
  process.exit(0);
}

setInterval(() => tick().catch((err) => console.log("Tick error:", err.message)), TICK_MS);

process.on("SIGTERM", async () => {
  console.log("\nWorker received SIGTERM. Closing Postgres pool.");
  await closePool();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\nWorker stopped. Closing Postgres pool.");
  await closePool();
  process.exit(0);
});
