import express from "express";
import { isHolder } from "../_access.js";
import { recordGuess, recordWinner } from "../_winners.js";
import { normalizePubkey, verifyWalletAuth } from "../_walletAuth.js";
import { booleanSetting } from "../_settings.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// 🔒 THE FORGOTTEN WORD
// Set SECRET_WORD in Railway for production. Keep the fallback only for local
// development so the public repo never contains the live winning word.
// ═══════════════════════════════════════════════════════════════
const SECRET = (process.env.SECRET_WORD || "LOCAL_ONLY_SECRET").trim().toUpperCase();

// ═══════════════════════════════════════════════════════════════
// RATE LIMITING
// 10 attempts per wallet per 3-hour game session.
// Resets 3h after the first attempt that hit the limit.
// In-memory store — moves to Redis/Postgres for production.
// ═══════════════════════════════════════════════════════════════
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 3 * 60 * 60 * 1000;

const guessLog = {}; // pubkey → array of timestamps

function checkRateLimit(pubkey) {
  if (!pubkey) return { allowed: true, attemptsLeft: MAX_ATTEMPTS };
  const now = Date.now();
  if (!guessLog[pubkey]) guessLog[pubkey] = [];
  // drop old timestamps outside window
  guessLog[pubkey] = guessLog[pubkey].filter((ts) => now - ts < WINDOW_MS);
  const used = guessLog[pubkey].length;
  if (used >= MAX_ATTEMPTS) {
    const oldest = guessLog[pubkey][0];
    const cooldownMs = WINDOW_MS - (now - oldest);
    return {
      allowed: false,
      attemptsLeft: 0,
      cooldownHours: Math.ceil(cooldownMs / (60 * 60 * 1000)),
      minutesLeft: Math.ceil(cooldownMs / 60000),
    };
  }
  return { allowed: true, attemptsLeft: MAX_ATTEMPTS - used };
}

function recordAttempt(pubkey) {
  if (!pubkey) return;
  if (!guessLog[pubkey]) guessLog[pubkey] = [];
  guessLog[pubkey].push(Date.now());
}

// ═══════════════════════════════════════════════════════════════
// HOLDER CHECK
// Uses shared isHolder() from ../_access.js (same logic as /holdings).
// Enforced only when REQUIRE_HOLDER=true in env. In dev (default),
// the gate below is skipped so testing isn't blocked.
// ═══════════════════════════════════════════════════════════════

router.post("/", async (req, res) => {
  try {
    const { guess, pubkey, userId, walletAuth } = req.body;
    const rawWallet = pubkey || userId;

    if (!guess || typeof guess !== "string") {
      return res.status(400).json({ error: "Guess required" });
    }
    if (guess.length > 100 || guess.includes(" ")) {
      return res.status(400).json({ error: "One word, max 100 chars" });
    }

    // ─── GATE 1: must be connected & valid pubkey ────────
    if (!rawWallet) {
      return res.status(401).json({ error: "wallet_required" });
    }
    if (await booleanSetting("prize_submissions_paused", false)) {
      return res.status(423).json({ error: "prize_submissions_paused" });
    }
    const wallet = normalizePubkey(rawWallet);

    const verified = await verifyWalletAuth(wallet, walletAuth);

    // ─── GATE 2: must be a holder (when enforced) ────────
    if (process.env.REQUIRE_HOLDER === "true") {
      const holder = await isHolder(wallet);
      if (!holder) {
        return res.status(403).json({ error: "not_holder" });
      }
    }

    // ─── GATE 3: rate limit ──────────────────────────────
    const rl = checkRateLimit(wallet);
    if (!rl.allowed) {
      return res.status(429).json({
        error: "rate_limited",
        cooldownHours: rl.cooldownHours,
        minutesLeft: rl.minutesLeft,
      });
    }

    // Record this attempt BEFORE checking — so failed AND successful
    // both count toward the limit.
    recordAttempt(wallet);

    // ─── ACTUAL CHECK ────────────────────────────────────
    const normalized = guess.toUpperCase().trim();
    const correct = normalized === SECRET;
    const guessRecord = await recordGuess({
      wallet,
      userId,
      guess,
      normalized,
      correct,
      verifiedWallet: true,
      verifiedWalletId: verified.verified_wallet_id,
      req,
    });

    if (correct) {
      // Record into the current 3h epoch. Real payouts require a later
      // admin-only trigger and PAYOUTS_ENABLED=true.
      const winInfo = await recordWinner({
        wallet,
        guessId: guessRecord.id,
        verifiedWalletId: verified.verified_wallet_id,
      });
      return res.json({
        correct: true,
        success: true,
        word: SECRET,
        message: winInfo.alreadyWinner
          ? "Already recorded. Your share is locked in."
          : "ACCESS GRANTED. You are a winner of this epoch.",
        epoch: winInfo.epoch,
        totalWinners: winInfo.totalWinners,
        estimatedShare: winInfo.estimatedShare,
        closesAt: winInfo.closesAt,
        attemptsLeft: rl.attemptsLeft - 1,
      });
    }

    res.json({
      correct: false,
      success: false,
      message: "Not the word.",
      attemptsLeft: rl.attemptsLeft - 1,
    });
  } catch (err) {
    console.error("GUESS ERROR:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Guess submission failed" });
  }
});

export default router;
