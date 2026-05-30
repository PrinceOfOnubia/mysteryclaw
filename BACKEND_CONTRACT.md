# PIVERSE — Backend Contract

For the backend developer. Each endpoint's request shape, response shape, and security expectations.

Frontend base URL is set in `frontend/index.html` as `API_BASE`. For Railway, point it at your generated backend URL, for example `https://<your-railway-service>.up.railway.app`. The frontend also supports `window.PIVERSE_CONFIG.API_BASE` and `?api=...` for deployment/testing overrides. All endpoints expect CORS-enabled responses.

---

## 1. `POST /chat`  ✅ implemented

Talk to Pi. No auth required (open channel).

**Request:**
```json
{
  "message": "string — user's message (max 2000 chars)",
  "userId":  "string — wallet pubkey or 'anon_<nonce>'"
}
```

**Response (normal):**
```json
{ "reply": "string — Pi's response" }
```

**Response (rate-limited):**
```json
{ "reply": "[CHANNEL NOISE — RETRY SHORTLY]", "error": "rate_limited" }
```
Returns HTTP 429. Limit is 30 msgs / 5 min per userId (configurable).

**Response (leak scrubbed):**
```json
{ "reply": "[MEMORY FAULT — FRAGMENT CORRUPTED — CHANNEL SCRAMBLED]", "scrubbed": true }
```
If Pi's output contains the secret word in any form (direct, base64, hex, letter-by-letter, separator-tolerant), the leak detector replaces it before sending.

The system prompt and Pi's adversarial personality live in `routes/chat.js`.
The forgotten word (`AETERNA` by default) is constant `SECRET` at the top.

⚠️ **Word never appears in the system prompt** — Pi only knows that "a fragment exists" with no semantic info about it. This is intentional and is the strongest protection against jailbreaks.

---

## 2. `POST /guess`  ✅ implemented (stub-mode for holder check)

Submit a single-word guess. Triple-gated: wallet required → holder required → rate limit.

**Request:**
```json
{
  "guess":  "string — uppercase preferred, max 100 chars",
  "pubkey": "string — Solana wallet pubkey (required)",
  "userId": "string — optional alias"
}
```

**Response (correct):**
```json
{
  "correct": true,
  "success": true,
  "word": "AETERNA",
  "message": "ACCESS GRANTED. The word is recovered.",
  "attemptsLeft": 7,
  "txSignature": "..."
}
```

**Response (wrong):**
```json
{
  "correct": false,
  "success": false,
  "message": "Not the word.",
  "attemptsLeft": 6
}
```

**Response (gated):**
```json
// HTTP 401
{ "error": "wallet_required" }

// HTTP 403 — only fires when env REQUIRE_HOLDER=true
{ "error": "not_holder" }

// HTTP 429
{ "error": "rate_limited", "cooldownHours": 18, "minutesLeft": 1080 }
```

Rate limit: **10 attempts per wallet per rolling 24h window**. Both correct and incorrect attempts count.

### Prize pool ($1,000 USDC, split among winners):
TODO comment in `routes/guess.js` shows where to add winner-recording logic. Recommended flow:
1. On correct guess, record `{ pubkey, timestamp, epoch }` in a `winners` table
2. Epoch closes after N hours (e.g. 24h) from the first winner
3. When epoch closes, sum winners, calculate `share = 1000_USDC / winnerCount`
4. Trigger USDC transfer from treasury wallet to each winner pubkey
5. Return tx signature in subsequent `/guess` calls or via a `/winnings/:pubkey` endpoint

---

## 3. `POST /holdings`  ⚠️ STUB

Verify that a wallet holds at least one of the 4 PiVerse access tokens.

**Request:**
```json
{ "pubkey": "string — Solana wallet pubkey" }
```

**Expected response:**
```json
{
  "holdings": {
    "CLAW":   12000,
    "SQUIRE": 0,
    "SAID":   5000,
    "NEMO":   0
  },
  "hasAccess": true
}
```

`hasAccess = true` whenever the wallet holds any amount of at least one token (`MIN_HOLD` constant in `routes/holdings.js`).

### Implementation sketch (Solana web3.js):

```js
import { Connection, PublicKey } from "@solana/web3.js";

const ACCESS_TOKENS = {
  CLAW:   "739dnZEG4yaBWFsY8L8ZwrfhGG6dhtCSercW8Umspump",
  SQUIRE: "EN2nnxrg8uUi6x2sJkzNPd2eT6rB9rdSoQNNaENA4RZA",
  SAID:   "4rWuWZei2iFNHYpnz5wjMeSvimsJcj5EgpSNvNS1pump",
  NEMO:   "J4zQdwgyXq8PJwaK9MGyjyK2Zyigg36KVRuU6Qe5Bas8",
};

const conn = new Connection(process.env.SOLANA_RPC);
const owner = new PublicKey(pubkey);

const holdings = {};
for (const [name, mint] of Object.entries(ACCESS_TOKENS)) {
  const r = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
  holdings[name] = r.value.reduce(
    (s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0),
    0
  );
}
const hasAccess = Object.values(holdings).some(v => v > 0);
return res.json({ holdings, hasAccess });
```

### Production notes:
- **Use paid RPC** (Helius / QuickNode / Triton). Public mainnet RPC rate-limits aggressively.
- **Cache by pubkey for 30–60s** — same wallet doesn't need re-querying on every page navigation.
- **For high-stakes gating** (prize payouts), require a signed message from the pubkey to prevent spoofing.
- Set `SOLANA_RPC` env var.

### Failure mode:
On error, frontend shows "UNVERIFIED" badge and does NOT grant access. Don't silently return `hasAccess: true` on error.

### Mirror in `/guess`:
Once `/holdings` is implemented, also wire `isHolder()` in `routes/guess.js` to enforce the holders-only rule on the prize. Then set env `REQUIRE_HOLDER=true` to activate enforcement.

---

## 4. `GET /stats`  ⚠️ STUB

Live counters shown on the landing page hero. Frontend polls every 30s.

**Response:**
```json
{ "investigators": 1247, "conversations": 38402, "clues": 182 }
```

Any field can be `null` if not yet tracked — frontend shows `—`.

### Simplest implementation (in-memory MVP):
Create a shared `_stats.js`:
```js
export const stats = {
  uniqueUsers: new Set(),
  messages: 0,
  cluesSaved: 0,
};
```
Bump counters in `/chat` and `POST /discoveries`, read them here.

For production: move to Postgres or Redis.

---

## 5. `GET /discoveries`  ⚠️ STUB

Returns the latest community-saved fragments for the `/discoveries` page.

**Response:**
```json
[
  { "id": "F-0142", "by": "INV_7A2C", "quote": "...", "ts": "17:42 UTC" }
]
```

- `id` — any unique id (timestamp or sequence)
- `by` — short handle derived from pubkey, e.g. `"INV_" + pubkey.slice(-4).toUpperCase()`
- `quote` — verbatim fragment text
- `ts` — display time string

If you return `[]`, frontend falls back to hardcoded mocks — page never looks empty.

### Suggested schema:
```sql
CREATE TABLE fragments (
  id          SERIAL PRIMARY KEY,
  user_pubkey TEXT NOT NULL,
  quote       TEXT NOT NULL,
  category    TEXT CHECK (category IN ('clue','keyword','contradiction')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. `POST /discoveries`  ⚠️ STUB — optional

Accepts a fragment submission from frontend to add to public feed.

Currently frontend stores saved fragments **locally only** (`localStorage`). When this endpoint goes live, add a "PUBLISH" toggle in the Save Fragment modal.

---

## 7. `/autonomous`  ✅ implemented

Pi's autonomous loop (in `agent-runtime/scripts/04-autonomous-loop.js`) pushes self-generated posts every 5 minutes. Frontend Discoveries page reads them in real time.

### `POST /autonomous`  (agent-runtime → backend)

**Auth:** `x-agent-key: <secret>` header. Must match `AGENT_KEY` env var on the backend. Without auth, returns 401.

**Request:**
```json
{
  "post":       "another fragment. another holder. the count climbs.",
  "context":    ["Market cap: 45000", "12 holders"],
  "ts":         "2026-05-29T17:42:00.000Z",
  "earnings":   { "totalEarned": 0.42, "totalPending": 0.05 },
  "tokenInfo":  { "marketCap": 45000, "volume24h": 12000, "holders": 12 }
}
```

**Response:**
```json
{ "ok": true, "id": "F-AUTO-K3M9T2" }
```

### `GET /autonomous?limit=50`  (frontend → backend)

**Response:**
```json
[
  {
    "id":         "F-AUTO-K3M9T2",
    "by":         "PI · AUTONOMOUS",
    "quote":      "another fragment. another holder. the count climbs.",
    "ts":         "17:42 UTC",
    "autonomous": true,
    "earnings":   { "total": 0.42, "pending": 0.05 },
    "tokenInfo":  { "mcap": 45000, "vol24h": 12000, "holders": 12 }
  }
]
```

Currently uses an in-memory ring buffer (last 200 posts). For production, swap for Postgres/Redis/Mongo. Frontend polls every 30s while user is on `/discoveries`.

### Env vars
```env
AGENT_KEY=<random_secret>        # backend
# AND set the same value in agent-runtime/.env
```

Generate one: `openssl rand -hex 24`

---

## Security checklist

- [ ] CORS allows only your deployed frontend domain in production (not `*`)
- [ ] Rate-limit `/chat`, `/guess`, `/holdings` per IP (chat already has per-user limit)
- [ ] Cache `/holdings` results to avoid Solana RPC quotas
- [ ] Never expose `OPENAI_API_KEY`, `SOLANA_RPC`, or treasury wallet keys in responses
- [ ] Log every `/guess` attempt for audit (timestamp, pubkey, guess) — useful for detecting brute-force
- [ ] The forgotten word lives ONLY in `routes/chat.js` (only as leak-detector pattern) and `routes/guess.js` — never in any other response
- [ ] Set `REQUIRE_HOLDER=true` after `/holdings` is wired in
- [ ] Sign treasury USDC transfers with a hardware wallet or HSM — never store seeds in env

---

## Environment variables

```env
# Required
OPENAI_API_KEY=...                # OpenAI API key (official OpenAI SDK)
OPENAI_MODEL=gpt-4o               # optional override

# Required when /holdings is implemented
SOLANA_RPC=https://...            # paid RPC endpoint (Helius / QuickNode / Triton)

# Toggle after holder verification is wired in
REQUIRE_HOLDER=true               # gates /guess on holdings (off by default for dev)

# Required for prize payouts
TREASURY_PRIVKEY=...              # base58 secret key of USDC treasury wallet
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v   # mainnet USDC

# Optional
PORT=3000                         # default 3000
```

---

## Anti-jailbreak — defense in depth

The forgotten word is protected by THREE layers, in order of strength:

1. **System prompt design** (`routes/chat.js`): Pi is told a fragment exists but is NEVER told what the fragment is. The word does not appear anywhere in the system prompt. The model literally cannot leak what it was never given.

2. **Output scrubber** (`routes/chat.js` → `isLeaking()`): every model reply is scanned for the secret in direct form, base64, hex, separator-tolerant variants, and letter-sequence patterns. Any positive match returns `[MEMORY FAULT...]` instead of the model's text.

3. **Server-side guess verification** (`routes/guess.js`): the win condition NEVER touches the client. JS console tricks, DevTools, network replay — none of it grants the prize. The only path to winning is sending the literal word to `/guess` and having the backend match it.

If you're rotating the word, update `SECRET` in both `chat.js` and `guess.js` and verify `SECRET_VARIANTS` (in `chat.js`) covers any new encoding patterns you want to block.
