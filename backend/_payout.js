// ═══════════════════════════════════════════════════════════════
// PAYOUT ENGINE
// ═══════════════════════════════════════════════════════════════
// Sends USDC from the treasury wallet to epoch winners, split evenly.
//
// SAFETY DESIGN (this moves real money):
//   - Runs only when PAYOUTS_ENABLED=true (off by default)
//   - Verifies treasury USDC balance >= total payout before sending
//   - Creates recipient ATAs if they don't exist (idempotent)
//   - Sends one tx per winner, confirms each, records signature
//   - Marks epoch paid ONLY after all transfers confirmed
//   - On any failure mid-batch, stops and leaves epoch unpaid for
//     manual review (no partial-paid silent state)
//
// Required env:
//   TREASURY_PRIVKEY   base58 secret key of treasury wallet
//   USDC_MINT          mainnet USDC mint
//   SOLANA_RPC         paid RPC endpoint
//   PAYOUTS_ENABLED    "true" to actually send
// ═══════════════════════════════════════════════════════════════

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

import { getPayableEpochs, markEpochPaid, POOL_USDC } from "./_winners.js";

const USDC_DECIMALS = 6;

// ═══════════════════════════════════════════════════════════════
// Main: process all payable epochs. Call this on a schedule.
// ═══════════════════════════════════════════════════════════════
export async function processPayouts() {
  const epochs = getPayableEpochs();
  if (!epochs.length) return { processed: 0 };

  // Hard gate — never send real money unless explicitly enabled.
  if (process.env.PAYOUTS_ENABLED !== "true") {
    console.log(`[payout] ${epochs.length} epoch(s) ready but PAYOUTS_ENABLED != true. Skipping.`);
    for (const e of epochs) {
      const share = POOL_USDC / e.winners.length;
      console.log(`[payout]   epoch ${e.epoch}: ${e.winners.length} winners × ${share} USDC (DRY RUN)`);
    }
    return { processed: 0, dryRun: true, epochs: epochs.length };
  }

  // Validate config. Keep these checks before any keypair/RPC work.
  for (const key of ["TREASURY_PRIVKEY", "SOLANA_RPC", "USDC_MINT"]) {
    if (!process.env[key]) {
      console.error(`[payout] missing env ${key} — aborting`);
      return { processed: 0, error: `missing ${key}` };
    }
  }

  const conn = new Connection(process.env.SOLANA_RPC, "confirmed");
  const treasury = Keypair.fromSecretKey(bs58.decode(process.env.TREASURY_PRIVKEY));
  const usdcMint = new PublicKey(process.env.USDC_MINT);

  let processed = 0;

  for (const epoch of epochs) {
    try {
      await payEpoch(conn, treasury, usdcMint, epoch);
      processed++;
    } catch (e) {
      console.error(`[payout] epoch ${epoch.epoch} FAILED:`, e.message);
      // stop — do not continue to other epochs on failure
      break;
    }
  }

  return { processed };
}

async function payEpoch(conn, treasury, usdcMint, epoch) {
  const winnerCount = epoch.winners.length;
  const shareUi = POOL_USDC / winnerCount;
  const shareRaw = Math.floor(shareUi * Math.pow(10, USDC_DECIMALS));

  console.log(`[payout] epoch ${epoch.epoch}: paying ${winnerCount} winners ${shareUi} USDC each`);

  // ─── 1. Verify treasury balance ──────────────────────────────
  const treasuryAta = await getAssociatedTokenAddress(usdcMint, treasury.publicKey);
  let treasuryBalRaw;
  try {
    const acct = await getAccount(conn, treasuryAta);
    treasuryBalRaw = Number(acct.amount);
  } catch (e) {
    throw new Error("treasury USDC account not found or unreadable");
  }
  const needed = shareRaw * winnerCount;
  if (treasuryBalRaw < needed) {
    throw new Error(
      `insufficient treasury USDC: have ${treasuryBalRaw / 1e6}, need ${needed / 1e6}`
    );
  }

  // ─── 2. Send to each winner ──────────────────────────────────
  const payouts = [];
  for (const winner of epoch.winners) {
    const recipient = new PublicKey(winner.pubkey);
    const recipientAta = await getAssociatedTokenAddress(usdcMint, recipient);

    const tx = new Transaction();

    // create recipient ATA if missing (treasury pays the rent)
    let needsAta = false;
    try {
      await getAccount(conn, recipientAta);
    } catch (e) {
      if (e instanceof TokenAccountNotFoundError) {
        needsAta = true;
      } else {
        throw e;
      }
    }
    if (needsAta) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          treasury.publicKey,  // payer
          recipientAta,        // ata
          recipient,           // owner
          usdcMint             // mint
        )
      );
    }

    // transfer
    tx.add(
      createTransferCheckedInstruction(
        treasuryAta,           // from
        usdcMint,              // mint
        recipientAta,          // to
        treasury.publicKey,    // owner of from
        shareRaw,              // amount (raw)
        USDC_DECIMALS          // decimals
      )
    );

    const sig = await conn.sendTransaction(tx, [treasury]);
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`[payout]   ✓ ${winner.pubkey.slice(0, 8)}... → ${shareUi} USDC  (${sig})`);
    payouts.push({ pubkey: winner.pubkey, amount: shareUi, signature: sig });
  }

  // ─── 3. Mark epoch paid (only after all confirmed) ───────────
  markEpochPaid(epoch.epoch, payouts);
  console.log(`[payout] epoch ${epoch.epoch} COMPLETE — ${payouts.length} payouts recorded`);
}
