import express from "express";
import { publicStatus, load } from "../_winners.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// PRIZE STATUS ENDPOINT
// ═══════════════════════════════════════════════════════════════
// GET /prize         → current epoch status (for frontend display)
// GET /prize/history → past epochs + payout signatures (transparency)
// ═══════════════════════════════════════════════════════════════

router.get("/", (req, res) => {
  res.json(publicStatus());
});

router.get("/history", (req, res) => {
  const data = load();
  // expose only non-sensitive fields
  const history = Object.values(data.epochs)
    .filter((e) => e.paidOut)
    .map((e) => ({
      epoch: e.epoch,
      winners: e.winners.length,
      paidAt: e.paidAt,
      payouts: (e.payouts || []).map((p) => ({
        pubkey: p.pubkey.slice(0, 4) + "..." + p.pubkey.slice(-4),
        amount: p.amount,
        signature: p.signature,
      })),
    }));
  res.json(history);
});

export default router;
