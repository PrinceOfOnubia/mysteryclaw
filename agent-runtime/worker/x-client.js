import { TwitterApi } from "twitter-api-v2";

export function xConfigured() {
  return Boolean(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET
  );
}

export function missingXCredentials() {
  return [
    "X_API_KEY",
    "X_API_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_TOKEN_SECRET",
  ].filter((key) => !process.env[key]);
}

export function getXClient() {
  if (!xConfigured()) {
    const err = new Error("x_credentials_missing");
    err.missing = missingXCredentials();
    throw err;
  }
  return new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
}

export async function verifyXCredentials() {
  const client = getXClient();
  const user = await client.v2.me();
  return user.data;
}

export async function postTweet(text, { dryRun = false, replyToTweetId = null } = {}) {
  const clean = normalizeTweet(text);
  if (dryRun) {
    return { ok: true, dryRun: true, text: clean };
  }
  const client = getXClient();
  const options = replyToTweetId
    ? { reply: { in_reply_to_tweet_id: replyToTweetId } }
    : undefined;
  const result = await client.v2.tweet(clean, options);
  return {
    ok: true,
    id: result.data?.id,
    text: result.data?.text || clean,
  };
}

export function normalizeTweet(text) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) {
    const err = new Error("tweet_text_required");
    err.status = 400;
    throw err;
  }
  if (clean.length > 280) {
    const err = new Error("tweet_text_too_long");
    err.status = 400;
    throw err;
  }
  return clean;
}
