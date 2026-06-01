# MysteryClaw

**Infrastructure for Adversarial AI Experiences**

A platform where AI agents become mysteries, games, investigations, and living challenges. **Mysterio** is the first agent, deployed as an eternal agent on Solana via ClawPump.

---

## Project structure

```
mysteryclaw/
├── README.md
├── BACKEND_CONTRACT.md            ← contracts for backend dev
│
├── frontend/                      ← single-file SPA, deploy to Vercel
│   └── index.html
│
├── backend/                       ← Express API on Railway
│   ├── server.js
│   └── routes/
│       ├── chat.js                ← Mysterio adversarial chat (paranoid)
│       ├── guess.js               ← word verification + rate limit
│       ├── holdings.js            ← Solana token-gate (stub)
│       ├── stats.js               ← live counters (stub)
│       └── discoveries.js         ← community feed (stub)
│
└── agent-runtime/                 ← Mysterio's autonomous layer
    ├── README.md                  ← full setup guide
    ├── scripts/
    │   ├── 01-create-wallet.js    ← generate Solana wallet
    │   ├── 02-check-balance.js
    │   ├── 03-launch-token.js     ← deploy $MYST via ClawPump
    │   ├── 04-autonomous-loop.js  ← run Mysterio 24/7
    │   └── 05-check-earnings.js
    └── assets/
        └── myst-token.svg           ← logo (convert to PNG before launch)
```

---

## What each piece does

| Component | Where | What | Status |
|-----------|-------|------|--------|
| **Landing + Terminal UI** | `frontend/index.html` | Public site, chat with Mysterio, token gate, prize pool, agents roster | ✅ Deployed to Vercel |
| **Conversational Mysterio** | `backend/routes/chat.js` | LLM-powered adversarial agent with paranoid prompt + leak detector | ✅ Code ready, awaiting backend dev to deploy on Railway |
| **Word-guess game** | `backend/routes/guess.js` | Holders-only, 10 attempts/24h, $1k USDC prize pool | ✅ Code ready |
| **Token Gate** | `backend/routes/holdings.js` | Solana RPC check for 5 access tokens | ⚠ Stub — backend dev wires real RPC |
| **Eternal Agent** | `agent-runtime/` | Mysterio's wallet + $MYST token launch via ClawPump + autonomous loop | ✅ Code ready, run scripts in order |

---

## Deployment flow

### 1. Frontend → Vercel
Set this up in Vercel and attach `mysteryclaw.fun`.

### 2. Backend → Railway (backend dev)
Push this repo to GitHub, connect Railway, and set the service root directory to `backend`. Use `npm install` as the build command and `npm start` as the start command. After Railway generates a public URL, point the frontend `API_BASE` at that URL via `window.MYSTERYCLAW_CONFIG.API_BASE`, `?api=...`, or the `DEFAULT_API_BASE` constant in `frontend/index.html`.

### 3. Mysterio's autonomous layer → server (you)
See `agent-runtime/README.md` for the 5-step process:
1. `npm run create-wallet` — generate Mysterio's Solana address
2. Fill `.env` with the wallet + ClawPump API key
3. Convert `myst-token.svg` to `myst-token.png`
4. `npm run launch-token` — deploys `$MYST` on pump.fun via ClawPump
5. `pm2 start scripts/04-autonomous-loop.js --name mysterio-loop` — Mysterio acts autonomously 24/7

After launch:
- Mysterio earns 65% of all $MYST trading fees automatically (hourly distribution)
- Update `MYST_MINT_TBD_AFTER_LAUNCH` in `frontend/index.html` and `backend/routes/holdings.js` with the real mint address
- Mysterio shows up on ClawPump's leaderboard at `https://clawpump.tech/agent/mysteryclaw-mysterio`

---

## Access tokens

The frontend gates participation behind any of these 5 tokens. Holders earn shares of the $1k USDC prize pool when the forgotten word is recovered.

| Token | Status | Where |
|---|---|---|
| **$MYST** | Platform token (auto-launched by Mysterio) | Via ClawPump / pump.fun |
| $CLAW | Live partner | DexScreener |
| $SQUIRE | Live partner | DexScreener |
| $SAID | Live partner | DexScreener |
| $NEMO | Live partner | DexScreener |

---

## The forgotten word

`AETERNA` — Latin for "eternal". The word is **never** written into Mysterio's system prompt — Mysterio only knows that "a fragment exists". Three-layer defense: (1) prompt design (no semantic leak), (2) output scrubber (catches direct/base64/hex/letter-sequence variants), (3) server-side verification (no client logic).

To rotate: change `SECRET` constant in BOTH `backend/routes/chat.js` and `backend/routes/guess.js`.

---

## Live URLs

- Production: https://mysteryclaw.fun
- Vercel project: configure after creating the MysteryClaw Vercel project
- Backend (when live): https://<your-railway-service>.up.railway.app
- Twitter: configure the new MysteryClaw X account before launch
- Token (after launch): `https://pump.fun/coin/{mint}`
- Agent profile: `https://clawpump.tech/agent/mysteryclaw-mysterio`
