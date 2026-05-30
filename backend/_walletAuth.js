import crypto from "crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { hasDatabase, pool, query, sha256 } from "./_db.js";

const NONCE_TTL_MS = 5 * 60 * 1000;
const localNonces = new Map();

export function normalizePubkey(pubkey) {
  try {
    return new PublicKey(pubkey).toBase58();
  } catch {
    const err = new Error("invalid_pubkey");
    err.status = 400;
    throw err;
  }
}

export async function createWalletChallenge(pubkey) {
  const wallet = normalizePubkey(pubkey);
  const nonce = crypto.randomBytes(24).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
  const message = [
    "PiVerse wallet verification",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    "Purpose: verify wallet ownership for prize guesses.",
  ].join("\n");

  const nonceHash = sha256(nonce);

  if (hasDatabase) {
    await query(
      `insert into wallet_nonces (wallet_pubkey, nonce_hash, message, issued_at, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [wallet, nonceHash, message, issuedAt, expiresAt]
    );
  } else {
    localNonces.set(nonceHash, {
      wallet_pubkey: wallet,
      message,
      expires_at: expiresAt,
      consumed_at: null,
    });
  }

  return { pubkey: wallet, nonce, message, expiresAt: expiresAt.toISOString() };
}

export async function verifyWalletAuth(pubkey, walletAuth) {
  const wallet = normalizePubkey(pubkey);
  if (!walletAuth || !walletAuth.nonce || !walletAuth.message || !walletAuth.signature) {
    const err = new Error("wallet_signature_required");
    err.status = 401;
    throw err;
  }

  const nonceHash = sha256(walletAuth.nonce);
  const record = await loadNonce(nonceHash);
  if (!record || record.wallet_pubkey !== wallet) {
    const err = new Error("wallet_nonce_invalid");
    err.status = 401;
    throw err;
  }
  if (record.consumed_at) {
    const err = new Error("wallet_nonce_used");
    err.status = 401;
    throw err;
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    const err = new Error("wallet_nonce_expired");
    err.status = 401;
    throw err;
  }
  if (record.message !== walletAuth.message) {
    const err = new Error("wallet_message_mismatch");
    err.status = 401;
    throw err;
  }

  const signature = parseSignature(walletAuth.signature);
  const messageBytes = new TextEncoder().encode(walletAuth.message);
  const publicKeyBytes = new PublicKey(wallet).toBytes();
  const ok = nacl.sign.detached.verify(messageBytes, signature, publicKeyBytes);
  if (!ok) {
    const err = new Error("wallet_signature_invalid");
    err.status = 401;
    throw err;
  }

  const consumed = await consumeNonce(nonceHash);
  if (!consumed) {
    const err = new Error("wallet_nonce_used");
    err.status = 401;
    throw err;
  }
  return upsertVerifiedWallet(wallet, nonceHash, bs58.encode(signature), walletAuth.message);
}

async function loadNonce(nonceHash) {
  if (!hasDatabase) return localNonces.get(nonceHash);
  const result = await query(
    `select wallet_pubkey, message, expires_at, consumed_at
     from wallet_nonces
     where nonce_hash = $1`,
    [nonceHash]
  );
  return result.rows[0];
}

async function consumeNonce(nonceHash) {
  if (!hasDatabase) {
    const record = localNonces.get(nonceHash);
    if (!record || record.consumed_at) return false;
    record.consumed_at = new Date();
    return true;
  }
  const result = await query(
    `update wallet_nonces
     set consumed_at = now()
     where nonce_hash = $1 and consumed_at is null`,
    [nonceHash]
  );
  return result.rowCount === 1;
}

async function upsertVerifiedWallet(wallet, nonceHash, signature, message) {
  if (!hasDatabase) {
    return { wallet_pubkey: wallet, verified_wallet_id: null };
  }

  await query(
    `insert into users (wallet_pubkey)
     values ($1)
     on conflict (wallet_pubkey)
     do update set last_seen_at = now()`,
    [wallet]
  );

  const result = await query(
    `insert into verified_wallets (wallet_pubkey, last_nonce_hash, signature, message)
     values ($1, $2, $3, $4)
     on conflict (wallet_pubkey)
     do update set
       last_verified_at = now(),
       last_nonce_hash = excluded.last_nonce_hash,
       signature = excluded.signature,
       message = excluded.message
     returning id, wallet_pubkey`,
    [wallet, nonceHash, signature, message]
  );

  return {
    wallet_pubkey: wallet,
    verified_wallet_id: result.rows[0].id,
  };
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
  const err = new Error("wallet_signature_invalid");
  err.status = 401;
  throw err;
}

function assertSignatureLength(signature) {
  if (signature.length === 64) return signature;
  const err = new Error("wallet_signature_invalid");
  err.status = 401;
  throw err;
}
