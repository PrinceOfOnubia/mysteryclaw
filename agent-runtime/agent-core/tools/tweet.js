// ═══════════════════════════════════════════════════════════════
// TOOL: tweet
// ═══════════════════════════════════════════════════════════════
// Pi posts to its X/Twitter account. SIMULATED by default.
//
// REAL implementation:
//   1. Install: npm i twitter-api-v2
//   2. Get Twitter API keys (requires X Premium $200/mo for v2 write)
//      OR use a 3rd-party poster like Typefully/Buffer with their API
//   3. Set env vars:
//        TWITTER_API_KEY=
//        TWITTER_API_SECRET=
//        TWITTER_ACCESS_TOKEN=
//        TWITTER_ACCESS_SECRET=
//   4. Replace the simulated block with a real call.
// ═══════════════════════════════════════════════════════════════

export const definition = {
  name: "tweet",
  description: "Post a short message to Pi's configured X/Twitter account. Use sparingly — max 2-3 tweets per day. Best for: major narrative beats, taunts at successful guessers (without revealing the word), thanks to the community when milestones hit. Max 280 chars.",
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

// Soft per-day cap so Pi can't spam
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
  if (process.env.EXECUTE_REAL_TXNS !== "true" || !process.env.TWITTER_API_KEY) {
    _tweetsToday++;
    return {
      ok: true,
      simulated: true,
      text,
      replyToTweetId: replyToTweetId || null,
      note: "SIMULATED — set TWITTER_API_KEY and EXECUTE_REAL_TXNS=true for real",
    };
  }

  // ─── REAL MODE ───────────────────────────────────────────────
  // TODO: uncomment and configure for production
  // import { TwitterApi } from "twitter-api-v2";
  // const twitter = new TwitterApi({
  //   appKey: process.env.TWITTER_API_KEY,
  //   appSecret: process.env.TWITTER_API_SECRET,
  //   accessToken: process.env.TWITTER_ACCESS_TOKEN,
  //   accessSecret: process.env.TWITTER_ACCESS_SECRET,
  // });
  // const opts = replyToTweetId ? { reply: { in_reply_to_tweet_id: replyToTweetId } } : {};
  // const result = await twitter.v2.tweet(text, opts);
  // _tweetsToday++;
  // return { ok: true, id: result.data.id, text };

  return { ok: false, error: "real tweet not wired — see TODO in tool source" };
}
