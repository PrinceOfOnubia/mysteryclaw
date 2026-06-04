import express from "express";
import { auditLog, hasDatabase, query } from "../_db.js";
import { normalizePubkey, verifyWalletAuth } from "../_walletAuth.js";

const router = express.Router();

function cleanDisplayName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length < 2 || name.length > 32) {
    const err = new Error("invalid_display_name");
    err.status = 400;
    throw err;
  }
  if (!/^[a-zA-Z0-9 _.\-]+$/.test(name)) {
    const err = new Error("invalid_display_name");
    err.status = 400;
    throw err;
  }
  return name;
}

function cleanAvatarId(value) {
  const avatar = String(value || "").trim().toLowerCase();
  if (!avatar) return null;
  if (/^nft:[a-z0-9_-]{2,32}$/.test(avatar)) return avatar;
  const err = new Error("invalid_avatar");
  err.status = 400;
  throw err;
}

function cleanBio(value) {
  const bio = String(value || "").trim().replace(/\s+/g, " ");
  if (!bio) return null;
  if (bio.length > 140) {
    const err = new Error("invalid_profile_bio");
    err.status = 400;
    throw err;
  }
  return bio;
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    wallet: row.wallet_pubkey,
    displayName: row.display_name || null,
    avatarUrl: row.avatar_url || null,
    bio: row.profile_bio || null,
    profileUpdatedAt: row.profile_updated_at ? new Date(row.profile_updated_at).getTime() : null,
    stats: {
      guesses: Number(row.guesses || 0),
      correctGuesses: Number(row.correct_guesses || 0),
      wins: Number(row.wins || 0),
      approvedWins: Number(row.approved_wins || 0),
      paidWins: Number(row.paid_wins || 0),
      firstPlayedAt: row.first_played_at ? new Date(row.first_played_at).getTime() : null,
      lastPlayedAt: row.last_played_at ? new Date(row.last_played_at).getTime() : null,
    },
  };
}

router.get("/:wallet", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const wallet = normalizePubkey(req.params.wallet);
    const result = await query(
      `select u.wallet_pubkey, u.display_name, u.avatar_url, u.profile_bio, u.profile_updated_at,
          coalesce(gs.guesses, 0)::int as guesses,
          coalesce(gs.correct_guesses, 0)::int as correct_guesses,
          gs.first_played_at,
          gs.last_played_at,
          coalesce(ws.wins, 0)::int as wins,
          coalesce(ws.approved_wins, 0)::int as approved_wins,
          coalesce(ws.paid_wins, 0)::int as paid_wins
       from users u
       left join lateral (
         select count(*)::int as guesses,
            count(*) filter (where correct)::int as correct_guesses,
            min(created_at) as first_played_at,
            max(created_at) as last_played_at
         from guesses
         where wallet_pubkey = u.wallet_pubkey and source = 'website'
       ) gs on true
       left join lateral (
         select count(*)::int as wins,
            count(*) filter (where approved_at is not null)::int as approved_wins,
            count(*) filter (where paid_at is not null)::int as paid_wins
         from winners
         where wallet_pubkey = u.wallet_pubkey
       ) ws on true
       where u.wallet_pubkey = $1
       limit 1`,
      [wallet]
    );
    const profile = profileFromRow(result.rows[0]);
    if (!profile) return res.status(404).json({ error: "profile_not_found" });
    res.json(profile);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "profile_failed" });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!hasDatabase) return res.status(503).json({ error: "database_not_configured" });
    const { pubkey, walletAuth } = req.body || {};
    if (!pubkey) return res.status(400).json({ error: "pubkey_required" });
    const wallet = normalizePubkey(pubkey);
    await verifyWalletAuth(wallet, walletAuth);

    const displayName = cleanDisplayName(req.body.displayName);
    const avatarUrl = cleanAvatarId(req.body.avatarUrl);
    const bio = cleanBio(req.body.bio);

    const result = await query(
      `insert into users (wallet_pubkey, display_name, avatar_url, profile_bio, profile_updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (wallet_pubkey)
       do update set
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         profile_bio = excluded.profile_bio,
         profile_updated_at = now(),
         last_seen_at = now()
       returning wallet_pubkey, display_name, avatar_url, profile_bio, profile_updated_at`,
      [wallet, displayName, avatarUrl, bio]
    );

    await auditLog("profile_updated", { actor: wallet, wallet_pubkey: wallet });
    res.json({ ok: true, profile: profileFromRow(result.rows[0]) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "profile_update_failed" });
  }
});

export default router;
