import express from "express";
import { processPayouts } from "../_payout.js";

const router = express.Router();

router.post("/payout", async (req, res) => {
  try {
    const expected = process.env.ADMIN_KEY;
    const provided = req.header("x-admin-key");
    if (!expected || provided !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const result = await processPayouts({ requestedBy: "admin" });
    res.json(result);
  } catch (err) {
    console.error("ADMIN PAYOUT ERROR:", err.message);
    res.status(500).json({ error: "payout_trigger_failed" });
  }
});

export default router;
