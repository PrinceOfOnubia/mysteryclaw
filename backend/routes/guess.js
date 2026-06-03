import express from "express";
import { isHolder } from "../_access.js";
import { getAttemptsForEpoch, getSubmissionEpoch, recordGuess, recordWinner } from "../_winners.js";
import { normalizePubkey, verifyWalletAuth } from "../_walletAuth.js";
import { booleanSetting } from "../_settings.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// 🔒 THE FORGOTTEN WORD
// The current epoch's env var is the sealed verification value for
// Mysterio's private choice. It must never be stored in frontend code,
// echoed back to the client, printed to logs, or treated as team-known.
// ═══════════════════════════════════════════════════════════════
function secretForEpoch(epoch) {
  const envName = epoch?.secret_env_var || (epoch?.slug === "echo" ? "ECHO_SECRET_WORD" : "SECRET_WORD");
  const secret = (process.env[envName] || "").trim().toUpperCase();
  if (!secret) {
    const err = new Error("epoch_answer_not_configured");
    err.status = 503;
    throw err;
  }
  return secret;
}

// ═══════════════════════════════════════════════════════════════
// HOLDER CHECK
// Uses shared isHolder() from ../_access.js (same logic as /holdings).
// Enforced only when REQUIRE_HOLDER=true in env. Echo remains public
// by default through PUBLIC_ECHO_ACCESS=true.
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

    // ─── GATE 2: epoch must be live and not elapsed ───────
    const epoch = await getSubmissionEpoch();

    // ─── Optional holder gate: suspended for Echo public access ────────
    const publicEchoAccess = process.env.PUBLIC_ECHO_ACCESS !== "false";
    if (process.env.REQUIRE_HOLDER === "true" && !(publicEchoAccess && epoch.slug === "echo")) {
      const holder = await isHolder(wallet);
      if (!holder) {
        return res.status(403).json({ error: "not_holder" });
      }
    }

    // ─── GATE 3: attempt limit ────────────────────────────
    const attempts = await getAttemptsForEpoch({ wallet, epochId: epoch.id });
    if (attempts.attemptsLeft <= 0) {
      return res.status(429).json({
        error: "rate_limited",
        attemptsLeft: 0,
        maxAttempts: attempts.max,
      });
    }

    // ─── ACTUAL CHECK ────────────────────────────────────
    const normalized = guess.toUpperCase().trim();
    const secret = secretForEpoch(epoch);
    const correct = normalized === secret;
    const guessRecord = await recordGuess({
      wallet,
      userId,
      guess,
      normalized,
      correct,
      verifiedWallet: true,
      verifiedWalletId: verified.verified_wallet_id,
      epochId: epoch.id,
      source: "website",
      req,
    });

    if (correct) {
      const winInfo = await recordWinner({
        wallet,
        guessId: guessRecord.id,
        verifiedWalletId: verified.verified_wallet_id,
        epochId: epoch.id,
        closeOnWin: epoch.slug === "echo",
      });
      return res.json({
        correct: true,
        success: true,
        message: winInfo.alreadyWinner
          ? "Already recorded. Your share is locked in."
          : epoch.slug === "echo"
            ? "ECHO VERIFIED. First valid website submission is locked pending admin validation."
            : "ACCESS GRANTED. You are a winner of this epoch.",
        epoch: winInfo.epoch,
        epochSlug: winInfo.slug,
        totalWinners: winInfo.totalWinners,
        estimatedShare: winInfo.estimatedShare,
        closesAt: winInfo.closesAt,
        attemptsLeft: attempts.attemptsLeft - 1,
      });
    }

    res.json({
      correct: false,
      success: false,
      message: "Not the word.",
      attemptsLeft: attempts.attemptsLeft - 1,
      maxAttempts: attempts.max,
    });
  } catch (err) {
    console.error("GUESS ERROR:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Guess submission failed" });
  }
});

export default router;
