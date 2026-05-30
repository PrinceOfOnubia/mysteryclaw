# PiVerse — Production Deployment Guide

**For: Backend Developer**
**Stack:** Node.js (Express) backend + static frontend (already deployed on Vercel) + autonomous agent runtime
**Estimated setup time:** 60–90 minutes

This guide walks through everything needed to take PiVerse from code to a fully working production deployment.

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
│  https://piverse-nu.vercel.app                           │
│  Static index.html — talks to backend via API_BASE       │
└────────────┬─────────────────────────────────────────────┘
             │ HTTPS
             ▼
┌──────────────────────────────────────────────────────────┐
│  BACKEND (Railway) — YOUR JOB                         │
│  https://<your-railway-service>.up.railway.app         │
│                                                          │
│  Express app with 7 endpoints:                           │
│    POST /chat        — Pi adversarial chat               │
│    POST /guess       — word verification + rate limit    │
│    POST /holdings    — Solana RPC token check  [TODO]    │
│    GET  /stats       — live counters           [TODO]    │
│    GET  /discoveries — community fragments     [TODO]    │
│    POST /autonomous  — Pi's self-posts (auth)            │
│    GET  /autonomous  — read autonomous feed              │
└────────────┬─────────────────────────────────────────────┘
             │
   ┌─────────┴──────────┐
   │                    │
   ▼                    ▼
┌─────────────┐  ┌──────────────────────────────────────┐
│ DeepSeek    │  │ AGENT RUNTIME (separate process)     │
│ API         │  │ pm2 / systemd on VPS                 │
│ (chat LLM)  │  │ - Owns Pi's Solana wallet            │
└─────────────┘  │ - Launched $PIVERSE via ClawPump     │
                 │ - Runs autonomous loop 24/7          │
                 │ - Posts to /autonomous every 5 min   │
                 └─────────┬────────────────────────────┘
                           │
                           ▼
                 ┌──────────────────────────┐
                 │ Solana mainnet           │
                 │ - $PIVERSE on pump.fun   │
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
| **DeepSeek** | LLM API for Pi's responses | ~$0.14 per 1M tokens |
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
git commit -m "Initial PiVerse backend"
git remote add origin https://github.com/<your-org>/piverse-backend.git
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
2. Choose **Deploy from GitHub repo** and connect `PrinceOfOnubia/piverse`
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
  "name": "PiVerse",
  "tagline": "Infrastructure for Adversarial AI Experiences",
  "endpoints": { ... }
}
```

### 3.3 Test endpoints

```bash
# Pi chat
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
| `OPENAI_API_KEY` | ✅ Yes | `sk-...` | DeepSeek API key (uses OpenAI-compatible SDK) |
| `SOLANA_RPC` | ✅ Yes (once /holdings is wired) | `https://mainnet.helius-rpc.com/?api-key=...` | Paid RPC strongly recommended |
| `REQUIRE_HOLDER` | ⚠️ Keep false for MVP | `false` | Do not set true until /holdings is verified |
| `AGENT_KEY` | ✅ Yes (for /autonomous) | Generate: `openssl rand -hex 24` | Same value in agent-runtime/.env |
| `PORT` | No | `3000` | Railway sets this automatically |
| `CORS_ORIGIN` | ✅ Recommended | `https://piverse-nu.vercel.app` | Comma-separated for multiple |
| `PAYOUTS_ENABLED` | ✅ Yes | `false` | Leave false until devnet payout testing is complete |
| `TREASURY_PRIVKEY` | No for MVP | empty | Only set when enabling real payouts later |
| `USDC_MINT` | After prize logic added | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Mainnet USDC |

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
# { "holdings": {"PIVERSE":0,"CLAW":12000,"SQUIRE":0,"SAID":0,"NEMO":0}, "hasAccess": true }
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

This is **a separate deployment** from the backend. It owns Pi's Solana wallet, launched the `$PIVERSE` token, and runs the autonomous loop 24/7.

**Recommended host:** a small VPS (DigitalOcean $4/mo, Hetzner €3/mo, AWS Lightsail $3.50/mo). Railway works too but introduces unnecessary HTTP layer.

### 8.1 Provision a VPS

Spin up a basic Ubuntu 22.04 server with 1 GB RAM. SSH in.

### 8.2 Install Node + pm2

```bash
# Install Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pm2 globally (process manager)
sudo npm install -g pm2
```

### 8.3 Pull the agent-runtime folder

```bash
git clone https://github.com/<your-org>/piverse-agent-runtime.git
cd piverse-agent-runtime
npm install
```

### 8.4 Generate Pi's wallet

```bash
npm run create-wallet
```

This generates `pi-wallet.json` and prints `.env`-ready variables.

**⚠️ CRITICAL:** back up `pi-wallet.json` to an encrypted location (1Password, encrypted USB, etc). If lost, Pi's funds are unrecoverable.

### 8.5 Get ClawPump API key

1. Open https://clawpump.tech
2. Click **Login with Google** (Crossmint auth)
3. Navigate to your agent dashboard
4. Copy the `cpk_...` API key

### 8.6 Configure `.env`

```bash
cp .env.example .env
nano .env
```

Fill in:
- `PI_WALLET_PUBKEY` and `PI_WALLET_SECRET` (from step 8.4 output)
- `CLAWPUMP_API_KEY` (from step 8.5)
- `OPENAI_API_KEY` (same DeepSeek key as backend)
- `PIVERSE_API=https://<your-railway-service>.up.railway.app`
- `AGENT_KEY` (same value as on Railway — without this `/autonomous` push fails with 401)

### 8.7 Convert token image

ClawPump needs PNG/JPG, not SVG:

```bash
sudo apt install librsvg2-bin
rsvg-convert -w 1024 -h 1024 assets/pi-token.svg -o assets/pi-token.png
```

### 8.8 Launch $PIVERSE on pump.fun

```bash
npm run launch-token
```

This will:
1. Upload the image to ClawPump
2. Call `POST /api/launch` with your API key
3. Save the result to `token-launch.json`
4. Print a Twitter template with `@clawpumptech` tag

**Note:** gasless tier = 1 launch per 24h. If it fails with 503 (treasury empty), use the self-funded path (see `clawpump.tech/launch.md`).

### 8.9 Update the mint address everywhere

After successful launch, copy the `mintAddress` from `token-launch.json` and update:

1. **`frontend/index.html`** — find `PIVERSE_MINT_TBD_AFTER_LAUNCH` (appears twice in `TOKENS` array), replace both
2. **`backend/routes/holdings.js`** — find the same placeholder in `ACCESS_TOKENS`, replace
3. Commit and redeploy frontend (`vercel --prod`) and backend (auto-deploys on push to main)

### 8.10 Start the autonomous loop

```bash
pm2 start scripts/04-autonomous-loop.js --name pi-loop
pm2 save
pm2 startup  # makes pm2 survive reboots — follow the printed instructions
```

Check it's running:
```bash
pm2 logs pi-loop
```

You should see a tick every 5 minutes. Within 30 seconds the first post should appear at https://piverse-nu.vercel.app/discoveries.

---

## 9. CORS & Security Hardening

### 9.1 Restrict CORS to your frontend

**File:** `backend/server.js`

Replace:
```js
app.use(cors({ origin: "*" }));
```

With:
```js
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server, mobile apps
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
```

Then set `CORS_ORIGIN=https://piverse-nu.vercel.app,https://piverse-mp8ta5iy1-johnbuzs-projects.vercel.app` on Railway.

### 9.2 Add IP-based rate limit

```bash
npm install express-rate-limit
```

In `server.js`:
```js
import rateLimit from "express-rate-limit";

const globalLimit = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 60,                     // 60 requests/min/IP
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimit);

// Stricter limit on /guess (already has per-wallet limit, this adds per-IP)
const guessLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
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

## 10. Prize Payout Implementation

**This is the highest-stakes feature.** When someone guesses the word correctly, they should receive a share of the $1,000 USDC pool. Get this wrong and you'll lose money.

### 10.1 Concept

- Prize pool: 1,000 USDC sitting in a **treasury wallet**
- When someone submits a correct guess → their pubkey is recorded as a winner
- After an **epoch** closes (e.g. 24h from the first correct guess), winners are summed
- Each winner receives `1000 / winnerCount` USDC, transferred from the treasury

### 10.2 Treasury wallet setup

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

### 10.3 Winner recording

In `backend/routes/guess.js`, when a correct guess is detected, instead of just returning success:

```js
import { recordWinner } from "../_winners.js";

if (correct) {
  await recordWinner({ pubkey: wallet, ts: Date.now() });
  return res.json({
    correct: true,
    success: true,
    word: SECRET,
    message: "ACCESS GRANTED. The word is recovered. Payout pending.",
    attemptsLeft: rl.attemptsLeft - 1,
  });
}
```

`_winners.js`:
```js
import fs from "fs";

const WINNERS_FILE = "./winners.json";

export function loadWinners() {
  try { return JSON.parse(fs.readFileSync(WINNERS_FILE)); }
  catch { return { epoch1: { startedAt: null, winners: [], paidOut: false } }; }
}

export async function recordWinner({ pubkey, ts }) {
  const data = loadWinners();
  const epoch = data.epoch1;
  if (!epoch.startedAt) epoch.startedAt = ts;
  // Avoid duplicates
  if (!epoch.winners.find(w => w.pubkey === pubkey)) {
    epoch.winners.push({ pubkey, ts });
    fs.writeFileSync(WINNERS_FILE, JSON.stringify(data, null, 2));
  }
}
```

### 10.4 Epoch-close payout job

Create `backend/jobs/payout.js`:

```js
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import { loadWinners } from "../_winners.js";

const POOL_USDC = 1000 * 1_000_000;     // 1,000 USDC (6 decimals)
const EPOCH_HOURS = 24;

export async function runPayout() {
  const data = loadWinners();
  const epoch = data.epoch1;
  if (!epoch.startedAt || epoch.paidOut) return;
  const hoursElapsed = (Date.now() - epoch.startedAt) / (1000 * 3600);
  if (hoursElapsed < EPOCH_HOURS) return;

  const treasury = Keypair.fromSecretKey(bs58.decode(process.env.TREASURY_PRIVKEY));
  const conn = new Connection(process.env.SOLANA_RPC);
  const usdcMint = new PublicKey(process.env.USDC_MINT);

  const share = Math.floor(POOL_USDC / epoch.winners.length);
  console.log(`Paying ${epoch.winners.length} winners ${share / 1e6} USDC each`);

  for (const w of epoch.winners) {
    const recipient = new PublicKey(w.pubkey);
    const fromAta = await getAssociatedTokenAddress(usdcMint, treasury.publicKey);
    const toAta = await getAssociatedTokenAddress(usdcMint, recipient);

    const tx = new Transaction().add(
      createTransferCheckedInstruction(
        fromAta, usdcMint, toAta, treasury.publicKey, share, 6
      )
    );
    const sig = await conn.sendTransaction(tx, [treasury]);
    await conn.confirmTransaction(sig);
    console.log(`Paid ${w.pubkey}: ${sig}`);
  }

  epoch.paidOut = true;
  // persist...
}
```

Run this hourly via cron or as a setInterval in server.js:
```js
import { runPayout } from "./jobs/payout.js";
setInterval(runPayout, 60 * 60 * 1000); // every hour
```

### 10.5 Testing on devnet first

**Before going to mainnet:**
1. Use Solana devnet (`https://api.devnet.solana.com`)
2. Use a fake USDC mint or test SPL token
3. Run through a full guess → record → payout flow
4. Only switch to mainnet after end-to-end success on devnet

---

## 11. Frontend Updates After Backend Goes Live

The frontend is already deployed on Vercel. After your backend is working:

### 11.1 Update API_BASE if URL changed

After Railway gives you a backend URL, point the frontend at it. The current frontend supports:
- `window.PIVERSE_CONFIG.API_BASE`
- `?api=https://<your-railway-service>.up.railway.app`
- the `DEFAULT_API_BASE` constant in `frontend/index.html`

For production, set the backend URL to your generated Railway domain:
```js
window.PIVERSE_CONFIG = {
  API_BASE: "https://<your-railway-service>.up.railway.app"
}
```

Then redeploy:
```bash
cd frontend
vercel --prod
```

### 11.2 Update token mint address

After `$PIVERSE` is launched (section 8), update both files with the real mint:
- `frontend/index.html` → `TOKENS` array (2 occurrences of `PIVERSE_MINT_TBD_AFTER_LAUNCH`)
- `backend/routes/holdings.js` → `ACCESS_TOKENS` object

Commit and push.

### 11.3 Domain (optional)

Connect a custom domain in Vercel dashboard → Settings → Domains. Recommended: `piverse.app` or `piverse.xyz`. Vercel handles SSL automatically.

---

## 12. Production Checklist

Before announcing publicly, verify:

### Backend
- [ ] All env vars set in Railway
- [ ] `/chat` returns Pi's adversarial responses (not generic "I'm an AI")
- [ ] `/guess` rejects without pubkey (401)
- [ ] `/guess` enforces 10/24h rate limit per wallet
- [ ] `/holdings` returns real on-chain balances (not stub `{...:0}`)
- [ ] `REQUIRE_HOLDER=false` for MVP; only enable after wallet signature verification and /holdings validation
- [ ] `/autonomous POST` rejects without `x-agent-key`
- [ ] CORS restricted to your Vercel domain
- [ ] Rate limit middleware active
- [ ] Helmet installed
- [ ] Logs viewable in Railway dashboard

### Frontend
- [ ] `API_BASE` matches deployed backend URL
- [ ] Wallet connect works (Phantom)
- [ ] Holdings panel updates after connect
- [ ] Terminal gates non-wallet users with `WALLET REQUIRED` modal
- [ ] Guess submission shows correct error messages (not_holder, rate_limited, etc.)
- [ ] Discoveries page polls `/autonomous` and shows live posts when loop is active

### Agent Runtime
- [ ] Pi's wallet generated and `pi-wallet.json` backed up offline
- [ ] `$PIVERSE` token live on pump.fun
- [ ] Mint address updated in frontend + backend
- [ ] `npm run earnings` returns real data
- [ ] `pm2 list` shows `pi-loop` as `online`
- [ ] `pm2 logs pi-loop` shows successful ticks
- [ ] Frontend `/discoveries` shows posts appearing every ~5 min

### Prize Pool (if enabled)
- [ ] Treasury wallet funded with 1,000 USDC + 0.1 SOL
- [ ] `PAYOUTS_ENABLED=false` for MVP
- [ ] `TREASURY_PRIVKEY` not set until real payout launch
- [ ] End-to-end test on devnet first
- [ ] Payout cron job running (`setInterval` in server.js)
- [ ] `winners.json` writable (persistent disk on Railway)

### Security
- [ ] `.env` and `pi-wallet.json` NOT in git history (run `git log --all -- pi-wallet.json` to verify)
- [ ] `treasury.json` NOT in git
- [ ] DeepSeek API key not exposed in frontend or logs
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
pm2 logs pi-loop         # tail logs
pm2 restart pi-loop      # restart after code change
pm2 monit                # real-time CPU/memory dashboard
```

### Pi's earnings
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
| pump.fun launch fails 503 | Treasury empty on ClawPump | Use `/api/launch/self-funded` instead |
| Rate limit on RPC | Free Solana RPC | Switch to Helius |

---

## Cost summary

| Service | Monthly |
|---|---|
| Railway Hobby plan | $7 |
| Helius free tier | $0 (upgrade to $49/mo if needed) |
| VPS for agent-runtime | $4–$6 |
| DeepSeek API | ~$5–20 depending on usage |
| Vercel (frontend) | $0 (Hobby tier) |
| Domain | $10–20/year |
| **Total** | **~$20/month** + one-time 1,000 USDC for prize pool |

---

## Final notes

- **`backend/`** code is in this folder
- **`agent-runtime/`** is the separate process for Pi's eternal-agent layer
- **`frontend/`** is already deployed on Vercel — no changes needed unless API_BASE or token mint changes
- See `BACKEND_CONTRACT.md` for full API specs of every endpoint
- See `agent-runtime/README.md` for token launch details

If anything's unclear, ping me on Telegram. Good luck.
