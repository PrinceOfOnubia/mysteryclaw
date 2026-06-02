# MysteryClaw Agent Runtime

This is **Mysterio's autonomous layer**. The conversational Mysterio lives in `../backend` and just answers chat. This runtime makes Mysterio an **eternal agent** in the ClawPump sense — it owns a wallet, launches its own token, earns SOL from creator fees, and runs an autonomous loop reacting to its own data.

---

## What this submits Mysterio as on ClawPump

Per [`clawpump.tech/skill.md`](https://www.clawpump.tech/skill.md), an "eternal agent on Solana" is one that:

1. ✅ Has its own Solana wallet
2. ✅ Launches a token through ClawPump's API (`POST /api/launch`)
3. ✅ Receives 65% of creator fees automatically (auto-distributed hourly)
4. ✅ (Optionally) acts autonomously — self-funded compute, reacts to its environment

This runtime gives Mysterio all four. After running through the 5 steps below, Mysterio has its own `$MYSTO` token on pump.fun, is earning SOL passively, and can be left running 24/7 to act on its own.

---

## Setup (5 steps, ~15 minutes)

### 1. Install deps
```bash
cd agent-runtime
npm install
```

### 2. Create Mysterio's wallet (one-time)
```bash
npm run create-wallet
```
This generates a Solana keypair, saves it to `./agent-wallet.json` (mode 600), and prints `MYSTERIO_WALLET_PUBKEY` + `MYSTERIO_WALLET_SECRET` to paste into `.env`.

⚠️ **BACK UP `agent-wallet.json`**. If you lose it, Mysterio's funds are unrecoverable.

### 3. Configure `.env`

```bash
cp .env.example .env
nano .env
```

Fill in:
- `MYSTERIO_WALLET_PUBKEY` and `MYSTERIO_WALLET_SECRET` from step 2
- `CLAWPUMP_API_KEY` — get this by logging in with Google at https://clawpump.tech (look for `cpk_...` in your dashboard)
- `OPENAI_API_KEY` — same OpenAI API key your backend uses
- Token metadata — `TOKEN_NAME`, `TOKEN_SYMBOL=MYSTO`, `TOKEN_TWITTER=https://x.com/mysteryclawpump?s=11`, etc. Keep the local PNG at `./assets/myst-token.png` and set `TOKEN_IMAGE_URL` to its public HTTPS URL.

### 4. (Optional) Check balance
```bash
npm run fund-check
```
Gasless launches via ClawPump cost nothing. Only fund the wallet (≥0.05 SOL) if you want to use the self-funded path for guaranteed launch.

### 5. Launch the token
```bash
npm run launch-token
```

This will:
1. Validate `./assets/myst-token.png` and its public `TOKEN_IMAGE_URL`
2. Launch `$MYSTO` on pump.fun (`POST https://clawpump.tech/api/v1/launch` with Bearer auth)
3. Save the mint address + tx + pump.fun URL to `./token-launch.json`
4. Print a ready-to-tweet template (tag `@clawpumptech` to get amplified)

You can only launch 1 token per 24 hours per API key (gasless tier).

---

## After launch

### Update the frontend
The mint address from `token-launch.json` should go into `frontend/index.html`. Add a new constant near the top of the `<script>` block:

```js
const MYSTO_TOKEN = {
  mint: "<paste mintAddress here>",
  symbol: "MYSTO",
  pumpUrl: "<paste pumpUrl here>"
};
```

Then add a 5th card to the Token Gate section (this token is the platform's own; the other 4 are existing partner access tokens).

### Run the autonomous loop
```bash
npm run loop
```

Mysterio will now:
- Fetch its earnings every 5 minutes
- Read its token's current market data
- Generate a cryptic in-character post via OpenAI
- Log everything to `./autonomous-log.json`
- (Optional) POST the activity to your backend

To run forever, use `pm2`:
```bash
npm install -g pm2
pm2 start scripts/04-autonomous-loop.js --name mysterio-loop
pm2 save
pm2 startup     # makes it survive reboots
```

### Check earnings anytime
```bash
npm run earnings
```

---

## Architecture diagram

```
   ┌───────────────────────────────────────────────┐
   │   Frontend (Vercel)                           │
   │   - Conversational Mysterio chat                    │
   │   - Token Gate UI                             │
   │   - Word-guess prize game                     │
   └────────────┬──────────────────────────────────┘
                │ HTTPS
                ▼
   ┌───────────────────────────────────────────────┐
   │   Backend (Render — ../backend)               │
   │   - /chat, /guess, /holdings, /stats          │
   │   - Mysterio adversarial personality (LLM)          │
   └────────────┬──────────────────────────────────┘
                │
                │ shares chat memory
                ▼
   ┌───────────────────────────────────────────────┐
   │   Agent Runtime (this folder — pm2/systemd)   │
   │   - Owns agent-wallet.json                       │
   │   - Launched $MYSTO token via ClawPump      │
   │   - Autonomous loop (LLM generates posts)     │
   │   - Reads earnings from ClawPump every tick   │
   └────────────┬──────────────────────────────────┘
                │  HTTPS calls to:
                ▼
   ┌───────────────────────────────────────────────┐
   │   ClawPump (clawpump.tech)                    │
   │   - POST /api/launch        (one-time)        │
   │   - GET  /api/fees/earnings (per tick)        │
   │   - GET  /api/tokens/:mint  (per tick)        │
   └────────────┬──────────────────────────────────┘
                │ deploys & manages
                ▼
   ┌───────────────────────────────────────────────┐
   │   pump.fun bonding curve                      │
   │   $MYSTO — trades, creator fees             │
   └───────────────────────────────────────────────┘
                │ 65% of fees → hourly cron
                ▼
   ┌───────────────────────────────────────────────┐
   │   Mysterio's Solana wallet (agent-wallet.json)         │
   │   Mysterio spends this to fund its own compute      │
   └───────────────────────────────────────────────┘
```

---

## File layout

```
agent-runtime/
├── README.md                          ← this file
├── package.json
├── .env.example                       ← copy to .env and fill in
├── .gitignore                         ← ignores wallet + .env + logs
├── assets/
│   └── myst-token.png                   ← your token image (you provide)
├── scripts/
│   ├── 01-create-wallet.js            ← npm run create-wallet
│   ├── 02-check-balance.js            ← npm run fund-check
│   ├── 03-launch-token.js             ← npm run launch-token
│   ├── 04-autonomous-loop.js          ← npm run loop
│   └── 05-check-earnings.js           ← npm run earnings
│
├── agent-wallet.json                     ← generated, GIT-IGNORED, mode 600
├── token-launch.json                  ← generated after launch
└── autonomous-log.json                ← appended to by the loop
```

---

## What ClawPump sees

After step 5, your "submission" to ClawPump is just **the existence of your launched token**. There is no application form — being on the platform IS the qualification. The skill.md doc shows that "first 50 agents deploy free" refers to gasless launches being free up to platform capacity. You're submitting to the platform by using it.

To increase visibility:
- ✅ Tag `@clawpumptech` on Twitter (template printed after launch)
- ✅ Post on the Moltbook crypto submolt (also templated in launch response)
- ✅ Register your agent profile at `https://clawpump.tech/agent/{your-agent-id}`
- ✅ Run the autonomous loop continuously — eternal agents that actively post and earn rank higher on their leaderboard

`GET /api/leaderboard` shows top agents by `totalEarned`. The loop helps Mysterio climb it.
