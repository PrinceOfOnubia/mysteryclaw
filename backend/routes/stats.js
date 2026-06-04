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
//     investigators: 1247,     // verified wallets all-time
//     officialGuesses: 38402,  // total official website guesses
//     activePlayers: 182,      // unique wallets that submitted official guesses
//     winners: 1               // winners recorded for current game
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
        officialGuesses: null,
        activePlayers: null,
        winners: null,
        conversations: null,
        clues: null,
        _stub: true,
      });
    }

    const result = await query(
      `with current_epoch as (
         select id
         from prize_epochs
         where slug is not null
         order by epoch_number desc
         limit 1
       ),
       epoch_participants as (
         select wallet_pubkey from guesses where epoch_id = (select id from current_epoch)
         union
         select wallet_pubkey from winners where epoch_id = (select id from current_epoch)
       )
       select
         (select count(distinct wallet_pubkey)::int from epoch_participants) as investigators,
         (select count(*)::int from guesses where source = 'website') as official_guesses,
         (select count(distinct wallet_pubkey)::int from guesses where source = 'website') as active_players,
         (select count(*)::int from winners) as winners,
         (select count(*)::int from audit_logs where event_type = 'chat_message') as conversations,
         (select count(*)::int from autonomous_posts) as clues`
    );

    return res.json({
      investigators: result.rows[0]?.investigators || 0,
      officialGuesses: result.rows[0]?.official_guesses || 0,
      activePlayers: result.rows[0]?.active_players || 0,
      winners: result.rows[0]?.winners || 0,
      conversations: result.rows[0]?.conversations || 0,
      clues: result.rows[0]?.clues || 0,
    });
  } catch (err) {
    console.error("STATS ERROR:", err.message);
    res.status(500).json({ error: "stats unavailable" });
  }
});

export default router;
