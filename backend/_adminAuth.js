import crypto from "crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { auditLog } from "./_db.js";
import { normalizePubkey } from "./_walletAuth.js";

const ADMIN_NONCE_TTL_MS = 5 * 60 * 1000;
const ADMIN_SESSION_TTL_SECONDS = 30 * 60;
const adminNonces = new Map();

export function createAdminNonce(pubkey) {
  const wallet = normalizePubkey(pubkey);
  const nonce = crypto.randomBytes(24).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ADMIN_NONCE_TTL_MS);
  const message = [
    "MysteryClaw admin login",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    "Purpose: access private MysteryClaw admin controls.",
  ].join("\n");

  adminNonces.set(hash(nonce), {
    wallet,
    message,
    expiresAt,
    consumed: false,
  });

  return { pubkey: wallet, nonce, message, expiresAt: expiresAt.toISOString() };
}

export async function verifyAdminLogin({ pubkey, nonce, message, signature }) {
  const adminWallet = process.env.ADMIN_WALLET ? normalizePubkey(process.env.ADMIN_WALLET) : null;
  if (!adminWallet) {
    const err = new Error("admin_wallet_not_configured");
    err.status = 503;
    throw err;
  }
  if (!process.env.ADMIN_SESSION_SECRET && !process.env.ADMIN_KEY) {
    const err = new Error("admin_session_secret_not_configured");
    err.status = 503;
    throw err;
  }

  const wallet = normalizePubkey(pubkey);
  if (wallet !== adminWallet) {
    await auditLog("admin_login_rejected_wrong_wallet", { actor: wallet, wallet_pubkey: wallet });
    const err = new Error("admin_wallet_required");
    err.status = 403;
    throw err;
  }

  const nonceRecord = adminNonces.get(hash(nonce));
  if (!nonceRecord || nonceRecord.wallet !== wallet || nonceRecord.message !== message) {
    const err = new Error("admin_nonce_invalid");
    err.status = 401;
    throw err;
  }
  if (nonceRecord.consumed) {
    const err = new Error("admin_nonce_used");
    err.status = 401;
    throw err;
  }
  if (nonceRecord.expiresAt.getTime() < Date.now()) {
    const err = new Error("admin_nonce_expired");
    err.status = 401;
    throw err;
  }

  const sig = parseSignature(signature);
  const ok = nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    sig,
    new PublicKey(wallet).toBytes()
  );
  if (!ok) {
    await auditLog("admin_login_rejected_bad_signature", { actor: wallet, wallet_pubkey: wallet });
    const err = new Error("admin_signature_invalid");
    err.status = 401;
    throw err;
  }

  nonceRecord.consumed = true;
  await auditLog("admin_login_verified", { actor: wallet, wallet_pubkey: wallet });
  return createAdminSession(wallet);
}

export function verifyAdminRequest(req) {
  const bearer = parseBearer(req.header("authorization"));
  if (!bearer) return null;

  const session = verifyAdminSession(bearer);
  if (session) return { actor: session.sub, wallet: session.sub, method: "wallet_session" };

  const expected = process.env.ADMIN_KEY;
  if (expected && safeEqual(bearer, expected)) {
    return { actor: "admin_key", wallet: null, method: "admin_key" };
  }
  return null;
}

function createAdminSession(wallet) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "mysteryclaw-admin",
    aud: "mysteryclaw-admin",
    sub: wallet,
    iat: now,
    exp: now + ADMIN_SESSION_TTL_SECONDS,
  };
  return {
    token: signJwt(payload),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    pubkey: wallet,
  };
}

function verifyAdminSession(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = hmac(`${encodedHeader}.${encodedPayload}`);
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (payload.iss !== "mysteryclaw-admin" || payload.aud !== "mysteryclaw-admin") return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmac(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function hmac(value) {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(value)
    .digest("base64url");
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_KEY;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function parseBearer(header) {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (!/^Bearer$/i.test(scheme || "")) return null;
  return rest.join(" ").trim() || null;
}

function parseSignature(signature) {
  if (Array.isArray(signature)) return assertSignatureLength(Uint8Array.from(signature));
  if (typeof signature === "string") {
    try {
      return assertSignatureLength(bs58.decode(signature));
    } catch {
      return assertSignatureLength(Uint8Array.from(Buffer.from(signature, "base64")));
    }
  }
  if (signature?.data && Array.isArray(signature.data)) {
    return assertSignatureLength(Uint8Array.from(signature.data));
  }
  const err = new Error("admin_signature_invalid");
  err.status = 401;
  throw err;
}

function assertSignatureLength(signature) {
  if (signature.length === 64) return signature;
  const err = new Error("admin_signature_invalid");
  err.status = 401;
  throw err;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
