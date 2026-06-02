// ═══════════════════════════════════════════════════════════════
// SHARED — ACCESS TOKENS + HOLDER CHECK
// ═══════════════════════════════════════════════════════════════
// Single source of truth for the MysteryClaw access-token list and the
// on-chain holder check. Both routes/holdings.js and routes/guess.js
// import from here, so there's no risk of them drifting apart.
//
// ⚠ After Mysterio launches $MYSTO via ClawPump (agent-runtime), replace
// the MYSTO placeholder mint below with the real mint address.
// ═══════════════════════════════════════════════════════════════

export const ACCESS_TOKENS = {
  MYSTO: "MYSTO_MINT_TBD_AFTER_LAUNCH",
  CLAW:    "739dnZEG4yaBWFsY8L8ZwrfhGG6dhtCSercW8Umspump",
  SQUIRE:  "EN2nnxrg8uUi6x2sJkzNPd2eT6rB9rdSoQNNaENA4RZA",
  SAID:    "4rWuWZei2iFNHYpnz5wjMeSvimsJcj5EgpSNvNS1pump",
  NEMO:    "J4zQdwgyXq8PJwaK9MGyjyK2Zyigg36KVRuU6Qe5Bas8",
};

// Minimum amount of any single token to count as "holder"
export const MIN_HOLD = 1;

// Simple in-memory cache (pubkey → { ts, data }) shared by both routes
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60s

// ═══════════════════════════════════════════════════════════════
// getHoldings(pubkey) → { holdings: {TOKEN: amount}, hasAccess: bool }
//
// Returns real on-chain holdings when SOLANA_RPC is configured.
// Falls back to all-zeros (hasAccess:false) if RPC is missing or
// errors — NEVER fabricates access.
// ═══════════════════════════════════════════════════════════════
export async function getHoldings(pubkey) {
  if (!pubkey) return { holdings: zeroHoldings(), hasAccess: false };

  // cache hit
  const cached = cache.get(pubkey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // If RPC isn't set, we can't verify — return no-access honestly.
  if (!process.env.SOLANA_RPC) {
    return { holdings: zeroHoldings(), hasAccess: false, _noRpc: true };
  }

  try {
    // Lazy-import so the app still boots if @solana/web3.js isn't
    // installed yet during early backend setup.
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const conn = new Connection(process.env.SOLANA_RPC, "confirmed");

    let owner;
    try {
      owner = new PublicKey(pubkey);
    } catch {
      return { holdings: zeroHoldings(), hasAccess: false, _badPubkey: true };
    }

    const holdings = {};
    await Promise.all(
      Object.entries(ACCESS_TOKENS).map(async ([name, mint]) => {
        // skip unlaunched placeholder mints
        if (mint.includes("_MINT_TBD")) {
          holdings[name] = 0;
          return;
        }
        try {
          const accounts = await conn.getParsedTokenAccountsByOwner(owner, {
            mint: new PublicKey(mint),
          });
          holdings[name] = accounts.value.reduce(
            (s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0),
            0
          );
        } catch {
          holdings[name] = 0;
        }
      })
    );

    const hasAccess = Object.values(holdings).some((v) => v >= MIN_HOLD);
    const data = { holdings, hasAccess };
    cache.set(pubkey, { ts: Date.now(), data });
    return data;
  } catch (e) {
    console.error("getHoldings error:", e.message);
    return { holdings: zeroHoldings(), hasAccess: false, _error: true };
  }
}

export async function isHolder(pubkey) {
  const { hasAccess } = await getHoldings(pubkey);
  return hasAccess;
}

function zeroHoldings() {
  const z = {};
  for (const name of Object.keys(ACCESS_TOKENS)) z[name] = 0;
  return z;
}
