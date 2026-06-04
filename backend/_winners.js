import { hasDatabase, pool, query, sha256 } from "./_db.js";

export const POOL_USDC = 1000;
export const EPOCH_HOURS = 3;

const EPOCH_INTERVAL = `${EPOCH_HOURS} hours`;
export function load() {
  return {
    currentEpoch: 1,
    epochs: {
      1: {
        epoch: 1,
        startedAt: null,
        closesAt: null,
        winners: [],
        paidOut: false,
        payouts: [],
      },
    },
  };
}

export async function recordGuess({ wallet, userId, guess, normalized, correct, verifiedWallet, verifiedWalletId, epochId, source = "website", req }) {
  if (!hasDatabase) return { id: null };

  const result = await query(
    `insert into guesses
      (wallet_pubkey, user_id, guess, normalized_guess, correct, verified_wallet,
       verified_wallet_id, epoch_id, source, ip_hash, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      wallet,
      userId || null,
      guess,
      normalized,
      correct,
      verifiedWallet,
      verifiedWalletId || null,
      epochId || null,
      source,
      req?.ip ? sha256(req.ip) : null,
      req?.get?.("user-agent")?.slice(0, 300) || null,
    ]
  );
  return result.rows[0];
}

export async function recordWinner({ wallet, guessId, verifiedWalletId, epochId }) {
  if (!hasDatabase) {
    const err = new Error("database_not_configured");
    err.status = 503;
    throw err;
  }
  if (!verifiedWalletId) {
    const err = new Error("wallet_not_verified");
    err.status = 401;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const epoch = epochId
      ? (await client.query(`select * from prize_epochs where id = $1 for update`, [epochId])).rows[0]
      : await ensureCurrentEpoch(client);
    if (!epoch) {
      const err = new Error("epoch_not_found");
      err.status = 404;
      throw err;
    }
    const maxWinners = Math.max(1, Number(epoch.max_winners || 1));
    const existingWinnerCount = await client.query(
      `select count(*)::int as count
       from winners
       where epoch_id = $1`,
      [epoch.id]
    );
    if (existingWinnerCount.rows[0].count >= maxWinners) {
      const err = new Error("epoch_winner_limit_reached");
      err.status = 409;
      throw err;
    }

    const existingWalletWinner = await client.query(
      `select id from winners where epoch_id = $1 and wallet_pubkey = $2 limit 1`,
      [epoch.id, wallet]
    );
    if (existingWalletWinner.rows[0]) {
      const countResult = await client.query(
        `select count(*)::int as count from winners where epoch_id = $1`,
        [epoch.id]
      );
      await client.query("commit");
      const totalWinners = countResult.rows[0].count;
      return {
        epoch: epoch.epoch_number,
        slug: epoch.slug,
        alreadyWinner: true,
        totalWinners,
        maxWinners,
        winnersRemaining: Math.max(0, maxWinners - totalWinners),
        closesAt: epoch.closes_at ? new Date(epoch.closes_at).getTime() : null,
        estimatedShare: payoutEstimate(epoch.pool_usdc, totalWinners, epoch.payout_split),
        payoutSplit: epoch.payout_split || "equal",
      };
    }

    await client.query(
      `update guesses set epoch_id = $1 where id = $2`,
      [epoch.id, guessId]
    );

    const inserted = await client.query(
      `insert into winners (epoch_id, wallet_pubkey, guess_id, verified_wallet_id)
       values ($1, $2, $3, $4)
       on conflict (epoch_id, wallet_pubkey) do nothing
       returning id`,
      [epoch.id, wallet, guessId, verifiedWalletId]
    );

    const countResult = await client.query(
      `select count(*)::int as count from winners where epoch_id = $1`,
      [epoch.id]
    );
    const totalWinners = countResult.rows[0].count;

    let closesAt = epoch.closes_at;
    const winnerLimitReached = totalWinners >= maxWinners;
    if (winnerLimitReached && inserted.rowCount > 0) {
      const closed = await client.query(
        `update prize_epochs
         set status = 'closed',
             closes_at = least(coalesce(closes_at, now()), now()),
             ends_at = least(coalesce(ends_at, now()), now())
         where id = $1
         returning closes_at`,
        [epoch.id]
      );
      closesAt = closed.rows[0]?.closes_at || closesAt;
    }

    await client.query("commit");

    return {
      epoch: epoch.epoch_number,
      slug: epoch.slug,
      alreadyWinner: inserted.rowCount === 0,
      totalWinners,
      maxWinners,
      winnersRemaining: Math.max(0, maxWinners - totalWinners),
      closesAt: closesAt ? new Date(closesAt).getTime() : null,
      estimatedShare: payoutEstimate(epoch.pool_usdc, totalWinners, epoch.payout_split),
      payoutSplit: epoch.payout_split || "equal",
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

function payoutEstimate(poolUsdc, winnerCount, payoutSplit = "equal") {
  const pool = Number(poolUsdc || POOL_USDC);
  const count = Math.max(1, Number(winnerCount || 1));
  return payoutSplit === "first_winner" ? pool : pool / count;
}

export async function getSubmissionEpoch() {
  if (!hasDatabase) {
    const err = new Error("database_not_configured");
    err.status = 503;
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await ensureCurrentEpoch(client);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  const result = await query(
    `select *
     from prize_epochs
     where status in ('live', 'active', 'open')
       and paid_out_at is null
       and coalesce(closes_at, ends_at) > now()
     order by epoch_number desc
     limit 1`
  );
  const epoch = result.rows[0];
  if (!epoch) {
    const err = new Error("epoch_closed");
    err.status = 423;
    throw err;
  }
  return epoch;
}

export async function getAttemptsForEpoch({ wallet, epochId }) {
  if (!hasDatabase) return { used: 0, max: 10, attemptsLeft: 10 };
  const [countResult, epochResult] = await Promise.all([
    query(
      `select count(*)::int as used
       from guesses
       where wallet_pubkey = $1 and epoch_id = $2 and source = 'website'`,
      [wallet, epochId]
    ),
    query(`select max_attempts_per_wallet from prize_epochs where id = $1`, [epochId]),
  ]);
  const used = countResult.rows[0]?.used || 0;
  const max = epochResult.rows[0]?.max_attempts_per_wallet || 10;
  return { used, max, attemptsLeft: Math.max(0, max - used) };
}

export async function getEpochBySlug(slug) {
  if (!hasDatabase) return null;
  const result = await query(
    `select e.*,
       (select count(*)::int from winners w where w.epoch_id = e.id) as winners,
       (select count(*)::int from winners w where w.epoch_id = e.id and w.approved_at is not null) as approved_winners,
       (select count(*)::int from winners w where w.epoch_id = e.id and w.paid_at is not null) as paid_winners,
       coalesce(json_agg(
         json_build_object(
           'id', c.id,
           'clueNumber', c.clue_number,
           'scheduledAt', c.scheduled_at,
           'postCopy', c.post_copy,
           'xUrl', c.x_url,
           'status', c.status,
           'postedAt', c.posted_at
         )
         order by c.clue_number
       ) filter (where c.id is not null), '[]'::json) as clues
     from prize_epochs e
     left join epoch_clues c on c.epoch_id = e.id
     where e.slug = $1
     group by e.id`,
    [slug]
  );
  return result.rows[0] || null;
}

export async function getPayableEpochs() {
  if (!hasDatabase) return [];
  const result = await query(
    `select
       e.id,
       e.epoch_number as epoch,
       e.slug,
       e.pool_usdc,
       e.payout_split,
       e.started_at,
       e.closes_at,
       json_agg(
         json_build_object(
              'id', w.id,
              'pubkey', w.wallet_pubkey,
              'verifiedWalletId', w.verified_wallet_id,
              'paidAt', w.paid_at
         )
         order by w.created_at
       ) as winners
     from prize_epochs e
     join winners w on w.epoch_id = e.id
     where e.closes_at is not null
       and e.closes_at <= now()
       and e.paid_out_at is null
       and w.approved_at is not null
     group by e.id
     order by e.epoch_number`
  );
  return result.rows;
}

export async function markWinnerPaid({ winnerId, signature }) {
  if (!hasDatabase) return;
  await query(
    `update winners
     set paid_at = now(), payout_signature = $2
     where id = $1 and paid_at is null`,
    [winnerId, signature]
  );
}

export async function markEpochPaid(epochId) {
  if (!hasDatabase) return;
  await query(
    `update prize_epochs
     set paid_out_at = now(), status = 'paid'
     where id = $1
       and (
         (
           payout_split = 'first_winner'
           and exists (
             select 1 from winners
             where id = (
               select id from winners
               where epoch_id = $1 and approved_at is not null
               order by created_at asc
               limit 1
             )
             and paid_at is not null
           )
         )
         or (
           payout_split <> 'first_winner'
           and not exists (
             select 1 from winners
             where epoch_id = $1 and approved_at is not null and paid_at is null
           )
         )
       )`,
    [epochId]
  );
}

export async function approveWinner(winnerId, approvedBy = "admin") {
  if (!hasDatabase) {
    const err = new Error("database_not_configured");
    err.status = 503;
    throw err;
  }
  const result = await query(
    `update winners
     set approved_at = coalesce(approved_at, now()),
         approved_by = coalesce(approved_by, $2)
     where id = $1
     returning id, wallet_pubkey, approved_at, approved_by, paid_at`,
    [winnerId, approvedBy]
  );
  if (!result.rows[0]) {
    const err = new Error("winner_not_found");
    err.status = 404;
    throw err;
  }
  return result.rows[0];
}

export async function unapproveWinner(winnerId) {
  if (!hasDatabase) {
    const err = new Error("database_not_configured");
    err.status = 503;
    throw err;
  }
  const result = await query(
    `update winners
     set approved_at = null,
         approved_by = null
     where id = $1 and paid_at is null
     returning id, wallet_pubkey, approved_at, approved_by, paid_at`,
    [winnerId]
  );
  if (!result.rows[0]) {
    const err = new Error("winner_not_found_or_paid");
    err.status = 404;
    throw err;
  }
  return result.rows[0];
}

export async function unapproveEpochWinners(slug) {
  if (!hasDatabase) {
    const err = new Error("database_not_configured");
    err.status = 503;
    throw err;
  }
  const result = await query(
    `update winners w
     set approved_at = null,
         approved_by = null
     from prize_epochs e
     where w.epoch_id = e.id
       and e.slug = $1
       and w.paid_at is null
     returning w.id, w.wallet_pubkey`,
    [slug]
  );
  return result.rows;
}

export async function upsertManualWinner({ slug, wallet, displayAttempts = 1, notes = "", approvedBy = null }) {
  if (!hasDatabase) {
    const err = new Error("database_not_configured");
    err.status = 503;
    throw err;
  }
  const result = await query(
    `with epoch as (
       select id from prize_epochs where slug = $1 limit 1
     ),
     upsert_guess as (
       insert into guesses (wallet_pubkey, user_id, guess, normalized_guess, correct, verified_wallet, epoch_id, source)
       select $2, $2, 'ADMIN_REWARD', 'ADMIN_REWARD', true, false, id, 'admin'
       from epoch
       where not exists (
         select 1 from guesses
         where epoch_id = (select id from epoch)
           and wallet_pubkey = $2
           and source = 'admin'
           and normalized_guess = 'ADMIN_REWARD'
       )
       returning id
     ),
     guess_row as (
       select id from upsert_guess
       union all
       select id from guesses
       where epoch_id = (select id from epoch)
         and wallet_pubkey = $2
         and source = 'admin'
         and normalized_guess = 'ADMIN_REWARD'
       limit 1
     )
     insert into winners (epoch_id, wallet_pubkey, guess_id, verified_wallet_id, source, notes, display_attempts, approved_at, approved_by)
     select epoch.id, $2, guess_row.id, null, 'admin', nullif($4, ''), $3, null, null
     from epoch, guess_row
     on conflict (epoch_id, wallet_pubkey)
     do update set
       source = 'admin',
       notes = excluded.notes,
       display_attempts = excluded.display_attempts,
       guess_id = coalesce(winners.guess_id, excluded.guess_id)
     returning id, wallet_pubkey, source, notes, display_attempts, approved_at, paid_at`,
    [slug, wallet, displayAttempts, notes]
  );
  if (!result.rows[0]) {
    const err = new Error("epoch_not_found");
    err.status = 404;
    throw err;
  }
  if (approvedBy) return approveWinner(result.rows[0].id, approvedBy);
  return result.rows[0];
}

export async function adminPrizeOverview() {
  if (!hasDatabase) {
    return {
      database: "not_configured",
      epochs: [],
      guesses: [],
      winners: [],
      payouts: [],
    };
  }

  const [epochs, guesses, winners, payouts] = await Promise.all([
    query(
      `select e.id, e.epoch_number, e.title, e.slug, e.status, e.pool_usdc, e.started_at, e.starts_at, e.closes_at, e.ends_at,
       e.max_attempts_per_wallet, e.max_winners, e.payout_split, e.x_thread_url,
          e.paid_out_at, count(w.id)::int as winners
       from prize_epochs e
       left join winners w on w.epoch_id = e.id
       group by e.id
       order by e.epoch_number desc
       limit 20`
    ),
    query(
      `select g.id, g.wallet_pubkey, g.guess, g.normalized_guess, g.correct, g.verified_wallet,
          g.epoch_id, g.source, g.created_at, e.epoch_number, e.slug
       from guesses g
       left join prize_epochs e on e.id = g.epoch_id
       order by created_at desc
       limit 100`
    ),
    query(
      `select w.id, w.wallet_pubkey, w.created_at, w.approved_at, w.approved_by,
          w.paid_at, w.payout_signature, w.source, w.notes, w.display_attempts,
          e.epoch_number, e.slug, g.normalized_guess
       from winners w
       join prize_epochs e on e.id = w.epoch_id
       left join guesses g on g.id = w.guess_id
       order by w.created_at desc
       limit 100`
    ),
    query(
      `select id, winner_id, epoch_id, wallet_pubkey, amount_usdc, status,
          signature, error, requested_by, created_at, confirmed_at
       from payout_attempts
       order by created_at desc
       limit 100`
    ),
  ]);

  return {
    epochs: epochs.rows,
    guesses: guesses.rows,
    winners: winners.rows,
    payouts: payouts.rows,
  };
}

export async function publicStatus() {
  if (!hasDatabase) {
    return {
      pool: POOL_USDC,
      epoch: 1,
      status: "open",
      winners: 0,
      approvedWinners: 0,
      paidWinners: 0,
      maxWinners: 1,
      payoutSplit: "equal",
      closesAt: null,
      estimatedShare: POOL_USDC,
      database: "not_configured",
    };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await ensureCurrentEpoch(client);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  const result = await query(
    `select e.id, e.epoch_number, e.pool_usdc, e.status, e.started_at, e.starts_at, e.closes_at, e.ends_at, e.paid_out_at,
       e.title, e.slug, e.max_attempts_per_wallet, e.max_winners, e.payout_split, e.x_thread_url, e.metadata,
       count(w.id)::int as winners,
       count(w.id) filter (where w.approved_at is not null)::int as approved_winners,
       count(w.id) filter (where w.paid_at is not null)::int as paid_winners
     from prize_epochs e
     left join winners w on w.epoch_id = e.id
     where e.epoch_number = (
       select coalesce(max(epoch_number), 1)
       from prize_epochs
       where paid_out_at is null
     )
     group by e.id
     order by e.epoch_number desc
     limit 1`
  );

  const epoch = result.rows[0] || { epoch_number: 1, pool_usdc: POOL_USDC, winners: 0 };
  const startsAt = epoch.starts_at ? new Date(epoch.starts_at).getTime() : null;
  const closesAt = (epoch.closes_at || epoch.ends_at) ? new Date(epoch.closes_at || epoch.ends_at).getTime() : null;
  const now = Date.now();
  let status = epoch.status || "open";
  if (epoch.paid_out_at) {
    status = "paid";
  } else if (closesAt && now >= closesAt) {
    status = "closing";
  } else if (startsAt && now < startsAt) {
    status = "pending";
  } else if (["live", "active", "open"].includes(status)) {
    status = "active";
  }

  return {
    pool: Number(epoch.pool_usdc || POOL_USDC),
    epoch: epoch.epoch_number,
    title: epoch.title || `Epoch ${epoch.epoch_number}`,
    slug: epoch.slug || null,
    status,
    startsAt,
    winners: epoch.winners || 0,
    approvedWinners: epoch.approved_winners || 0,
    paidWinners: epoch.paid_winners || 0,
    closesAt,
    maxAttemptsPerWallet: epoch.max_attempts_per_wallet || 10,
    maxWinners: epoch.max_winners || 1,
    payoutSplit: epoch.payout_split || "equal",
    xThreadUrl: epoch.x_thread_url || null,
    metadata: epoch.metadata || {},
    estimatedShare: payoutEstimate(epoch.pool_usdc, epoch.winners, epoch.payout_split),
  };
}

export async function prizeHistory() {
  if (!hasDatabase) return [];
  const result = await query(
    `select e.epoch_number as epoch, e.paid_out_at,
       e.slug,
       count(w.id)::int as winners,
       coalesce(json_agg(
         json_build_object(
           'pubkey', w.wallet_pubkey,
           'amount', p.amount_usdc,
           'signature', coalesce(w.payout_signature, p.signature)
         )
       ) filter (where w.id is not null), '[]'::json) as payouts
     from prize_epochs e
     left join winners w on w.epoch_id = e.id
     left join payout_attempts p on p.winner_id = w.id and p.status = 'confirmed'
     where e.paid_out_at is not null
     group by e.id
     order by e.epoch_number desc
     limit 20`
  );
  return result.rows.map((epoch) => ({
    epoch: epoch.epoch,
    winners: epoch.winners,
    paidAt: epoch.paid_out_at ? new Date(epoch.paid_out_at).getTime() : null,
    payouts: epoch.payouts.map((p) => ({
      pubkey: `${p.pubkey.slice(0, 4)}...${p.pubkey.slice(-4)}`,
      amount: Number(p.amount || 0),
      signature: p.signature,
    })),
  }));
}

async function ensureCurrentEpoch(client) {
  const active = await client.query(
    `select *
     from prize_epochs
     where status in ('live', 'active')
       and paid_out_at is null
       and coalesce(starts_at, started_at, now()) <= now()
       and coalesce(closes_at, ends_at) > now()
     order by epoch_number desc
     limit 1`
  );
  if (active.rows[0]) return active.rows[0];

  const existing = await client.query(
    `select *
     from prize_epochs
     where paid_out_at is null
       and status not in ('closed', 'paid')
     order by epoch_number desc
     limit 1`
  );

  let epoch = existing.rows[0];
  if (!epoch) {
    const next = await client.query(
      `insert into prize_epochs (epoch_number, status)
       values ((select coalesce(max(epoch_number), 0) + 1 from prize_epochs), 'open')
       returning *`
    );
    epoch = next.rows[0];
  }

  if (epoch.starts_at && new Date(epoch.starts_at).getTime() > Date.now()) {
    return epoch;
  }

  if (!epoch.started_at) {
    const bootstrapElapsedMinutes = epoch.epoch_number === 1
      ? Math.max(0, Math.min(parseInt(process.env.EPOCH_BOOTSTRAP_ELAPSED_MINUTES || "0", 10) || 0, EPOCH_HOURS * 60))
      : 0;
    const started = await client.query(
      `update prize_epochs
       set started_at = now() - ($3::int * interval '1 minute'),
           closes_at = now() + $2::interval - ($3::int * interval '1 minute'),
           status = case when status = 'pending' then 'live' else 'active' end
       where id = $1
       returning *`,
      [epoch.id, EPOCH_INTERVAL, bootstrapElapsedMinutes]
    );
    epoch = started.rows[0];
  }

  return epoch;
}
