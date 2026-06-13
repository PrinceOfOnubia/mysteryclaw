import express from "express";
import { hasDatabase, pool, query, sha256 } from "../_db.js";
import { booleanSetting } from "../_settings.js";
import { getEpochBySlug, recordWinner } from "../_winners.js";
import { normalizePubkey, verifyWalletAuth } from "../_walletAuth.js";

const router = express.Router();

const ARENA_SLUG = "clawpump-arena";
const DAILY_RUNS = Number(process.env.ARENA_DAILY_RUNS || 5);
const MIN_REWARD_SCORE = Number(process.env.ARENA_MIN_REWARD_SCORE || 5000);
const MIN_REWARD_WAVE = Number(process.env.ARENA_MIN_REWARD_WAVE || 5);

function cleanAlias(value) {
  return String(value || "SIGNAL").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 12) || "SIGNAL";
}

function intInRange(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

async function loadArenaEpoch() {
  const epoch = await getEpochBySlug(ARENA_SLUG);
  if (!epoch) {
    const err = new Error("arena_epoch_not_configured");
    err.status = 503;
    throw err;
  }
  const status = String(epoch.status || "").toLowerCase();
  const now = Date.now();
  const startsAt = epoch.starts_at || epoch.started_at ? new Date(epoch.starts_at || epoch.started_at).getTime() : null;
  const closesAt = epoch.closes_at || epoch.ends_at ? new Date(epoch.closes_at || epoch.ends_at).getTime() : null;
  if (startsAt && startsAt > now) {
    const err = new Error("arena_pending");
    err.status = 423;
    throw err;
  }
  if (["closed", "closing", "paid"].includes(status) || (closesAt && closesAt <= now)) {
    const err = new Error("arena_closed");
    err.status = 423;
    throw err;
  }
  return epoch;
}

async function runSummary(wallet, epochId) {
  if (!hasDatabase || !wallet) return { usedToday: 0, runsLeft: DAILY_RUNS, bestScore: 0, bestWave: 1 };
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [today, best] = await Promise.all([
    query(
      `select count(*)::int as used
       from arena_runs
       where wallet_pubkey = $1 and epoch_id = $2 and created_at >= $3`,
      [wallet, epochId, since]
    ),
    query(
      `select coalesce(max(score), 0)::int as best_score,
              coalesce(max(wave), 1)::int as best_wave
       from arena_runs
       where wallet_pubkey = $1 and epoch_id = $2`,
      [wallet, epochId]
    ),
  ]);
  const usedToday = today.rows[0]?.used || 0;
  return {
    usedToday,
    runsLeft: Math.max(0, DAILY_RUNS - usedToday),
    bestScore: best.rows[0]?.best_score || 0,
    bestWave: best.rows[0]?.best_wave || 1,
  };
}

async function publicSummary(epochId) {
  if (!hasDatabase) return { runs: 0, players: 0, rewardRuns: 0 };
  const result = await query(
    `select count(*)::int as runs,
            count(distinct wallet_pubkey)::int as players,
            count(*) filter (where win)::int as reward_runs
     from arena_runs
     where epoch_id = $1`,
    [epochId]
  );
  return {
    runs: result.rows[0]?.runs || 0,
    players: result.rows[0]?.players || 0,
    rewardRuns: result.rows[0]?.reward_runs || 0,
  };
}

function serializeEpoch(epoch, extra = {}) {
  const startsAt = epoch.starts_at || epoch.started_at;
  const closesAt = epoch.closes_at || epoch.ends_at;
  return {
    slug: epoch.slug,
    title: epoch.title || "ClawPump Arena",
    status: epoch.status,
    pool: Number(epoch.pool_usdc || 0),
    startsAt: startsAt ? new Date(startsAt).getTime() : null,
    closesAt: closesAt ? new Date(closesAt).getTime() : null,
    maxWinners: epoch.max_winners || 10,
    winners: epoch.winners || 0,
    approvedWinners: epoch.approved_winners || 0,
    paidWinners: epoch.paid_winners || 0,
    dailyRuns: DAILY_RUNS,
    minRewardScore: MIN_REWARD_SCORE,
    minRewardWave: MIN_REWARD_WAVE,
    ...extra,
  };
}

router.get("/", async (req, res) => {
  try {
    const epoch = await getEpochBySlug(ARENA_SLUG);
    if (!epoch) return res.status(503).json({ error: "arena_epoch_not_configured" });
    const wallet = req.query.wallet ? normalizePubkey(req.query.wallet) : null;
    const [summary, mine, paused] = await Promise.all([
      publicSummary(epoch.id),
      runSummary(wallet, epoch.id),
      booleanSetting("arena_paused", false),
    ]);
    res.json(serializeEpoch(epoch, { paused, summary, mine }));
  } catch (err) {
    console.error("ARENA STATUS ERROR:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "arena_status_failed" });
  }
});

router.get("/leaderboard", async (req, res) => {
  try {
    if (!hasDatabase) return res.json([]);
    const epoch = await getEpochBySlug(ARENA_SLUG);
    if (!epoch) return res.status(503).json({ error: "arena_epoch_not_configured" });
    const result = await query(
      `select r.alias, r.wallet_pubkey, max(r.score)::int as score, max(r.wave)::int as wave,
              max(r.kills)::int as kills, bool_or(r.win) as reward,
              max(r.created_at) as last_run_at, u.display_name, u.avatar_url
       from arena_runs r
       left join users u on u.wallet_pubkey = r.wallet_pubkey
       where r.epoch_id = $1
       group by r.alias, r.wallet_pubkey, u.display_name, u.avatar_url
       order by score desc, wave desc, kills desc
       limit 25`,
      [epoch.id]
    );
    res.json(result.rows.map((row, index) => ({
      rank: index + 1,
      alias: row.alias,
      displayName: row.display_name || row.alias,
      avatarUrl: row.avatar_url || null,
      wallet: row.wallet_pubkey,
      shortWallet: `${row.wallet_pubkey.slice(0, 4)}...${row.wallet_pubkey.slice(-4)}`,
      score: row.score,
      wave: row.wave,
      kills: row.kills,
      reward: row.reward,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).getTime() : null,
    })));
  } catch (err) {
    console.error("ARENA LEADERBOARD ERROR:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "arena_leaderboard_failed" });
  }
});

router.post("/runs", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    if (await booleanSetting("arena_paused", false)) return res.status(423).json({ error: "arena_paused" });

    const wallet = normalizePubkey(req.body?.pubkey || req.body?.userId);
    const verified = await verifyWalletAuth(wallet, req.body?.walletAuth);
    const epoch = await loadArenaEpoch();
    const before = await runSummary(wallet, epoch.id);
    if (before.runsLeft <= 0) {
      return res.status(429).json({ error: "daily_run_limit", dailyRuns: DAILY_RUNS, runsLeft: 0 });
    }

    const alias = cleanAlias(req.body?.alias);
    const score = intInRange(req.body?.score, 0, 10000000);
    const wave = intInRange(req.body?.wave, 1, 999);
    const kills = intInRange(req.body?.kills, 0, 100000);
    const durationSeconds = intInRange(req.body?.durationSeconds, 0, 86400);
    const qualifies = score >= MIN_REWARD_SCORE && wave >= MIN_REWARD_WAVE;

    const client = await pool.connect();
    let run = null;
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into arena_runs
          (wallet_pubkey, verified_wallet_id, epoch_id, alias, score, wave, kills, duration_seconds,
           win, reward_label, ip_hash, user_agent)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id, score, wave, kills, win`,
        [
          wallet,
          verified.verified_wallet_id || null,
          epoch.id,
          alias,
          score,
          wave,
          kills,
          durationSeconds,
          qualifies,
          qualifies ? "Arena reward qualification pending validation" : null,
          req.ip ? sha256(req.ip) : null,
          req.get?.("user-agent")?.slice(0, 300) || null,
        ]
      );
      run = inserted.rows[0];
      await client.query(
        `insert into guesses
          (wallet_pubkey, user_id, guess, normalized_guess, correct, verified_wallet, verified_wallet_id, epoch_id, source, ip_hash, user_agent)
         values ($1, $1, $2, $2, $3, true, $4, $5, 'arena', $6, $7)`,
        [
          wallet,
          qualifies ? "ARENA_REWARD" : "ARENA_RUN",
          qualifies,
          verified.verified_wallet_id || null,
          epoch.id,
          req.ip ? sha256(req.ip) : null,
          req.get?.("user-agent")?.slice(0, 300) || null,
        ]
      );
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }

    let reward = null;
    if (qualifies) {
      try {
        reward = await recordWinner({
          wallet,
          guessId: null,
          verifiedWalletId: verified.verified_wallet_id,
          epochId: epoch.id,
        });
        await query(
          `update winners
           set source = 'arena',
               notes = coalesce(notes, 'ClawPump Arena reward pending admin validation'),
               display_attempts = coalesce(display_attempts, $3)
           where epoch_id = $1 and wallet_pubkey = $2`,
          [epoch.id, wallet, score]
        );
      } catch (err) {
        if (err.message !== "epoch_winner_limit_reached") throw err;
        await query(`update arena_runs set win = false, reward_label = 'Reward pool filled' where id = $1`, [run.id]);
        run.win = false;
      }
    }

    const after = await runSummary(wallet, epoch.id);
    const summary = await publicSummary(epoch.id);
    res.json({
      ok: true,
      run,
      qualifies: run.win,
      reward,
      runsLeft: Math.max(0, before.runsLeft - 1),
      dailyRuns: DAILY_RUNS,
      mine: after,
      summary,
    });
  } catch (err) {
    console.error("ARENA RUN ERROR:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "arena_run_failed" });
  }
});

export default router;
