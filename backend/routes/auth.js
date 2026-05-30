import express from "express";
import { createWalletChallenge } from "../_walletAuth.js";

const router = express.Router();

router.post("/nonce", async (req, res) => {
  try {
    const { pubkey } = req.body || {};
    if (!pubkey) return res.status(400).json({ error: "pubkey_required" });
    const challenge = await createWalletChallenge(pubkey);
    res.json(challenge);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "nonce_failed" });
  }
});

export default router;
