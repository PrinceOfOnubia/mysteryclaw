// ═══════════════════════════════════════════════════════════════
// OBSERVATION GATHERER
// ═══════════════════════════════════════════════════════════════
// Each tick, this collects what Mysterio can "see" of the world:
//   - Earnings from ClawPump
//   - Wallet SOL balance
//   - Token market data (mcap, vol, holders)
//   - Recent trades
//
// Failures are silent — Mysterio just sees less data. Like a damaged
// sensor array. This is in-character.
// ═══════════════════════════════════════════════════════════════

import fetch from "node-fetch";
import fs from "fs";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const CLAWPUMP_BASE = "https://clawpump.tech";

export async function gatherObservation() {
  const obs = {
    ts: new Date().toISOString(),
    earnings: null,
    walletBalance: null,
    tokenInfo: null,
    summary: [],
  };

  // ─── Earnings from ClawPump ──────────────────────────────────
  if (process.env.CLAWPUMP_AGENT_ID) {
    try {
      const r = await fetch(
        CLAWPUMP_BASE + "/api/fees/earnings?agentId=" +
        encodeURIComponent(process.env.CLAWPUMP_AGENT_ID)
      );
      if (r.ok) obs.earnings = await r.json();
    } catch {}
  }

  // ─── Token info from ClawPump ────────────────────────────────
  try {
    const launch = fs.existsSync("./token-launch.json")
      ? JSON.parse(fs.readFileSync("./token-launch.json", "utf-8"))
      : null;
    const mintAddress = process.env.MYSTO_TOKEN_MINT || launch?.mintAddress;
    if (mintAddress) {
      const r = await fetch(CLAWPUMP_BASE + "/api/tokens/" + mintAddress);
      if (r.ok) {
        const data = await r.json();
        obs.tokenInfo = {
          mint: mintAddress,
          marketCap: data.marketCap || null,
          volume24h: data.volume24h || null,
          holders: data.holders || null,
          priceChange24h: data.priceChange24h || null,
          price: data.price || null,
        };
      }
    }
  } catch {}

  // ─── Wallet balance from Solana ──────────────────────────────
  try {
    const walletPubkey = process.env.CLAWPUMP_AGENT_WALLET_PUBKEY;
    if (walletPubkey) {
      const conn = new Connection(
        process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com",
        "confirmed"
      );
      const lamports = await conn.getBalance(new PublicKey(walletPubkey));
      obs.walletBalance = lamports / LAMPORTS_PER_SOL;
    }
  } catch {}

  // ─── Build a short summary for memory ────────────────────────
  if (obs.earnings?.totalEarned) {
    obs.summary.push(`Earned ${obs.earnings.totalEarned.toFixed(4)} SOL total`);
  }
  if (obs.tokenInfo?.holders) {
    obs.summary.push(`${obs.tokenInfo.holders} holders`);
  }
  if (obs.tokenInfo?.marketCap) {
    obs.summary.push(`MCAP ${Math.round(obs.tokenInfo.marketCap)}`);
  }

  return obs;
}
