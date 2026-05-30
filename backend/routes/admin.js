import express from "express";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";

import { auditLog, hasDatabase, query } from "../_db.js";
import { createAdminNonce, verifyAdminLogin, verifyAdminRequest } from "../_adminAuth.js";
import { processPayouts } from "../_payout.js";
import { adminPrizeOverview, approveWinner, publicStatus } from "../_winners.js";
import { getSetting, setSetting } from "../_settings.js";

const router = express.Router();
const TOKEN_LAUNCH_FILE = path.resolve("../agent-runtime/token-launch.json");

const adminLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(adminLimit);

router.post("/api/auth/nonce", (req, res) => {
  try {
    const { pubkey } = req.body || {};
    if (!pubkey) return res.status(400).json({ error: "pubkey_required" });
    res.json(createAdminNonce(pubkey));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "admin_nonce_failed" });
  }
});

router.post("/api/auth/verify", async (req, res) => {
  try {
    const session = await verifyAdminLogin(req.body || {});
    res.json(session);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "admin_login_failed" });
  }
});

router.use(requireAdmin);

router.get("/api/status", async (req, res) => {
  try {
    const [prize, posts, settings] = await Promise.all([
      publicStatus(),
      getAutonomousPosts(10),
      getSettings(),
    ]);

    res.json({
      ok: true,
      database: hasDatabase,
      payoutsEnabled: process.env.PAYOUTS_ENABLED === "true",
      requireHolder: process.env.REQUIRE_HOLDER === "true",
      agent: {
        wallet: process.env.PI_WALLET_PUBKEY || null,
        actionsPaused: settings.agent_actions_paused === "true",
        controlConfigured: Boolean(process.env.AGENT_CONTROL_URL),
      },
      token: getTokenLaunchStatus(),
      prize,
      autonomousPosts: posts,
      settings,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "admin_status_failed" });
  }
});

router.get("/api/prize", async (req, res) => {
  try {
    res.json(await adminPrizeOverview());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "admin_prize_failed" });
  }
});

router.get("/api/payouts", async (req, res) => {
  try {
    const overview = await adminPrizeOverview();
    res.json(overview.payouts || []);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "admin_payouts_failed" });
  }
});

router.get("/api/autonomous", async (req, res) => {
  try {
    res.json(await getAutonomousPosts(100));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "admin_autonomous_failed" });
  }
});

router.get("/api/audit", async (req, res) => {
  try {
    if (!hasDatabase) return res.json([]);
    const result = await query(
      `select id, event_type, actor, wallet_pubkey, details, created_at
       from audit_logs
       order by created_at desc
       limit 100`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "admin_audit_failed" });
  }
});

router.post("/api/winners/:id/approve", async (req, res) => {
  try {
    const winner = await approveWinner(req.params.id, req.adminActor);
    await auditLog("admin_winner_approved", {
      actor: req.adminActor,
      wallet_pubkey: winner.wallet_pubkey,
      winner_id: winner.id,
    });
    res.json({ ok: true, winner });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "winner_approve_failed" });
  }
});

router.post("/api/payout", async (req, res) => {
  try {
    if (req.body?.confirm !== "TRIGGER PAYOUT") {
      return res.status(400).json({ error: "confirmation_required" });
    }
    await auditLog("admin_payout_trigger_requested", { actor: req.adminActor });
    const result = await processPayouts({ requestedBy: req.adminActor });
    await auditLog("admin_payout_trigger_completed", { actor: req.adminActor, result });
    res.json(result);
  } catch (err) {
    console.error("ADMIN PAYOUT ERROR:", err.message);
    res.status(500).json({ error: "payout_trigger_failed" });
  }
});

router.post("/api/token/launch", async (req, res) => {
  try {
    if (req.body?.confirm !== "LAUNCH PIVERSE") {
      return res.status(400).json({ error: "confirmation_required" });
    }

    const token = getTokenLaunchStatus();
    if (token.launched) {
      await auditLog("admin_token_launch_refused_existing_token", { actor: req.adminActor, token });
      return res.status(409).json({ error: "token_already_launched", token });
    }
    if (!process.env.AGENT_CONTROL_URL) {
      await auditLog("admin_token_launch_refused_no_control_url", { actor: req.adminActor });
      return res.status(503).json({
        error: "agent_control_not_configured",
        message: "Set AGENT_CONTROL_URL server-side before launching from admin.",
      });
    }

    const headers = { "Content-Type": "application/json" };
    if (process.env.AGENT_CONTROL_KEY) {
      headers.Authorization = `Bearer ${process.env.AGENT_CONTROL_KEY}`;
    }
    const response = await fetch(`${process.env.AGENT_CONTROL_URL.replace(/\/$/, "")}/launch-token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirm: "LAUNCH PIVERSE" }),
    });
    const text = await response.text();
    await auditLog("admin_token_launch_forwarded", {
      actor: req.adminActor,
      status: response.status,
    });
    res.status(response.status).type("application/json").send(text || "{}");
  } catch (err) {
    await auditLog("admin_token_launch_failed", { actor: req.adminActor, error: err.message });
    res.status(500).json({ error: "token_launch_failed" });
  }
});

router.post("/api/prize/pause", async (req, res) => {
  try {
    const paused = Boolean(req.body?.paused);
    const setting = await setSetting("prize_submissions_paused", paused ? "true" : "false", req.adminActor);
    await auditLog("admin_prize_pause_changed", { actor: req.adminActor, paused });
    res.json({ ok: true, setting });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "prize_pause_failed" });
  }
});

router.post("/api/agent/pause", async (req, res) => {
  try {
    const paused = Boolean(req.body?.paused);
    const setting = await setSetting("agent_actions_paused", paused ? "true" : "false", req.adminActor);
    await auditLog("admin_agent_pause_changed", { actor: req.adminActor, paused });
    res.json({ ok: true, setting, note: "Agent runtime must read this setting or be controlled by AGENT_CONTROL_URL to enforce remote pause." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "agent_pause_failed" });
  }
});

router.post("/api/agent/restart", async (req, res) => {
  try {
    if (!process.env.AGENT_CONTROL_URL) {
      await auditLog("admin_agent_restart_refused_no_control_url", { actor: req.adminActor });
      return res.status(503).json({ error: "agent_control_not_configured" });
    }
    const headers = { "Content-Type": "application/json" };
    if (process.env.AGENT_CONTROL_KEY) {
      headers.Authorization = `Bearer ${process.env.AGENT_CONTROL_KEY}`;
    }
    const response = await fetch(`${process.env.AGENT_CONTROL_URL.replace(/\/$/, "")}/restart`, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirm: "RESTART PI AGENT" }),
    });
    const text = await response.text();
    await auditLog("admin_agent_restart_forwarded", { actor: req.adminActor, status: response.status });
    res.status(response.status).type("application/json").send(text || "{}");
  } catch (err) {
    await auditLog("admin_agent_restart_failed", { actor: req.adminActor, error: err.message });
    res.status(500).json({ error: "agent_restart_failed" });
  }
});

// Backward-compatible route for existing ops scripts.
router.post("/payout", async (req, res) => {
  try {
    await auditLog("admin_payout_trigger_requested", { actor: req.adminActor, legacyRoute: true });
    const result = await processPayouts({ requestedBy: req.adminActor });
    await auditLog("admin_payout_trigger_completed", { actor: req.adminActor, legacyRoute: true, result });
    res.json(result);
  } catch (err) {
    console.error("ADMIN PAYOUT ERROR:", err.message);
    res.status(500).json({ error: "payout_trigger_failed" });
  }
});

function requireAdmin(req, res, next) {
  const admin = verifyAdminRequest(req);
  if (!admin) {
    return res.status(401).json({ error: "unauthorized" });
  }
  req.adminActor = admin.actor;
  req.adminWallet = admin.wallet;
  req.adminAuthMethod = admin.method;
  next();
}

function getTokenLaunchStatus() {
  const mint = process.env.PIVERSE_TOKEN_MINT || process.env.TOKEN_MINT || null;
  const fileExists = fs.existsSync(TOKEN_LAUNCH_FILE);
  return {
    launched: Boolean(mint || fileExists),
    mint,
    launchFilePresent: fileExists,
  };
}

async function getAutonomousPosts(limit) {
  if (!hasDatabase) return [];
  const result = await query(
    `select id, post, mood, earnings, token_info, created_at
     from autonomous_posts
     order by created_at desc
     limit $1`,
    [limit]
  );
  return result.rows;
}

async function getSettings() {
  return {
    prize_submissions_paused: await getSetting("prize_submissions_paused", "false"),
    agent_actions_paused: await getSetting("agent_actions_paused", "false"),
  };
}

export default router;
