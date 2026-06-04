import express from "express";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";

import { auditLog, hasDatabase, query } from "../_db.js";
import { createAdminNonce, verifyAdminLogin, verifyAdminRequest } from "../_adminAuth.js";
import { processPayouts } from "../_payout.js";
import { adminPrizeOverview, approveWinner, publicStatus } from "../_winners.js";
import { getSetting, setSetting } from "../_settings.js";
import {
  autonomousPostId,
  clawpumpAgentId,
  clawpumpConfigured,
  getAgentMessages,
  listSkills,
  normalizeAgentMessages,
  sendAgentMessage,
  startAgent,
  stopAgent,
} from "../_clawpump.js";

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
        wallet: process.env.AGENT_WALLET_PUBKEY || null,
        actionsPaused: settings.agent_actions_paused === "true",
        controlConfigured: Boolean(process.env.AGENT_CONTROL_URL),
        clawpumpConfigured: clawpumpConfigured(),
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
    if (req.body?.confirm !== "LAUNCH MYSTO") {
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
      body: JSON.stringify({ confirm: "LAUNCH MYSTO" }),
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

router.post("/api/epochs/echo/live", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const hours = Math.max(1, Math.min(Number(req.body?.hours || 3), 24));
    const result = await query(
      `update prize_epochs
       set status = 'live',
           started_at = coalesce(started_at, now()),
           starts_at = coalesce(starts_at, now()),
           closes_at = now() + ($1::text)::interval,
           ends_at = now() + ($1::text)::interval
       where slug = 'echo'
       returning id, epoch_number, title, slug, status, closes_at`,
      [`${hours} hours`]
    );
    await auditLog("admin_echo_set_live", { actor: req.adminActor, hours });
    res.json({ ok: true, epoch: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "echo_live_failed" });
  }
});

router.post("/api/epochs/echo/countdown", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const launchInMinutes = clampNumber(req.body?.launchInMinutes, 1, 10080, 120);
    const durationHours = clampNumber(req.body?.durationHours, 1, 168, 3);
    const result = await query(
      `update prize_epochs
       set status = 'pending',
           started_at = null,
           starts_at = now() + ($1::text)::interval,
           closes_at = now() + ($1::text)::interval + ($2::text)::interval,
           ends_at = now() + ($1::text)::interval + ($2::text)::interval
       where slug = 'echo'
       returning id, epoch_number, title, slug, status, starts_at, closes_at, max_attempts_per_wallet`,
      [`${launchInMinutes} minutes`, `${durationHours} hours`]
    );
    await auditLog("admin_echo_countdown_reset", {
      actor: req.adminActor,
      launchInMinutes,
      durationHours,
    });
    res.json({ ok: true, epoch: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "echo_countdown_failed" });
  }
});

router.post("/api/epochs/echo/close", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const result = await query(
      `update prize_epochs
       set status = 'closed',
           closes_at = least(coalesce(closes_at, now()), now()),
           ends_at = least(coalesce(ends_at, now()), now())
       where slug = 'echo'
       returning id, epoch_number, title, slug, status, closes_at`,
    );
    await auditLog("admin_echo_closed", { actor: req.adminActor });
    res.json({ ok: true, epoch: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "echo_close_failed" });
  }
});

router.post("/api/epochs", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const title = String(req.body?.title || "").trim();
    const slug = slugify(req.body?.slug || title);
    if (!title) return res.status(400).json({ error: "title_required" });
    if (!slug) return res.status(400).json({ error: "slug_required" });

    const poolUsdc = clampNumber(req.body?.poolUsdc, 0, 1000000, 1000);
    const maxAttempts = clampNumber(req.body?.maxAttemptsPerWallet, 1, 100, 10);
    const maxWinners = clampNumber(req.body?.maxWinners, 1, 1000, 1);
    const payoutSplit = normalizePayoutSplit(req.body?.payoutSplit);
    const launchInMinutes = clampNumber(req.body?.launchInMinutes, 1, 10080, 120);
    const durationHours = clampNumber(req.body?.durationHours, 1, 168, 3);
    const xThreadUrl = String(req.body?.xThreadUrl || "").trim();
    const secretEnvVar = String(req.body?.secretEnvVar || `${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_SECRET_WORD`).trim();
    const tagline = String(req.body?.tagline || "").trim();
    const launchCopy = String(req.body?.launchCopy || "").trim();

    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) return res.status(400).json({ error: "invalid_slug" });
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(secretEnvVar)) return res.status(400).json({ error: "invalid_secret_env_var" });
    if (xThreadUrl && !/^https:\/\/(x\.com|twitter\.com)\//i.test(xThreadUrl)) return res.status(400).json({ error: "invalid_x_thread_url" });

    const result = await query(
      `with next_epoch as (
         select coalesce(max(epoch_number), 0) + 1 as epoch_number from prize_epochs
       )
       insert into prize_epochs (
         epoch_number, title, slug, status, pool_usdc, max_attempts_per_wallet, max_winners, payout_split,
         starts_at, closes_at, ends_at, x_thread_url, secret_env_var, metadata
       )
       select
         next_epoch.epoch_number,
         $1,
         $2,
         'pending',
         $3,
         $4,
         $5,
         $6,
         now() + ($7::text)::interval,
         now() + ($7::text)::interval + ($8::text)::interval,
         now() + ($7::text)::interval + ($8::text)::interval,
         nullif($9, ''),
         $10,
         jsonb_build_object('tagline', $11::text, 'launchCopy', $12::text)
       from next_epoch
       returning id, epoch_number, title, slug, status, starts_at, closes_at,
         pool_usdc, max_attempts_per_wallet, max_winners, payout_split, x_thread_url, secret_env_var, metadata`,
      [
        title,
        slug,
        poolUsdc,
        maxAttempts,
        maxWinners,
        payoutSplit,
        `${launchInMinutes} minutes`,
        `${durationHours} hours`,
        xThreadUrl,
        secretEnvVar,
        tagline,
        launchCopy,
      ]
    );
    await auditLog("admin_epoch_created", {
      actor: req.adminActor,
      epoch: result.rows[0]?.epoch_number,
      slug,
      secretEnvVar,
      maxWinners,
      payoutSplit,
      launchInMinutes,
      durationHours,
    });
    res.json({ ok: true, epoch: result.rows[0] });
  } catch (err) {
    const status = err.code === "23505" ? 409 : (err.status || 500);
    res.status(status).json({ error: err.code === "23505" ? "epoch_slug_or_number_exists" : (err.message || "epoch_create_failed") });
  }
});

router.post("/api/epochs/:slug/rules", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const slug = slugify(req.params.slug);
    if (!slug) return res.status(400).json({ error: "slug_required" });
    const maxWinners = clampNumber(req.body?.maxWinners, 1, 1000, 1);
    const payoutSplit = normalizePayoutSplit(req.body?.payoutSplit);
    const result = await query(
      `update prize_epochs
       set max_winners = $2,
           payout_split = $3
       where slug = $1
         and paid_out_at is null
       returning id, epoch_number, title, slug, status, max_winners, payout_split`,
      [slug, maxWinners, payoutSplit]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "epoch_not_found_or_paid" });
    await auditLog("admin_epoch_rules_updated", {
      actor: req.adminActor,
      slug,
      maxWinners,
      payoutSplit,
    });
    res.json({ ok: true, epoch: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "epoch_rules_update_failed" });
  }
});

router.post("/api/epochs/echo/x-thread", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const url = String(req.body?.xThreadUrl || "").trim();
    const result = await query(
      `update prize_epochs
       set x_thread_url = nullif($1, '')
       where slug = 'echo'
       returning id, epoch_number, title, slug, x_thread_url`,
      [url]
    );
    await auditLog("admin_echo_x_thread_changed", { actor: req.adminActor, xThreadUrl: url || null });
    res.json({ ok: true, epoch: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "echo_x_thread_failed" });
  }
});

router.post("/api/epochs/echo/clues", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const clueNumber = Number(req.body?.clueNumber);
    const postCopy = String(req.body?.postCopy || "").trim();
    if (!Number.isInteger(clueNumber) || clueNumber < 1) return res.status(400).json({ error: "clue_number_required" });
    if (!postCopy) return res.status(400).json({ error: "post_copy_required" });
    const scheduledAt = req.body?.scheduledAt || null;
    const xUrl = req.body?.xUrl || null;
    const status = req.body?.status || "draft";
    const result = await query(
      `insert into epoch_clues (epoch_id, clue_number, scheduled_at, post_copy, x_url, status, posted_at)
       select id, $1, $2::timestamptz, $3, nullif($4, ''), $5,
         case when $5 = 'posted' then coalesce($6::timestamptz, now()) else null end
       from prize_epochs where slug = 'echo'
       on conflict (epoch_id, clue_number)
       do update set
         scheduled_at = excluded.scheduled_at,
         post_copy = excluded.post_copy,
         x_url = excluded.x_url,
         status = excluded.status,
         posted_at = excluded.posted_at,
         updated_at = now()
       returning *`,
      [clueNumber, scheduledAt, postCopy, xUrl, status, req.body?.postedAt || null]
    );
    await auditLog("admin_echo_clue_upserted", { actor: req.adminActor, clueNumber, status });
    res.json({ ok: true, clue: result.rows[0] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "echo_clue_failed" });
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
      body: JSON.stringify({ confirm: "RESTART MYSTERIO AGENT" }),
    });
    const text = await response.text();
    await auditLog("admin_agent_restart_forwarded", { actor: req.adminActor, status: response.status });
    res.status(response.status).type("application/json").send(text || "{}");
  } catch (err) {
    await auditLog("admin_agent_restart_failed", { actor: req.adminActor, error: err.message });
    res.status(500).json({ error: "agent_restart_failed" });
  }
});

router.post("/clawpump/start", async (req, res) => {
  await handleClawpumpAction(req, res, "admin_clawpump_start", startAgent);
});

router.post("/clawpump/stop", async (req, res) => {
  await handleClawpumpAction(req, res, "admin_clawpump_stop", stopAgent);
});

router.post("/clawpump/chat", async (req, res) => {
  await handleClawpumpAction(req, res, "admin_clawpump_chat", () => sendAgentMessage(req.body?.message));
});

router.get("/clawpump/messages", async (req, res) => {
  await handleClawpumpAction(req, res, "admin_clawpump_messages", getAgentMessages);
});

router.get("/clawpump/skills", async (req, res) => {
  await handleClawpumpAction(req, res, "admin_clawpump_skills", listSkills);
});

router.post("/clawpump/sync", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const selectedIds = Array.isArray(req.body?.messageIds)
      ? new Set(req.body.messageIds.map(String))
      : null;
    if (!selectedIds?.size) {
      return res.status(400).json({ error: "message_ids_required" });
    }

    const messages = normalizeAgentMessages(await getAgentMessages());
    const selected = messages.filter((message) => selectedIds.has(message.id));
    const imported = [];
    const skipped = [];

    for (const message of selected) {
      if (message.role && !["assistant", "agent", "mysterio"].includes(message.role)) {
        skipped.push({ messageId: message.id, reason: "not_agent_output" });
        continue;
      }
      if (message.content.length > 600) {
        skipped.push({ messageId: message.id, reason: "post_too_long" });
        continue;
      }
      const id = autonomousPostId(message);
      const result = await query(
        `insert into autonomous_posts (id, post, context, mood, created_at)
         values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))
         on conflict (id) do nothing
         returning id`,
        [
          id,
          message.content,
          JSON.stringify([{ source: "clawpump", messageId: message.id, agentId: clawpumpAgentId() }]),
          "hosted-agent-sync",
          message.createdAt,
        ]
      );
      if (result.rowCount) imported.push({ id, messageId: message.id });
      else skipped.push({ messageId: message.id, reason: "duplicate" });
    }

    await auditLog("admin_clawpump_sync", {
      actor: req.adminActor,
      selected: selectedIds.size,
      imported: imported.length,
      skipped: skipped.length,
    });
    res.json({ ok: true, imported, skipped });
  } catch (err) {
    await auditLog("admin_clawpump_sync_failed", { actor: req.adminActor, error: err.message });
    res.status(err.status || 500).json({ error: err.message || "clawpump_sync_failed" });
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

async function handleClawpumpAction(req, res, eventType, action) {
  try {
    const result = await action();
    await auditLog(eventType, { actor: req.adminActor, ok: true });
    res.json(result);
  } catch (err) {
    await auditLog(`${eventType}_failed`, {
      actor: req.adminActor,
      error: err.message,
      upstreamStatus: err.upstreamStatus,
    });
    res.status(err.status || 500).json({ error: err.message || "clawpump_request_failed" });
  }
}

function getTokenLaunchStatus() {
  const mint = process.env.MYSTO_TOKEN_MINT || process.env.MYST_TOKEN_MINT || process.env.TOKEN_MINT || null;
  const fileExists = fs.existsSync(TOKEN_LAUNCH_FILE);
  return {
    launched: Boolean(mint || fileExists),
    mint,
    launchFilePresent: fileExists,
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizePayoutSplit(value) {
  const clean = String(value || "equal").trim().toLowerCase();
  if (clean === "equal" || clean === "first_winner") return clean;
  const err = new Error("invalid_payout_split");
  err.status = 400;
  throw err;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
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
