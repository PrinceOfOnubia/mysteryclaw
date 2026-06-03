// ═══════════════════════════════════════════════════════════════
// TOOL: tweet
// ═══════════════════════════════════════════════════════════════
// Mysterio posts to its X/Twitter account. SIMULATED by default.
//
// Real posting uses X_* env vars through worker/x-client.js.
// ═══════════════════════════════════════════════════════════════

import { missingXCredentials, postTweet, xConfigured } from "../../worker/x-client.js";

export const definition = {
  name: "tweet",
  description: "Post a short message to Mysterio's configured X/Twitter account. Use sparingly — max 2-3 tweets per day. Best for: major narrative beats, taunts at successful guessers (without revealing the word), thanks to the community when milestones hit. Max 280 chars.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Tweet content. Max 280 chars. Stay in character. NO emojis. NO crypto-influencer language."
      },
      replyToTweetId: {
        type: "string",
        description: "Optional. If replying to someone's tweet, provide their tweet ID."
      }
    },
    required: ["text"]
  }
};

// Soft per-day cap so Mysterio can't spam
const MAX_TWEETS_PER_DAY = 4;
let _tweetsToday = 0;
let _dayMarker = new Date().getUTCDate();

function bumpDayMarker() {
  const today = new Date().getUTCDate();
  if (today !== _dayMarker) {
    _dayMarker = today;
    _tweetsToday = 0;
  }
}

export async function execute({ text, replyToTweetId }) {
  if (!text || text.length > 280) {
    return { ok: false, error: "text invalid or > 280 chars" };
  }
  bumpDayMarker();
  if (_tweetsToday >= MAX_TWEETS_PER_DAY) {
    return { ok: false, error: `daily tweet cap reached (${MAX_TWEETS_PER_DAY}/day)` };
  }

  // ─── SIMULATED MODE ──────────────────────────────────────────
  if (process.env.EXECUTE_REAL_TXNS !== "true" || !xConfigured()) {
    _tweetsToday++;
    return {
      ok: true,
      simulated: true,
      text,
      replyToTweetId: replyToTweetId || null,
      note: "SIMULATED — set X credentials and EXECUTE_REAL_TXNS=true for real",
      missing: missingXCredentials(),
    };
  }

  // ─── REAL MODE ───────────────────────────────────────────────
  const result = await postTweet(text, { replyToTweetId });
  _tweetsToday++;
  return { ok: true, id: result.id, text: result.text };
}
