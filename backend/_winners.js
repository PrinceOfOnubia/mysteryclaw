// ═══════════════════════════════════════════════════════════════
// WINNERS STORE
// ═══════════════════════════════════════════════════════════════
// Tracks who guessed the word correctly, groups them into 24h
// epochs, and records payout status. Persisted to ./winners.json.
//
// EPOCH MODEL:
//   - The first correct guess starts an epoch (sets startedAt)
//   - All correct guesses within EPOCH_HOURS join that epoch
//   - After the epoch closes, the 1000 USDC pool is split evenly
//   - Once paid, a new epoch can begin on the next correct guess
//
// For production scale, move this to Postgres. For MVP, a JSON
// file with atomic writes is fine.
// ═══════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";

const WINNERS_FILE = path.resolve("./winners.json");

export const POOL_USDC = 1000;            // total prize pool
export const EPOCH_HOURS = 24;            // epoch duration
const EPOCH_MS = EPOCH_HOURS * 60 * 60 * 1000;

const DEFAULT = {
  currentEpoch: 1,
  epochs: {
    // "1": { epoch:1, startedAt:null, closesAt:null, winners:[], paidOut:false, payouts:[] }
  },
};

export function load() {
  try {
    return JSON.parse(fs.readFileSync(WINNERS_FILE, "utf-8"));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
}

export function save(data) {
  // atomic write: write to temp then rename
  const tmp = WINNERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, WINNERS_FILE);
}

function ensureEpoch(data, epochNum) {
  if (!data.epochs[epochNum]) {
    data.epochs[epochNum] = {
      epoch: epochNum,
      startedAt: null,
      closesAt: null,
      winners: [],
      paidOut: false,
      payouts: [],
    };
  }
  return data.epochs[epochNum];
}

// ═══════════════════════════════════════════════════════════════
// Record a correct guess. Returns info about the winner's status.
// Idempotent: a wallet can only win once per epoch.
// ═══════════════════════════════════════════════════════════════
export function recordWinner(pubkey) {
  const data = load();
  const epoch = ensureEpoch(data, data.currentEpoch);

  // start epoch clock on first winner
  const now = Date.now();
  if (!epoch.startedAt) {
    epoch.startedAt = now;
    epoch.closesAt = now + EPOCH_MS;
  }

  // dedup — one win per wallet per epoch
  const already = epoch.winners.find((w) => w.pubkey === pubkey);
  if (already) {
    save(data);
    return {
      epoch: epoch.epoch,
      alreadyWinner: true,
      totalWinners: epoch.winners.length,
      closesAt: epoch.closesAt,
      estimatedShare: POOL_USDC / epoch.winners.length,
    };
  }

  epoch.winners.push({ pubkey, ts: now });
  save(data);

  return {
    epoch: epoch.epoch,
    alreadyWinner: false,
    totalWinners: epoch.winners.length,
    closesAt: epoch.closesAt,
    estimatedShare: POOL_USDC / epoch.winners.length,
  };
}

// ═══════════════════════════════════════════════════════════════
// Find epochs that are closed (past closesAt) but not yet paid out.
// ═══════════════════════════════════════════════════════════════
export function getPayableEpochs() {
  const data = load();
  const now = Date.now();
  const payable = [];
  for (const key of Object.keys(data.epochs)) {
    const e = data.epochs[key];
    if (e.startedAt && !e.paidOut && now >= e.closesAt && e.winners.length > 0) {
      payable.push(e);
    }
  }
  return payable;
}

// ═══════════════════════════════════════════════════════════════
// Mark an epoch as paid and advance to a new epoch.
// payouts: [{ pubkey, amount, signature }]
// ═══════════════════════════════════════════════════════════════
export function markEpochPaid(epochNum, payouts) {
  const data = load();
  const e = data.epochs[epochNum];
  if (!e) return;
  e.paidOut = true;
  e.payouts = payouts;
  e.paidAt = Date.now();
  // open next epoch
  if (epochNum === data.currentEpoch) {
    data.currentEpoch = epochNum + 1;
  }
  save(data);
}

// ═══════════════════════════════════════════════════════════════
// Public status for frontend (no sensitive data).
// ═══════════════════════════════════════════════════════════════
export function publicStatus() {
  const data = load();
  const e = data.epochs[data.currentEpoch];
  if (!e || !e.startedAt) {
    return {
      pool: POOL_USDC,
      epoch: data.currentEpoch,
      status: "open",
      winners: 0,
      closesAt: null,
    };
  }
  const now = Date.now();
  return {
    pool: POOL_USDC,
    epoch: e.epoch,
    status: now >= e.closesAt ? (e.paidOut ? "paid" : "closing") : "active",
    winners: e.winners.length,
    closesAt: e.closesAt,
    estimatedShare: e.winners.length ? POOL_USDC / e.winners.length : POOL_USDC,
  };
}
