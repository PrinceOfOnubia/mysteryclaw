import express from "express";
import { hasDatabase, query } from "../_db.js";

const router = express.Router();

function shortWallet(wallet) {
  if (!wallet || wallet.length < 10) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

router.get("/", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });

    const requestedSlug = String(req.query.epoch || "").trim().toLowerCase();
    const epochResult = requestedSlug
      ? await query(`select * from prize_epochs where slug = $1 limit 1`, [requestedSlug])
      : await query(
          `select *
           from prize_epochs
           where paid_out_at is null
           order by epoch_number desc
           limit 1`
        );
    const epoch = epochResult.rows[0];
    if (!epoch) return res.status(404).json({ error: "epoch_not_found" });

    const participantResult = await query(
      `select
         g.wallet_pubkey,
         coalesce(u.display_name, '') as display_name,
         u.avatar_url,
         u.profile_bio,
         count(g.id)::int as attempts,
         count(g.id) filter (where g.correct)::int as correct_guesses,
         min(g.created_at) as first_guess_at,
         max(g.created_at) as last_guess_at,
         w.id as winner_id,
         w.created_at as won_at,
         w.approved_at,
         w.paid_at,
         w.payout_signature
       from guesses g
       left join users u on u.wallet_pubkey = g.wallet_pubkey
       left join winners w on w.wallet_pubkey = g.wallet_pubkey and w.epoch_id = g.epoch_id
       where g.epoch_id = $1 and g.source = 'website'
       group by g.wallet_pubkey, u.display_name, u.avatar_url, u.profile_bio,
                w.id, w.created_at, w.approved_at, w.paid_at, w.payout_signature
       order by
         case when w.id is not null then 0 else 1 end,
         w.created_at asc nulls last,
         count(g.id) filter (where g.correct) desc,
         count(g.id) desc,
         min(g.created_at) asc
       limit 250`,
      [epoch.id]
    );

    const rows = participantResult.rows.map((row, index) => ({
      rank: index + 1,
      wallet: row.wallet_pubkey,
      shortWallet: shortWallet(row.wallet_pubkey),
      displayName: row.display_name || null,
      avatarUrl: row.avatar_url || null,
      bio: row.profile_bio || null,
      attempts: row.attempts,
      correctGuesses: row.correct_guesses,
      firstGuessAt: row.first_guess_at ? new Date(row.first_guess_at).getTime() : null,
      lastGuessAt: row.last_guess_at ? new Date(row.last_guess_at).getTime() : null,
      winner: Boolean(row.winner_id),
      wonAt: row.won_at ? new Date(row.won_at).getTime() : null,
      approved: Boolean(row.approved_at),
      paid: Boolean(row.paid_at),
      payoutSignature: row.payout_signature || null,
    }));

    const summary = {
      participants: rows.length,
      attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
      winners: rows.filter((row) => row.winner).length,
    };

    res.json({
      epoch: {
        id: epoch.id,
        number: epoch.epoch_number,
        title: epoch.title || `Epoch ${epoch.epoch_number}`,
        slug: epoch.slug || null,
        status: epoch.status,
        pool: Number(epoch.pool_usdc || 0),
        maxWinners: epoch.max_winners || 1,
        payoutSplit: epoch.payout_split || "equal",
        startsAt: epoch.starts_at ? new Date(epoch.starts_at).getTime() : null,
        closesAt: (epoch.closes_at || epoch.ends_at) ? new Date(epoch.closes_at || epoch.ends_at).getTime() : null,
      },
      summary,
      participants: rows,
      winners: rows.filter((row) => row.winner),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "leaderboard_failed" });
  }
});

export default router;
