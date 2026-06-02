import express from "express";
import { hasDatabase, query } from "../_db.js";

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
    if (!hasDatabase) {
      return res.json({
        investigators: null,
        conversations: null,
        clues: null,
        _stub: true,
      });
    }

    const result = await query(
      `with active_wallets as (
         select wallet_pubkey
         from audit_logs
         where wallet_pubkey is not null
           and created_at >= now() - interval '24 hours'
         union
         select wallet_pubkey
         from guesses
         where created_at >= now() - interval '24 hours'
         union
         select wallet_pubkey
         from verified_wallets
         where last_verified_at >= now() - interval '24 hours'
       )
       select
         (select count(distinct wallet_pubkey)::int from active_wallets) as investigators,
         (select count(*)::int from audit_logs where event_type = 'chat_message') as conversations,
         (select count(*)::int from autonomous_posts) as clues`
    );

    return res.json({
      investigators: result.rows[0]?.investigators || 0,
      conversations: result.rows[0]?.conversations || 0,
      clues: result.rows[0]?.clues || 0,
    });
  } catch (err) {
    console.error("STATS ERROR:", err.message);
    res.status(500).json({ error: "stats unavailable" });
  }
});

export default router;
