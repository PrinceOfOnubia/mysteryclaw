import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import bs58 from "bs58";

import { auditLog, hasDatabase, pool } from "./_db.js";
import { getPayableEpochs, markEpochPaid, markWinnerPaid, POOL_USDC } from "./_winners.js";

const USDC_DECIMALS = 6;

export async function processPayouts({ requestedBy = "admin" } = {}) {
  if (process.env.PAYOUTS_ENABLED !== "true") {
    await auditLog("payout_skipped_disabled", { actor: requestedBy });
    return { processed: 0, dryRun: true, reason: "PAYOUTS_ENABLED is not true" };
  }

  for (const key of ["TREASURY_PRIVKEY", "SOLANA_RPC", "USDC_MINT", "DATABASE_URL"]) {
    if (!process.env[key]) {
      await auditLog("payout_blocked_missing_env", { actor: requestedBy, missing: key });
      return { processed: 0, error: `missing ${key}` };
    }
  }
  if (!hasDatabase) return { processed: 0, error: "database_not_configured" };

  const epochs = await getPayableEpochs();
  if (!epochs.length) return { processed: 0 };

  const conn = new Connection(process.env.SOLANA_RPC, "confirmed");
  const treasury = Keypair.fromSecretKey(bs58.decode(process.env.TREASURY_PRIVKEY));
  const usdcMint = new PublicKey(process.env.USDC_MINT);

  let processed = 0;
  for (const epoch of epochs) {
    try {
      await payEpoch(conn, treasury, usdcMint, epoch, requestedBy);
      processed++;
    } catch (err) {
      await auditLog("payout_epoch_failed", {
        actor: requestedBy,
        epoch: epoch.epoch,
        error: err.message,
      });
      break;
    }
  }

  return { processed };
}

async function payEpoch(conn, treasury, usdcMint, epoch, requestedBy) {
  const winnerCount = epoch.winners.length;
  const shareUi = POOL_USDC / winnerCount;
  const shareRaw = Math.floor(shareUi * Math.pow(10, USDC_DECIMALS));
  const treasuryAta = await getAssociatedTokenAddress(usdcMint, treasury.publicKey);

  let treasuryBalRaw;
  try {
    const acct = await getAccount(conn, treasuryAta);
    treasuryBalRaw = Number(acct.amount);
  } catch {
    throw new Error("treasury USDC account not found or unreadable");
  }

  const needed = shareRaw * winnerCount;
  if (treasuryBalRaw < needed) {
    throw new Error(`insufficient treasury USDC: have ${treasuryBalRaw / 1e6}, need ${needed / 1e6}`);
  }

  for (const winner of epoch.winners) {
    if (!winner.verifiedWalletId) throw new Error(`winner ${winner.id} has no verified wallet`);
    await payWinner({
      conn,
      treasury,
      treasuryAta,
      usdcMint,
      epoch,
      winner,
      shareUi,
      shareRaw,
      requestedBy,
    });
  }

  await markEpochPaid(epoch.id);
  await auditLog("payout_epoch_complete", { actor: requestedBy, epoch: epoch.epoch });
}

async function payWinner({ conn, treasury, treasuryAta, usdcMint, epoch, winner, shareUi, shareRaw, requestedBy }) {
  const idempotencyKey = `winner:${winner.id}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const lock = await client.query(
      `select id, paid_at from winners where id = $1 for update`,
      [winner.id]
    );
    if (!lock.rows[0] || lock.rows[0].paid_at) {
      await client.query("commit");
      return;
    }

    const existing = await client.query(
      `select status, signature from payout_attempts where idempotency_key = $1`,
      [idempotencyKey]
    );
    if (existing.rows.some((row) => row.status === "confirmed")) {
      await client.query("commit");
      return;
    }

    await client.query(
      `insert into payout_attempts
        (winner_id, epoch_id, wallet_pubkey, amount_usdc, status, idempotency_key, requested_by)
       values ($1, $2, $3, $4, 'pending', $5, $6)
       on conflict (idempotency_key) do nothing`,
      [winner.id, epoch.id, winner.pubkey, shareUi, idempotencyKey, requestedBy]
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  try {
    const recipient = new PublicKey(winner.pubkey);
    const recipientAta = await getAssociatedTokenAddress(usdcMint, recipient);
    const tx = new Transaction();

    let needsAta = false;
    try {
      await getAccount(conn, recipientAta);
    } catch (err) {
      if (err instanceof TokenAccountNotFoundError) {
        needsAta = true;
      } else {
        throw err;
      }
    }

    if (needsAta) {
      tx.add(createAssociatedTokenAccountInstruction(treasury.publicKey, recipientAta, recipient, usdcMint));
    }

    tx.add(
      createTransferCheckedInstruction(
        treasuryAta,
        usdcMint,
        recipientAta,
        treasury.publicKey,
        shareRaw,
        USDC_DECIMALS
      )
    );

    const sig = await conn.sendTransaction(tx, [treasury]);
    await conn.confirmTransaction(sig, "confirmed");

    await markWinnerPaid({ winnerId: winner.id, signature: sig });
    await pool.query(
      `update payout_attempts
       set status = 'confirmed', signature = $2, confirmed_at = now()
       where idempotency_key = $1`,
      [idempotencyKey, sig]
    );
    await auditLog("payout_winner_confirmed", {
      actor: requestedBy,
      wallet_pubkey: winner.pubkey,
      epoch: epoch.epoch,
      signature: sig,
      amount_usdc: shareUi,
    });
  } catch (err) {
    await pool.query(
      `update payout_attempts
       set status = 'failed', error = $2
       where idempotency_key = $1 and status <> 'confirmed'`,
      [idempotencyKey, err.message.slice(0, 500)]
    );
    await auditLog("payout_winner_failed", {
      actor: requestedBy,
      wallet_pubkey: winner.pubkey,
      epoch: epoch.epoch,
      error: err.message,
    });
    throw err;
  }
}
