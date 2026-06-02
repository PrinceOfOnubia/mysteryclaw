import express from "express";
import { hasDatabase, query } from "../_db.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// MYSTO COMMUNITY DISCOVERIES ENDPOINT
// ═══════════════════════════════════════════════════════════════
//
// Returns a feed of memory fragments saved by investigators across
// the platform. Shown on the /discoveries page.
//
// FRONTEND EXPECTS:
//   Array of objects:
//   [
//     {
//       id: "F-0142",                    // any unique id, e.g. timestamp-based
//       by: "INV_7A2C",                  // short user handle (derive from wallet)
//       quote: "...the verbatim text...",
//       ts: "17:42 UTC"                  // display time string
//     },
//     ...
//   ]
//
// If empty or fails, frontend falls back to hardcoded mock fragments
// (defined in index.html as DISCOVERIES_FALLBACK). So returning [] is
// also fine — frontend won't show an empty page.
// ═══════════════════════════════════════════════════════════════

router.get("/", async (req, res) => {
  try {
    if (!hasDatabase) return res.json([]);

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const result = await query(
      `select id, post, created_at
       from autonomous_posts
       order by created_at desc
       limit $1`,
      [limit]
    );

    return res.json(result.rows.map((row) => ({
      id: row.id,
      by: "MYSTERIO",
      quote: row.post,
      ts: formatTs(row.created_at),
      autonomous: true,
    })));

  } catch (err) {
    console.error("DISCOVERIES ERROR:", err.message);
    res.status(500).json({ error: "discoveries unavailable" });
  }
});

// Optional companion endpoint: POST /discoveries
// to let frontend push saved fragments to the community feed.
// (Currently save-fragment is local-only in frontend localStorage.)
router.post("/", async (req, res) => {
  // TODO: accept { pubkey, quote, category } and store
  return res.json({ ok: true, _stub: true });
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
