// ═══════════════════════════════════════════════════════════════
// STEP 02 — CHECK PI'S WALLET BALANCE
// ═══════════════════════════════════════════════════════════════
// `npm run fund-check`
// Reads pubkey from .env, queries Solana, prints SOL balance.
// Use this before launching to confirm Mysterio has enough SOL (~0.05)
// if you need to use the self-funded launch path.
// ═══════════════════════════════════════════════════════════════

import dotenv from "dotenv";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

dotenv.config();

const pubkey = process.env.MYSTERIO_WALLET_PUBKEY || process.env.PI_WALLET_PUBKEY;
const rpc = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

if (!pubkey) {
  console.error("MYSTERIO_WALLET_PUBKEY missing in .env. Run `npm run create-wallet` first.");
  process.exit(1);
}

const conn = new Connection(rpc, "confirmed");
const pk = new PublicKey(pubkey);

const lamports = await conn.getBalance(pk);
const sol = lamports / LAMPORTS_PER_SOL;

console.log("");
console.log("Mysterio wallet:    " + pubkey);
console.log("Balance:      " + sol.toFixed(6) + " SOL (" + lamports + " lamports)");
console.log("");

if (sol < 0.05) {
  console.log("⚠  Balance is low. Fund this wallet if you plan to use");
  console.log("   the self-funded launch path (0.03 SOL minimum).");
  console.log("");
  console.log("   Gasless launches via ClawPump cost nothing — they're");
  console.log("   subsidized as long as the platform treasury has capacity.");
} else {
  console.log("✓ Sufficient balance for self-funded launches.");
}
console.log("");
