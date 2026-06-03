import express from "express";
import { getEpochBySlug, publicStatus, prizeHistory } from "../_winners.js";

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

router.get("/epochs/:slug", async (req, res) => {
  try {
    const epoch = await getEpochBySlug(req.params.slug);
    if (!epoch) return res.status(404).json({ error: "epoch_not_found" });
    res.json({
      id: epoch.id,
      epoch: epoch.epoch_number,
      title: epoch.title,
      slug: epoch.slug,
      status: epoch.status,
      startsAt: epoch.starts_at || epoch.started_at,
      endsAt: epoch.ends_at || epoch.closes_at,
      closesAt: epoch.closes_at || epoch.ends_at,
      prizeAmount: Number(epoch.pool_usdc || 0),
      maxAttemptsPerWallet: epoch.max_attempts_per_wallet || 10,
      xThreadUrl: epoch.x_thread_url || null,
      metadata: epoch.metadata || {},
      clues: (epoch.clues || []).map((clue) => ({
        id: clue.id,
        clueNumber: clue.clueNumber,
        scheduledAt: clue.scheduledAt,
        xUrl: clue.xUrl,
        status: clue.status,
        postedAt: clue.postedAt,
        postCopy: clue.status === "posted" ? clue.postCopy : null,
      })),
    });
  } catch (err) {
    console.error("PRIZE EPOCH ERROR:", err.message);
    res.status(500).json({ error: "epoch_status_failed" });
  }
});

export default router;
