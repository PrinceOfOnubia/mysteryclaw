import express from "express";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// PIVERSE COMMUNITY DISCOVERIES ENDPOINT
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
    // ─────────────────────────────────────────────────────────
    // TODO (BACKEND DEV): query your DB for saved fragments
    // ─────────────────────────────────────────────────────────
    //
    // Suggested schema (Postgres / Mongo / Redis):
    //   fragments {
    //     id: string,
    //     userId: string (wallet pubkey),
    //     quote: text,
    //     category: enum('clue','keyword','contradiction'),
    //     createdAt: timestamp,
    //   }
    //
    // For investigator handle: hash the pubkey or take last 4 chars
    //   const handle = "INV_" + pubkey.slice(-4).toUpperCase();
    //
    // Suggested query: SELECT * FROM fragments
    //                  ORDER BY createdAt DESC LIMIT 30;
    //
    // Optional: support ?category=clue|keyword|contradiction filter
    // Optional: support ?limit=N (default 20)
    // ─────────────────────────────────────────────────────────

    // STUB: return empty so frontend uses its mock fallback
    return res.json([]);

  } catch (err) {
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

export default router;
