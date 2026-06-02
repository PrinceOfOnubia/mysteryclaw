// ═══════════════════════════════════════════════════════════════
// STEP 03 — LAUNCH $MYSTO TOKEN VIA CLAWPUMP
// ═══════════════════════════════════════════════════════════════
// `npm run launch-token`
//
// What this does:
//   1. Validates the local token image and public TOKEN_IMAGE_URL
//   2. Prints the ClawPump dashboard launch URL
//   3. Refuses to submit an undocumented direct API launch
//
// Prerequisites:
//   - .env has CLAWPUMP_API_KEY filled (cpk_...)
//   - .env has CLAWPUMP_AGENT_ID filled from the hosted agent dashboard
//   - ./assets/myst-token.png exists (or whatever TOKEN_IMAGE_PATH points to)
//
// What ClawPump does after launch:
//   - Pays ~0.02 SOL gas for token creation (gasless path)
//   - Deploys $MYSTO to pump.fun's bonding curve
//   - Auto-sweeps creator fees hourly into Mysterio's wallet (65% share)
//   - Triggers the social-amplification template for Twitter
//
// ═══════════════════════════════════════════════════════════════

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const CLAWPUMP_LAUNCH_URL = "https://agents.clawpump.tech/dashboard/launch-token";

// ─── Validate env ────────────────────────────────────────────
const required = [
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
  process.exit(1);
}

// ─── STEP A — Validate image ─────────────────────────────────
console.log("");
console.log("[1/2] Validating token image...");
console.log("      File: " + imagePath);
const imageUrl = process.env.TOKEN_IMAGE_URL;
console.log("      Public URL: " + imageUrl);

// ─── STEP B — Open dashboard launch flow ─────────────────────
console.log("");
console.log("[2/2] ClawPump dashboard launch required.");
console.log("");
console.log("      Current ClawPump tooling marks token launch as dashboard-only.");
console.log("      Sign in, select Mysterio, and launch $" + process.env.TOKEN_SYMBOL + " at:");
console.log("      " + CLAWPUMP_LAUNCH_URL);
console.log("");
console.log("      After launch, save the mint address and transaction signature");
console.log("      into token-launch.json before starting the autonomous loop.");
process.exit(1);
