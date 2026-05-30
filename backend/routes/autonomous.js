import express from "express";
import { hasDatabase, query } from "../_db.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// AUTONOMOUS POSTS — Pi's self-generated thoughts
// ═══════════════════════════════════════════════════════════════
//
// The agent-runtime autonomous loop posts here every 5 minutes
// with what Pi has been "thinking". Frontend Discoveries page
// reads them and displays in real time.
//
// In-memory store keeps last 200 posts. For production, swap
// for a DB (Postgres, Redis, Mongo).
//
// ENDPOINTS:
//   POST /autonomous     — agent-runtime loop sends a new post
//   GET  /autonomous     — frontend reads recent posts
//
// SECURITY:
//   POST requires a shared secret in `x-agent-key` header. Set
//   AGENT_KEY in your backend .env. The agent-runtime sends the
//   same key from its .env. This prevents random people from
//   posting fake autonomous thoughts.
// ═══════════════════════════════════════════════════════════════

const MAX_POSTS = 200;
const posts = []; // newest first

router.post("/", async (req, res) => {
  try {
    // ─── Auth: shared secret between backend and agent-runtime ───
    const expected = process.env.AGENT_KEY;
    const provided = req.header("x-agent-key");
    if (expected && provided !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }

  const { post, context, ts, earnings, tokenInfo } = req.body || {};
  if (!post || typeof post !== "string") {
    return res.status(400).json({ error: "post required" });
  }
  if (post.length > 600) {
    return res.status(400).json({ error: "post too long (max 600 chars)" });
  }

  const id = "F-AUTO-" + Date.now().toString(36).toUpperCase().slice(-6);
  const entry = {
    id,
    post: post.trim(),
    context: Array.isArray(context) ? context.slice(0, 5) : [],
    ts: ts || new Date().toISOString(),
    earnings: earnings ? {
      total: earnings.totalEarned || 0,
      pending: earnings.totalPending || 0,
    } : null,
    tokenInfo: tokenInfo ? {
      mcap: tokenInfo.marketCap || null,
      vol24h: tokenInfo.volume24h || null,
      holders: tokenInfo.holders || null,
    } : null,
    createdAt: Date.now(),
  };

  if (hasDatabase) {
    await query(
      `insert into autonomous_posts (id, post, context, earnings, token_info, mood, created_at)
       values ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))
       on conflict (id) do nothing`,
      [
        entry.id,
        entry.post,
        JSON.stringify(entry.context),
        entry.earnings ? JSON.stringify(entry.earnings) : null,
        entry.tokenInfo ? JSON.stringify(entry.tokenInfo) : null,
        req.body?.mood || null,
        entry.createdAt,
      ]
    );
  } else {
    posts.unshift(entry);
    if (posts.length > MAX_POSTS) posts.length = MAX_POSTS;
  }

    console.log(`[AUTONOMOUS] ${id}: ${entry.post.slice(0, 80)}...`);
    res.json({ ok: true, id });
  } catch (err) {
    console.error("AUTONOMOUS ERROR:", err.message);
    res.status(500).json({ error: "autonomous_post_failed" });
  }
});

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_POSTS);
    if (hasDatabase) {
      const result = await query(
        `select id, post, earnings, token_info, created_at
         from autonomous_posts
         order by created_at desc
         limit $1`,
        [limit]
      );
      return res.json(result.rows.map((p) => ({
        id: p.id,
        by: "PI · AUTONOMOUS",
        quote: p.post,
        ts: formatTs(p.created_at),
        autonomous: true,
        earnings: p.earnings,
        tokenInfo: p.token_info,
      })));
    }
    // shape compatible with /discoveries so frontend can reuse the same renderer
    const out = posts.slice(0, limit).map(p => ({
      id: p.id,
      by: "PI · AUTONOMOUS",
      quote: p.post,
      ts: formatTs(p.ts),
      autonomous: true,
      earnings: p.earnings,
      tokenInfo: p.tokenInfo,
    }));
    res.json(out);
  } catch (err) {
    console.error("AUTONOMOUS ERROR:", err.message);
    res.status(500).json({ error: "autonomous_feed_failed" });
  }
});

function formatTs(iso) {
  try {
    const d = new Date(iso);
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m} UTC`;
  } catch {
    return "—";
  }
}

export default router;
