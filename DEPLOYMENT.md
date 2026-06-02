# MysteryClaw — Production Deployment Guide

**For: Backend Developer**
**Stack:** Node.js (Express) backend + static frontend (already deployed on Vercel) + autonomous agent runtime
**Estimated setup time:** 60–90 minutes

This guide walks through everything needed to take MysteryClaw from code to a fully working production deployment.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Backend Deployment (Railway)](#3-backend-deployment-railway)
4. [Required Environment Variables](#4-required-environment-variables)
5. [Solana RPC Setup (Helius)](#5-solana-rpc-setup-helius)
6. [Implementing the Holdings Check](#6-implementing-the-holdings-check)
7. [Implementing Stats & Discoveries](#7-implementing-stats--discoveries)
8. [Agent Runtime Deployment](#8-agent-runtime-deployment)
9. [CORS & Security Hardening](#9-cors--security-hardening)
10. [Prize Payout Implementation](#10-prize-payout-implementation)
11. [Frontend Updates After Backend Goes Live](#11-frontend-updates-after-backend-goes-live)
12. [Production Checklist](#12-production-checklist)
13. [Monitoring & Maintenance](#13-monitoring--maintenance)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  FRONTEND (Vercel)                                       │
│  https://mysteryclaw.xyz                                     │
│  Static index.html — talks to backend via API_BASE       │
└────────────┬─────────────────────────────────────────────┘
             │ HTTPS
             ▼
┌──────────────────────────────────────────────────────────┐
│  BACKEND (Railway) — YOUR JOB                         │
│  https://piverse-production.up.railway.app              │
│                                                          │
│  Express app with production safety endpoints:           │
│    POST /chat        — Mysterio adversarial chat               │
│    POST /auth/nonce  — wallet signature challenge        │
│    POST /guess       — signed word verification          │
│    POST /holdings    — Solana RPC token check  [TODO]    │
│    GET  /stats       — live counters           [TODO]    │
│    GET  /discoveries — community fragments     [TODO]    │
│    POST /autonomous  — Mysterio's self-posts (auth)            │
│    GET  /autonomous  — read autonomous feed              │
└────────────┬─────────────────────────────────────────────┘
             │
   ┌─────────┴──────────┐
   │                    │
   ▼                    ▼
┌─────────────┐  ┌──────────────────────────────────────┐
│ OpenAI      │  │ AGENT RUNTIME (separate process)     │
│ API         │  │ pm2 / systemd on VPS                 │
│ (chat LLM)  │  │ - Observes hosted ClawPump wallet           │
└─────────────┘  │ - Can launch $MYSTO later via ClawPump │
                 │ - Runs autonomous loop 24/7          │
                 │ - Posts to /autonomous every 5 min   │
                 └─────────┬────────────────────────────┘
                           │
                           ▼
                 ┌──────────────────────────┐
                 │ Solana mainnet           │
                 │ - $MYSTO on pump.fun   │
                 │ - Token gate verification│
                 │ - Prize payouts (USDC)   │
                 └──────────────────────────┘
```

---

## 2. Prerequisites

You need accounts on:

| Service | Purpose | Cost |
|---|---|---|
| **Railway** | Host the backend | Hobby tier works for MVP |
| **Helius** (or QuickNode / Triton) | Paid Solana RPC | Free tier: 100k requests/day |
| **OpenAI** | LLM API for Mysterio's responses | see OpenAI pricing for current model rates |
| **ClawPump** | AI-agent token launchpad | Free (gasless tier) |
| **GitHub** | Code repo | Free |

Local tooling:
- Node.js 18+ and npm
- Git
- `solana-keygen` CLI (optional, for treasury wallet)

---

## 3. Backend Deployment (Railway)

### 3.1 Push code to GitHub

```bash
cd backend
git init
git add .
git commit -m "Initial MysteryClaw backend"
git remote add origin https://github.com/<your-org>/mysteryclaw-backend.git
git push -u origin main
```

**Important:** add a `.gitignore` so secrets never leak:

```gitignore
node_modules/
.env
.env.local
*.log
```

### 3.2 Connect to Railway

1. Go to https://railway.app/dashboard → **New Project**
2. Choose **Deploy from GitHub repo** and connect `PrinceOfOnubia/mysteryclaw`
3. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Branch:** `main`
   - **Runtime:** Node

4. Add environment variables (see Section 4 below) before the first production deploy.

5. Open the service **Settings** tab and generate a public domain. It will look like:
   `https://<your-railway-service>.up.railway.app`

After the deploy finishes, hit the Railway URL in a browser — you should see:

```json
{
  "name": "MysteryClaw",
  "tagline": "Infrastructure for Adversarial AI Experiences",
  "endpoints": { ... }
}
```

### 3.3 Test endpoints

```bash
# Mysterio chat
curl -X POST https://<your-railway-service>.up.railway.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"who are you","userId":"test"}'

# Guess (should return wallet_required)
curl -X POST https://<your-railway-service>.up.railway.app/guess \
  -H "Content-Type: application/json" \
  -d '{"guess":"hello"}'

# Holdings stub
curl -X POST https://<your-railway-service>.up.railway.app/holdings \
  -H "Content-Type: application/json" \
  -d '{"pubkey":"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"}'
```

---

## 4. Required Environment Variables

Set these in Railway dashboard → your service → **Environment** tab.

| Variable | Required | Example | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ Yes | `sk-...` | OpenAI API key (official OpenAI SDK) |
| `OPENAI_MODEL` | No | `gpt-4o` | Defaults to `gpt-4o` if unset |
| `SECRET_WORD` | ✅ Yes | private MYSTO-themed word | Exact prize word; set only in Railway, never commit |
| `DATABASE_URL` | ✅ Yes | Railway PostgreSQL URL | Production source of truth for wallets, guesses, winners, payouts, autonomous posts |
| `SOLANA_RPC` | ✅ Yes | `https://mainnet.helius-rpc.com/?api-key=...` | Paid mainnet RPC strongly recommended |
| `SOLANA_CLUSTER` | ✅ Yes | `mainnet` | Mainnet-only deployment |
| `REQUIRE_HOLDER` | ⚠️ Keep false for MVP | `false` | Do not set true until /holdings is verified |
| `AGENT_KEY` | ✅ Yes (for /autonomous) | Generate: `openssl rand -hex 24` | Same value in agent-runtime/.env |
| `ADMIN_WALLET` | ✅ Yes | Phantom wallet pubkey | Normal `/admin` login signer |
| `ADMIN_SESSION_SECRET` | ✅ Yes | Generate: `openssl rand -hex 32` | Signs short-lived admin sessions |
| `ADMIN_KEY` | Emergency fallback | Generate: `openssl rand -hex 32` | Manual API fallback only; do not use as normal frontend auth |
| `PORT` | No | `3000` | Railway sets this automatically |
| `CORS_ORIGIN` | ✅ Recommended | `https://mysteryclaw.xyz,https://www.mysteryclaw.xyz,https://mysteryclaw.vercel.app` | Comma-separated for multiple; whitespace is trimmed |
| `PAYOUTS_ENABLED` | ✅ Yes | `false` | Keep false until final real-money review |
| `TREASURY_PRIVKEY` | Only when enabling payouts | empty | Base58 treasury secret, never commit |
| `USDC_MINT` | ✅ Yes | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Mainnet USDC |
| `AGENT_WALLET_PUBKEY` | Optional | Mysterio wallet pubkey | Shows wallet address in admin status |
| `MYSTO_TOKEN_MINT` | Optional until launch | Mint pubkey | Shows token launch status after launch |

**To generate AGENT_KEY:**
```bash
openssl rand -hex 24
# Output example: 7f3a9b2c4e5d8f1a6b9c2d5e8a3f7b4c9d2e6a8b1c5f9d3e
```

Save this value — you'll need to set the same one in `agent-runtime/.env`.

---

## 5. Solana RPC Setup (Helius)

The default public RPC (`api.mainnet-beta.solana.com`) rate-limits aggressively. For production, use **Helius**:

1. Go to https://www.helius.dev → Sign up
2. Create a new project → copy the RPC URL
3. It looks like: `https://mainnet.helius-rpc.com/?api-key=abc123-def456-...`
4. Set as `SOLANA_RPC` env var on Railway

**Free tier:** 100k requests/day. With caching this is enough for thousands of users.

**Why this matters:** every `/holdings` call hits the RPC ~5 times (once per access token). Without a paid RPC, the endpoint will start failing once you have ~50 active users/day.

---

## 6. Implementing the Holdings Check

**File:** `backend/routes/holdings.js`

This is the most critical TODO. The frontend gates the terminal, guess submission, and prize eligibility on this endpoint.

### 6.1 Install Solana SDK

```bash
cd backend
npm install @solana/web3.js
```

### 6.2 Replace the stub

Open `routes/holdings.js` and replace the TODO block (lines ~30–55) with:

```js
import { Connection, PublicKey } from "@solana/web3.js";

const conn = new Connection(process.env.SOLANA_RPC, "confirmed");

// Simple in-memory cache to avoid hitting RPC repeatedly for the same wallet
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds

router.post("/", async (req, res) => {
  try {
    const { pubkey } = req.body;
    if (!pubkey) return res.status(400).json({ error: "pubkey required" });

    // Validate pubkey format
    let owner;
    try {
      owner = new PublicKey(pubkey);
    } catch {
      return res.status(400).json({ error: "invalid pubkey" });
    }

    // Cache hit
    const cached = cache.get(pubkey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return res.json(cached.data);
    }

    // Query each access token in parallel
    const holdings = {};
    const results = await Promise.all(
      Object.entries(ACCESS_TOKENS).map(async ([name, mint]) => {
        try {
          const accounts = await conn.getParsedTokenAccountsByOwner(owner, {
            mint: new PublicKey(mint),
          });
          const total = accounts.value.reduce(
            (s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0),
            0
          );
          return [name, total];
        } catch (e) {
          console.error(`Failed to check ${name}:`, e.message);
          return [name, 0];
        }
      })
    );

    for (const [name, amount] of results) {
      holdings[name] = amount;
    }

    const hasAccess = Object.values(holdings).some(v => v >= MIN_HOLD);
    const data = { holdings, hasAccess };

    // Cache result
    cache.set(pubkey, { ts: Date.now(), data });

    return res.json(data);
  } catch (err) {
    console.error("HOLDINGS ERROR:", err.message);
    res.status(500).json({ error: "Holdings check failed" });
  }
});
```

### 6.3 Mirror in /guess

Open `backend/routes/guess.js` and find the `isHolder()` function. Replace its stub body with the same Solana RPC logic (or import a shared module).

After both endpoints work and wallet signature verification is added, you can plan a later switch to `REQUIRE_HOLDER=true`. For the safe MVP deployment, keep `REQUIRE_HOLDER=false`.

### 6.4 Test

```bash
# Use a real wallet that holds one of the access tokens
curl -X POST https://<your-railway-service>.up.railway.app/holdings \
  -H "Content-Type: application/json" \
  -d '{"pubkey":"<real_phantom_pubkey>"}'

# Expected:
# { "holdings": {"MYSTO":0,"CLAW":12000,"SQUIRE":0,"SAID":0,"NEMO":0}, "hasAccess": true }
```

---

## 7. Implementing Stats & Discoveries

These are less critical but make the platform feel alive.

### 7.1 Shared in-memory stats module

Create `backend/_stats.js`:

```js
// Simple in-memory counters. For production, move to Postgres or Redis.
export const stats = {
  uniqueUsers: new Set(),
  messages: 0,
  cluesSaved: 0,
};
```

### 7.2 Wire into existing routes

**In `routes/chat.js`** — bump counters after every successful chat:

```js
import { stats } from "../_stats.js";
// ...
stats.uniqueUsers.add(userId);
stats.messages++;
```

**In `routes/stats.js`** — replace the stub:

```js
import { stats } from "../_stats.js";

router.get("/", async (req, res) => {
  res.json({
    investigators: stats.uniqueUsers.size,
    conversations: stats.messages,
    clues: stats.cluesSaved,
  });
});
```

### 7.3 Discoveries (optional, low priority)

**File:** `backend/routes/discoveries.js`

The frontend has a fallback array of mock fragments, so this is not blocking. When you're ready:

1. Add a Postgres or Mongo collection: `fragments { id, user_pubkey, quote, category, created_at }`
2. In the GET handler, query the latest 30 entries ordered by `created_at DESC`
3. In the POST handler, accept `{ pubkey, quote, category }` and insert a row
4. Bump `stats.cluesSaved++` on every POST

---

## 8. Agent Runtime Deployment

This is **a separate deployment** from the backend. It runs Mysterio's autonomous loop 24/7 and observes the hosted ClawPump agent wallet. It does not store that wallet's private key.

**Recommended host:** a small VPS (DigitalOcean $4/mo, Hetzner €3/mo, AWS Lightsail $3.50/mo). Railway works too but introduces unnecessary HTTP layer.

### 8.1 Provision a VPS

Spin up a basic Ubuntu 22.04 server with 1 GB RAM. SSH in.

### 8.2 Install Node + pm2

```bash
# Install Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install pm2 globally (process manager)
sudo npm install -g pm2
```

### 8.3 Pull the agent-runtime folder

```bash
git clone https://github.com/PrinceOfOnubia/mysteryclaw.git
cd mysteryclaw/agent-runtime
npm install
```

### 8.4 Create the hosted ClawPump agent and get its API key

1. Open https://clawpump.tech
2. Click **Login with Google** (Crossmint auth)
3. Create or select the hosted Mysterio agent
4. Copy the agent UUID, hosted wallet public address, and `cpk_...` API key

### 8.5 Configure `.env`

```bash
cp .env.example .env
nano .env
```

Fill in:
- `CLAWPUMP_AGENT_ID` (hosted agent UUID from step 8.4)
- `CLAWPUMP_AGENT_WALLET_PUBKEY` (hosted public wallet address from step 8.4)
- `CLAWPUMP_API_KEY` (from step 8.4)
- `TOKEN_IMAGE_URL=https://mysteryclaw.xyz/assets/mysteryclaw-logo.jpg`
- `TOKEN_TWITTER=https://x.com/mysteryclawpump?s=11`
- `OPENAI_API_KEY` (same OpenAI API key as backend)
- `MYSTERYCLAW_API=https://<your-railway-service>.up.railway.app`
- `AGENT_KEY` (same value as on Railway — without this `/autonomous` push fails with 401)

### 8.6 Confirm the token image

Confirm `assets/myst-token.png` exists and is the approved token logo.

### 8.7 Launch $MYSTO on pump.fun later

```bash
npm run launch-token
```

Do not run this until the token launch is intentionally approved.
2. Sign in and launch from `https://agents.clawpump.tech/dashboard/launch-token`
3. Save the mint address and transaction signature to `token-launch.json`
4. Update the Railway and frontend mint configuration

### 8.8 Update the mint address everywhere

After successful launch, copy the `mintAddress` from `token-launch.json` and update:

1. **`frontend/index.html`** — find `MYSTO_MINT_TBD_AFTER_LAUNCH` in the `TOKENS` array and replace it
2. **`backend/_access.js`** — find the same placeholder in `ACCESS_TOKENS` and replace it
3. Commit and redeploy frontend (`vercel --prod`) and backend (auto-deploys on push to main)

### 8.9 Start the autonomous loop

```bash
pm2 start scripts/06-agent-loop.js --name mysterio-agent
pm2 save
pm2 startup  # makes pm2 survive reboots — follow the printed instructions
```

Check it's running:
```bash
pm2 logs mysterio-agent
```

You should see a tick every 5 minutes. Within 30 seconds the first post should appear at https://mysteryclaw.xyz/discoveries.

---

## 9. CORS & Security Hardening

### 9.1 Restrict CORS to your frontend

**File:** `backend/server.js`

Replace:
```js
app.use(cors({ origin: "*" }));
```

With the production implementation:
```js
app.set("trust proxy", 1);

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  "https://mysteryclaw.xyz",
  "https://www.mysteryclaw.xyz",
  "https://mysteryclaw.vercel.app",
  ...configuredOrigins,
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server, mobile apps
    if (allowedOrigins.has(origin)) return callback(null, true);
    if (/^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-agent-key", "x-admin-key"],
}));
```

Set `CORS_ORIGIN=https://mysteryclaw.xyz,https://www.mysteryclaw.xyz,https://mysteryclaw.vercel.app` on Railway. Vercel preview URLs are allowed by pattern.

### 9.2 Add IP-based rate limit

```bash
npm install express-rate-limit
```

In `server.js`:
```js
import rateLimit from "express-rate-limit";

const globalLimit = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 300,                    // 300 requests/min/IP
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimit);

// Stricter limit on /guess (already has per-wallet limit, this adds per-IP)
const guessLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
});
app.use("/guess", guessLimit);
```

### 9.3 Helmet for security headers

```bash
npm install helmet
```

```js
import helmet from "helmet";
app.use(helmet());
```

### 9.4 Validate all incoming JSON

Already done in each route, but add a global JSON size limit:

```js
app.use(express.json({ limit: "100kb" }));
```

---

## 10. Prize Payout System

**This is the highest-stakes feature.** The production code is prepared for real-money payouts, but payouts remain disabled unless `PAYOUTS_ENABLED=true` and all treasury/database variables are present.

### 10.1 Production data flow

- `POST /auth/nonce` issues a short-lived wallet challenge.
- Phantom signs the exact challenge.
- `POST /guess` verifies wallet ownership before recording a prize-eligible guess.
- Guesses, verified wallets, prize epochs, winners, payout attempts, and autonomous posts are stored in Railway Postgres.
- No payout is sent from guess submission.
- `POST /admin/payout` is the only payout trigger and requires `x-admin-key`.
- Each winner payout has an idempotency key so a confirmed winner cannot be paid twice.

### 10.2 Database migrations

Run migrations after Railway PostgreSQL is attached:

```bash
cd backend
DATABASE_URL="postgresql://..." npm run migrate
DATABASE_URL="postgresql://..." npm run seed
```

In Railway, use the service shell or a one-off job with the same commands after `DATABASE_URL` is available.

### 10.3 Treasury wallet setup

```bash
# Generate a fresh keypair for the treasury
solana-keygen new --outfile treasury.json
# Print pubkey
solana-keygen pubkey treasury.json
```

Fund this wallet with:
- 1,000 USDC (mainnet mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
- 0.1 SOL (for transaction fees)

**⚠️ NEVER push `treasury.json` to git. Store it in:**
- AWS Secrets Manager / Google Secret Manager (production-grade)
- Railway's encrypted env vars (acceptable for MVP — paste the base58 of the secretKey into `TREASURY_PRIVKEY`)

### 10.4 Manual payout trigger

Keep `PAYOUTS_ENABLED=false` until launch approval. When ready, set all treasury vars, review unpaid winners in Postgres, then trigger:

```bash
curl -X POST https://piverse-production.up.railway.app/admin/payout \
  -H "x-admin-key: $ADMIN_KEY"
```

The payout engine refuses to run unless `PAYOUTS_ENABLED=true`, `TREASURY_PRIVKEY`, `SOLANA_RPC`, `USDC_MINT`, and `DATABASE_URL` are all configured.

---

## 11. Frontend Updates After Backend Goes Live

The frontend is already deployed on Vercel. After your backend is working:

### 11.1 Update API_BASE if URL changed

After Railway gives you a backend URL, point the frontend at it. The current frontend supports:
- `window.MYSTERYCLAW_CONFIG.API_BASE`
- `?api=https://<your-railway-service>.up.railway.app`
- the `DEFAULT_API_BASE` constant in `frontend/index.html`

For production, set the backend URL to your generated Railway domain:
```js
window.MYSTERYCLAW_CONFIG = {
  API_BASE: "https://<your-railway-service>.up.railway.app"
}
```

Then redeploy:
```bash
cd frontend
vercel --prod
```

### 11.2 Update token mint address

After `$MYSTO` is launched (section 8), update both files with the real mint:
- `frontend/index.html` → `TOKENS` array (`MYSTO_MINT_TBD_AFTER_LAUNCH`)
- `backend/_access.js` → `ACCESS_TOKENS` object

Commit and push.

### 11.3 Domain (optional)

Connect a custom domain in Vercel dashboard → Settings → Domains. Recommended: `mysteryclaw.app` or `mysteryclaw.xyz`. Vercel handles SSL automatically.

---

### 11.4 Private Admin Panel

The admin panel is hidden at:

```text
https://mysteryclaw.xyz/admin
```

There is no public nav link. It requires the configured `ADMIN_WALLET` in Phantom. The browser asks the backend for a nonce, Phantom signs the exact admin login message, and the backend verifies the Solana signature before returning a short-lived admin session token.

Admin API calls send:

```http
Authorization: Bearer <admin-session-jwt>
```

`ADMIN_KEY` remains available only as an emergency/manual API fallback:

```http
Authorization: Bearer <ADMIN_KEY>
```

Admin API routes live under `/admin/api` on the backend. They never return private keys, treasury keys, OpenAI keys, ClawPump keys, or agent control secrets.

Optional server-side env vars for admin visibility/control:

```env
ADMIN_WALLET=
ADMIN_SESSION_SECRET=
AGENT_WALLET_PUBKEY=
MYSTO_TOKEN_MINT=
# Legacy fallback supported if it was already set before the ticker update:
# MYST_TOKEN_MINT=
AGENT_CONTROL_URL=
AGENT_CONTROL_KEY=
```

`AGENT_CONTROL_URL` and `AGENT_CONTROL_KEY` are only for a future private AWS control bridge. Without them, token launch and agent restart buttons refuse safely.

---

## 12. Production Checklist

Before announcing publicly, verify:

### Backend
- [ ] All env vars set in Railway
- [ ] `ADMIN_WALLET` set and `/admin/api/status` rejects without verified admin session auth
- [ ] `ADMIN_KEY` stored only as emergency/manual fallback
- [ ] `/chat` returns Mysterio's adversarial responses (not generic "I'm an AI")
- [ ] `/guess` rejects without pubkey (401)
- [ ] `/guess` enforces 10 attempts per 3h game session per wallet
- [ ] `/holdings` returns real on-chain balances (not stub `{...:0}`)
- [ ] `REQUIRE_HOLDER=false` for MVP; only enable after wallet signature verification and /holdings validation
- [ ] `/autonomous POST` rejects without `x-agent-key`
- [ ] CORS restricted to your Vercel domain
- [ ] Rate limit middleware active
- [ ] Helmet installed
- [ ] Logs viewable in Railway dashboard

### Frontend
- [ ] `API_BASE` matches deployed backend URL
- [ ] `/admin` loads privately and has no public nav link
- [ ] Wallet connect works (Phantom)
- [ ] Holdings panel updates after connect
- [ ] Terminal gates non-wallet users with `WALLET REQUIRED` modal
- [ ] Guess submission shows correct error messages (not_holder, rate_limited, etc.)
- [ ] Discoveries page polls `/autonomous` and shows live posts when loop is active

### Agent Runtime
- [ ] Hosted ClawPump agent UUID and public wallet address configured
- [ ] No agent wallet private key stored in `agent-runtime/.env`
- [ ] `$MYSTO` token launch intentionally approved
- [ ] Mint address updated in frontend + backend
- [ ] `npm run earnings` returns real data
- [ ] `pm2 list` shows `mysterio-loop` as `online`
- [ ] `pm2 logs mysterio-loop` shows successful ticks
- [ ] Frontend `/discoveries` shows posts appearing every ~5 min

### Prize Pool (if enabled)
- [ ] Treasury wallet funded with 1,000 USDC + 0.1 SOL
- [ ] `PAYOUTS_ENABLED=false` for MVP
- [ ] `TREASURY_PRIVKEY` not set until real payout launch
- [ ] `DATABASE_URL` migrated and seeded
- [ ] Admin payout trigger tested with `PAYOUTS_ENABLED=false`
- [ ] No `winners.json` dependency in production

### Security
- [ ] `.env`, wallet files, and private keys NOT in git history
- [ ] `treasury.json` NOT in git
- [ ] Admin panel does not expose private keys or API keys in responses
- [ ] OpenAI API key not exposed in frontend or logs
- [ ] Helius RPC key rotated if leaked
- [ ] No `console.log` of secrets, signatures, or seed phrases

---

## 13. Monitoring & Maintenance

### Railway
- **Logs:** dashboard → service → Logs tab (real-time stream)
- **Metrics:** dashboard → service → Metrics (CPU, memory, request count)
- **Alerts:** set up email alerts for HTTP 5xx spikes

### Helius
- **Dashboard:** https://www.helius.dev/dashboard — track RPC requests/day
- Upgrade to paid plan if you hit 100k/day consistently

### pm2 (Agent Runtime)
```bash
pm2 status               # see all processes
pm2 logs mysterio-agent         # tail logs
pm2 restart mysterio-agent      # restart after code change
pm2 monit                # real-time CPU/memory dashboard
```

### Mysterio's earnings
```bash
cd agent-runtime
npm run earnings
```

Check ClawPump leaderboard: https://clawpump.tech/leaderboard

### Common issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| `/chat` returns generic "How can I help" | System prompt not loading | Check `OPENAI_API_KEY`, restart backend |
| `/holdings` always returns 0 | Wrong RPC URL or PublicKey throws | Check `SOLANA_RPC`, validate pubkey format |
| Frontend shows "UNVERIFIED" forever | CORS or /holdings 500 | Check browser console + Railway logs |
| Loop posts but Discoveries empty | `AGENT_KEY` mismatch | Verify same value in both env files |
| Token launch unavailable | Hosted ClawPump launch is dashboard-only | Sign in to the hosted ClawPump dashboard and verify agent access |
| Rate limit on RPC | Free Solana RPC | Switch to Helius |

---

## Cost summary

| Service | Monthly |
|---|---|
| Railway Hobby plan | $7 |
| Helius free tier | $0 (upgrade to $49/mo if needed) |
| VPS for agent-runtime | $4–$6 |
| OpenAI API | Usage-based; default model is `gpt-4o` |
| Vercel (frontend) | $0 (Hobby tier) |
| Domain | $10–20/year |
| **Total** | **~$20/month** + one-time 1,000 USDC for prize pool |

---

## Final notes

- **`backend/`** code is in this folder
- **`agent-runtime/`** is the separate process for Mysterio's eternal-agent layer
- **`frontend/`** is already deployed on Vercel — no changes needed unless API_BASE or token mint changes
- See `BACKEND_CONTRACT.md` for full API specs of every endpoint
- See `agent-runtime/README.md` for token launch details

If anything's unclear, ping me on Telegram. Good luck.
