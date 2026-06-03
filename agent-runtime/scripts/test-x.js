import "dotenv/config";
import { missingXCredentials, postTweet, verifyXCredentials, xConfigured } from "../worker/x-client.js";

const realPost = process.argv.includes("--post");
const textArgIndex = process.argv.indexOf("--text");
const text = textArgIndex >= 0
  ? process.argv[textArgIndex + 1]
  : "Mysterio test transmission. If this is visible, the archive chose to speak.";

if (!xConfigured()) {
  console.log("X credentials missing: " + missingXCredentials().join(", "));
  process.exit(1);
}

try {
  const user = await verifyXCredentials();
  console.log("X credentials valid for @" + (user.username || process.env.X_HANDLE || "unknown"));
  if (!realPost) {
    const dry = await postTweet(text, { dryRun: true });
    console.log("Dry run only. No tweet posted.");
    console.log("Tweet preview: " + dry.text);
    process.exit(0);
  }
  const result = await postTweet(text);
  console.log("Posted tweet id: " + result.id);
} catch (err) {
  console.error("X test failed: " + (err.message || "unknown"));
  process.exit(1);
}
