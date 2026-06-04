import express from "express";
import { hasDatabase, query } from "../_db.js";

const router = express.Router();

function shortWallet(wallet) {
  if (!wallet || wallet.length < 10) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function publicEpochStatus(epoch, approvedWinners = 0) {
  const rawStatus = String(epoch.status || "open").toLowerCase();
  const closesAt = (epoch.closes_at || epoch.ends_at) ? new Date(epoch.closes_at || epoch.ends_at).getTime() : null;
  const startsAt = epoch.starts_at ? new Date(epoch.starts_at).getTime() : null;
  if (epoch.paid_out_at) return "paid";
  if (epoch.slug === "mysterio" || rawStatus === "closed") return "closed";
  if (approvedWinners > 0 || (closesAt && Date.now() >= closesAt)) return "closing";
  if (startsAt && Date.now() < startsAt) return "pending";
  if (["live", "active", "open"].includes(rawStatus)) return "active";
  return rawStatus;
}

router.get("/", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });

    const requestedSlug = String(req.query.epoch || "").trim().toLowerCase();
    const epochListResult = await query(
      `select epoch_number, title, slug, status, starts_at, closes_at, ends_at, paid_out_at
       from prize_epochs
       where slug is not null
       order by epoch_number desc
       limit 50`
    );
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
      `with participant_wallets as (
         select wallet_pubkey from guesses where epoch_id = $1
         union
         select wallet_pubkey from winners where epoch_id = $1
       )
       select
         p.wallet_pubkey,
         coalesce(u.display_name, '') as display_name,
         u.avatar_url,
         u.profile_bio,
         count(g.id) filter (where g.source = 'website')::int as attempts,
         least(1, count(g.id) filter (where g.correct))::int as correct_guesses,
         min(g.created_at) as first_guess_at,
         max(g.created_at) as last_guess_at,
         w.id as winner_id,
         w.created_at as won_at,
         w.approved_at,
         w.paid_at,
         w.payout_signature,
         w.source as winner_source,
         w.notes as winner_notes,
         w.display_attempts
       from participant_wallets p
       left join guesses g on g.wallet_pubkey = p.wallet_pubkey and g.epoch_id = $1
       left join users u on u.wallet_pubkey = p.wallet_pubkey
       left join winners w on w.wallet_pubkey = p.wallet_pubkey and w.epoch_id = $1
       group by p.wallet_pubkey, u.display_name, u.avatar_url, u.profile_bio,
                w.id, w.created_at, w.approved_at, w.paid_at, w.payout_signature, w.source, w.notes, w.display_attempts
       order by
         case when w.id is not null then 0 else 1 end,
         w.created_at asc nulls last,
         count(g.id) filter (where g.correct) desc,
         count(g.id) desc,
         min(g.created_at) asc
       limit 250`,
      [epoch.id]
    );

    const approvedWinnerCount = participantResult.rows.filter((row) => row.approved_at).length;
    const estimatedWinnerPrize = approvedWinnerCount > 0
      ? Number(epoch.pool_usdc || 0) / approvedWinnerCount
      : 0;

    const rows = participantResult.rows.map((row, index) => ({
      rank: index + 1,
      wallet: row.wallet_pubkey,
      shortWallet: shortWallet(row.wallet_pubkey),
      displayName: row.display_name || null,
      avatarUrl: row.avatar_url || null,
      bio: row.profile_bio || null,
      attempts: row.display_attempts ?? row.attempts,
      correctGuesses: row.correct_guesses,
      firstGuessAt: row.first_guess_at ? new Date(row.first_guess_at).getTime() : null,
      lastGuessAt: row.last_guess_at ? new Date(row.last_guess_at).getTime() : null,
      winner: Boolean(row.winner_id),
      wonAt: row.won_at ? new Date(row.won_at).getTime() : null,
      approved: Boolean(row.approved_at),
      paid: Boolean(row.paid_at),
      payoutSignature: row.payout_signature || null,
      winnerSource: row.winner_source || null,
      winnerNotes: row.winner_notes || null,
      prizeWon: row.approved_at ? estimatedWinnerPrize : 0,
    }));

    const summary = {
      participants: rows.length,
      attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
      winners: rows.filter((row) => row.winner).length,
      approvedWinners: rows.filter((row) => row.approved).length,
    };
    const startsAt = epoch.starts_at ? new Date(epoch.starts_at).getTime() : null;
    const closesAt = (epoch.closes_at || epoch.ends_at) ? new Date(epoch.closes_at || epoch.ends_at).getTime() : null;
    const publicStatus = publicEpochStatus(epoch, summary.approvedWinners);

    res.json({
      epoch: {
        id: epoch.id,
        number: epoch.epoch_number,
        title: epoch.title || `Epoch ${epoch.epoch_number}`,
        slug: epoch.slug || null,
        status: publicStatus,
        pool: Number(epoch.pool_usdc || 0),
        maxWinners: epoch.max_winners || 1,
        payoutSplit: epoch.payout_split || "equal",
        startsAt,
        closesAt,
      },
      epochs: epochListResult.rows.map((e) => ({
        number: e.epoch_number,
        title: e.title || `Epoch ${e.epoch_number}`,
        slug: e.slug || null,
        status: publicEpochStatus(e),
        startsAt: e.starts_at ? new Date(e.starts_at).getTime() : null,
        closesAt: (e.closes_at || e.ends_at) ? new Date(e.closes_at || e.ends_at).getTime() : null,
      })),
      summary,
      participants: rows,
      winners: rows.filter((row) => row.winner),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "leaderboard_failed" });
  }
});

export default router;
