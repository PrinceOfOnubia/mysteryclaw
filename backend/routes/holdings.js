import express from "express";
import { getHoldings } from "../_access.js";
import { normalizePubkey } from "../_walletAuth.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// MYSTO TOKEN HOLDINGS ENDPOINT
// ═══════════════════════════════════════════════════════════════
//
// Verify that a Phantom wallet holds at least one MysteryClaw access
// token. Frontend calls this after wallet connect.
//
// All the heavy lifting (Solana RPC, caching, the token list) lives
// in ../_access.js — shared with routes/guess.js so the two can
// never drift apart.
//
// Response:
//   { holdings: { MYSTO:0, CLAW:12000, SQUIRE:0, SAID:5000, NEMO:0 },
//     hasAccess: true }
//
// Requires SOLANA_RPC env var. Without it, returns all-zeros +
// hasAccess:false (honest — never fabricates access).
// ═══════════════════════════════════════════════════════════════

router.post("/", async (req, res) => {
  try {
    const { pubkey } = req.body;
    if (!pubkey) return res.status(400).json({ error: "pubkey required" });
    const wallet = normalizePubkey(pubkey);
    // TODO: pair this pubkey with signed-message verification before
    // public prize launch. This endpoint verifies token balances for the
    // supplied address, not ownership of that address.

    const result = await getHoldings(wallet);
    return res.json(result);
  } catch (err) {
    console.error("HOLDINGS ERROR:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Holdings check failed" });
  }
});

export default router;
