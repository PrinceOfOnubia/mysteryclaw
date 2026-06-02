import express from "express";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// MYSTO LIVE STATS ENDPOINT
// ═══════════════════════════════════════════════════════════════
//
// Returns aggregated stats shown on the landing page hero.
// Frontend polls this every 30s.
//
// FRONTEND EXPECTS:
//   {
//     investigators: 1247,    // unique wallets that have chatted with Mysterio (all time)
//     conversations: 38402,   // total messages sent to /chat
//     clues: 182              // total saved fragments (if you store them server-side)
//   }
//
// If you don't want to track conversations/clues yet, return whatever
// you have — frontend handles missing fields by showing dashes.
// ═══════════════════════════════════════════════════════════════

router.get("/", async (req, res) => {
  try {
    // ─────────────────────────────────────────────────────────
    // TODO (BACKEND DEV): pull real numbers from your DB
    // ─────────────────────────────────────────────────────────
    //
    // Easiest implementation:
    //   - Track in-memory counters and bump them in /chat and /guess
    //   - For investigators: dedup by userId (wallet pubkey)
    //
    // Example with simple in-memory store (good for MVP):
    //
    //   import { stats } from "./_stats.js";   // shared module
    //   return res.json({
    //     investigators: stats.uniqueUsers.size,
    //     conversations: stats.messages,
    //     clues: stats.cluesSaved,
    //   });
    //
    // For production, move to Postgres / Redis.
    // ─────────────────────────────────────────────────────────

    // STUB RESPONSE — returns null fields so frontend shows "—"
    return res.json({
      investigators: null,
      conversations: null,
      clues: null,
      _stub: true,
    });
  } catch (err) {
    res.status(500).json({ error: "stats unavailable" });
  }
});

export default router;
