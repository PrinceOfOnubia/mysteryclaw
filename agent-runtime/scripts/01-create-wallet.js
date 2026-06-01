// ═══════════════════════════════════════════════════════════════
// STEP 01 — CREATE MYSTERIO'S SOLANA WALLET
// ═══════════════════════════════════════════════════════════════
// Run once: `npm run create-wallet`
// Generates a fresh Solana keypair that becomes Mysterio's identity.
// Saves the private key to ./agent-wallet.json (mode 600) AND prints
// .env-ready variables to paste into .env.
//
// SECURITY:
//   - This wallet receives ALL Mysterio's earnings from ClawPump (65% of
//     creator fees from MysteryClaw token trading)
//   - The private key has full custody — never share, never push to
//     git, never log to public chat
//   - Back up agent-wallet.json to a safe location (encrypted USB,
//     password manager, hardware wallet recovery flow)
// ═══════════════════════════════════════════════════════════════

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";

const WALLET_FILE = path.resolve("./agent-wallet.json");

if (fs.existsSync(WALLET_FILE)) {
  console.error("⚠  agent-wallet.json already exists. Refusing to overwrite.");
  console.error("   Delete it first if you really want a fresh wallet.");
  process.exit(1);
}

const kp = Keypair.generate();
const pubkey = kp.publicKey.toBase58();
const secretBase58 = bs58.encode(kp.secretKey);

fs.writeFileSync(
  WALLET_FILE,
  JSON.stringify(
    {
      publicKey: pubkey,
      secretKey: Array.from(kp.secretKey),  // array form for @solana/web3.js
      secretBase58,                          // base58 form for env vars
      createdAt: new Date().toISOString(),
    },
    null,
    2
  ),
  { mode: 0o600 }
);

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  MYSTERIO WALLET CREATED");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("  Public key (this is Mysterio's address):");
console.log("  " + pubkey);
console.log("");
console.log("  Private key saved to: " + WALLET_FILE + "  (mode 600)");
console.log("");
console.log("  ⚠  BACK UP THIS FILE. If you lose it, Mysterio's funds are gone.");
console.log("  ⚠  DO NOT COMMIT agent-wallet.json TO GIT.");
console.log("");
console.log("───────────────────────────────────────────────────────────────");
console.log("  Paste these into your .env file:");
console.log("───────────────────────────────────────────────────────────────");
console.log("");
console.log("MYSTERIO_WALLET_PUBKEY=" + pubkey);
console.log("MYSTERIO_WALLET_SECRET=" + secretBase58);
console.log("");
console.log("───────────────────────────────────────────────────────────────");
console.log("");
console.log("  NEXT STEPS:");
console.log("  1. Fund this wallet with at least 0.05 SOL (for self-funded");
console.log("     launches if gasless is unavailable)");
console.log("  2. Get your ClawPump API key at https://clawpump.tech");
console.log("  3. Run: npm run launch-token");
console.log("");
