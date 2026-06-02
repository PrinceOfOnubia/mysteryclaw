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

export async function recordGuess({ wallet, userId, guess, normalized, correct, verifiedWallet, verifiedWalletId, req }) {
  if (!hasDatabase) return { id: null };

  const result = await query(
    `insert into guesses
      (wallet_pubkey, user_id, guess, normalized_guess, correct, verified_wallet,
       verified_wallet_id, ip_hash, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      wallet,
      userId || null,
      guess,
      normalized,
      correct,
      verifiedWallet,
      verifiedWalletId || null,
      req?.ip ? sha256(req.ip) : null,
      req?.get?.("user-agent")?.slice(0, 300) || null,
    ]
  );
  return result.rows[0];
}

export async function recordWinner({ wallet, guessId, verifiedWalletId }) {
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
    const epoch = await ensureCurrentEpoch(client);

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

    await client.query("commit");

    return {
      epoch: epoch.epoch_number,
      alreadyWinner: inserted.rowCount === 0,
      totalWinners,
      closesAt: epoch.closes_at ? new Date(epoch.closes_at).getTime() : null,
      estimatedShare: totalWinners ? POOL_USDC / totalWinners : POOL_USDC,
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function getPayableEpochs() {
  if (!hasDatabase) return [];
  const result = await query(
    `select
       e.id,
       e.epoch_number as epoch,
       e.pool_usdc,
       e.started_at,
       e.closes_at,
       json_agg(
         json_build_object(
           'id', w.id,
           'pubkey', w.wallet_pubkey,
           'verifiedWalletId', w.verified_wallet_id
         )
         order by w.created_at
       ) as winners
     from prize_epochs e
     join winners w on w.epoch_id = e.id
     where e.closes_at is not null
       and e.closes_at <= now()
       and e.paid_out_at is null
       and w.paid_at is null
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
       and not exists (
         select 1 from winners
         where epoch_id = $1 and paid_at is null
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
      `select e.id, e.epoch_number, e.status, e.pool_usdc, e.started_at, e.closes_at,
          e.paid_out_at, count(w.id)::int as winners
       from prize_epochs e
       left join winners w on w.epoch_id = e.id
       group by e.id
       order by e.epoch_number desc
       limit 20`
    ),
    query(
      `select id, wallet_pubkey, guess, normalized_guess, correct, verified_wallet,
          epoch_id, created_at
       from guesses
       order by created_at desc
       limit 100`
    ),
    query(
      `select w.id, w.wallet_pubkey, w.created_at, w.approved_at, w.approved_by,
          w.paid_at, w.payout_signature, e.epoch_number, g.normalized_guess
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
    `select e.id, e.epoch_number, e.pool_usdc, e.started_at, e.closes_at, e.paid_out_at,
       count(w.id)::int as winners
     from prize_epochs e
     left join winners w on w.epoch_id = e.id
     where e.epoch_number = (
       select coalesce(max(epoch_number), 1) from prize_epochs where paid_out_at is null
     )
     group by e.id
     order by e.epoch_number desc
     limit 1`
  );

  const epoch = result.rows[0] || { epoch_number: 1, pool_usdc: POOL_USDC, winners: 0 };
  const closesAt = epoch.closes_at ? new Date(epoch.closes_at).getTime() : null;
  const now = Date.now();
  const status = epoch.paid_out_at
    ? "paid"
    : closesAt && now >= closesAt
      ? "closing"
      : epoch.started_at
        ? "active"
        : "open";

  return {
    pool: Number(epoch.pool_usdc || POOL_USDC),
    epoch: epoch.epoch_number,
    status,
    winners: epoch.winners || 0,
    closesAt,
    estimatedShare: epoch.winners ? Number(epoch.pool_usdc || POOL_USDC) / epoch.winners : Number(epoch.pool_usdc || POOL_USDC),
  };
}

export async function prizeHistory() {
  if (!hasDatabase) return [];
  const result = await query(
    `select e.epoch_number as epoch, e.paid_out_at,
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
  const existing = await client.query(
    `select *
     from prize_epochs
     where paid_out_at is null
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

  if (!epoch.started_at) {
    const bootstrapElapsedMinutes = epoch.epoch_number === 1
      ? Math.max(0, Math.min(parseInt(process.env.EPOCH_BOOTSTRAP_ELAPSED_MINUTES || "0", 10) || 0, EPOCH_HOURS * 60))
      : 0;
    const started = await client.query(
      `update prize_epochs
       set started_at = now() - ($3::int * interval '1 minute'),
           closes_at = now() + $2::interval - ($3::int * interval '1 minute'),
           status = 'active'
       where id = $1
       returning *`,
      [epoch.id, EPOCH_INTERVAL, bootstrapElapsedMinutes]
    );
    epoch = started.rows[0];
  }

  return epoch;
}
