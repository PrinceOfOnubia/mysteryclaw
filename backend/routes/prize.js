import express from "express";
import { publicStatus, prizeHistory } from "../_winners.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// PRIZE STATUS ENDPOINT
// ═══════════════════════════════════════════════════════════════
// GET /prize         → current epoch status (for frontend display)
// GET /prize/history → past epochs + payout signatures (transparency)
// ═══════════════════════════════════════════════════════════════

router.get("/", async (req, res) => {
  try {
    res.json(await publicStatus());
  } catch (err) {
    console.error("PRIZE ERROR:", err.message);
    res.status(500).json({ error: "prize_status_failed" });
  }
});

router.get("/history", async (req, res) => {
  try {
    res.json(await prizeHistory());
  } catch (err) {
    console.error("PRIZE HISTORY ERROR:", err.message);
    res.status(500).json({ error: "prize_history_failed" });
  }
});

export default router;
