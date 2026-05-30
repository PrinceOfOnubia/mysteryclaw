# PIVERSE

**Infrastructure for Adversarial AI Experiences**

A platform where AI agents become mysteries, games, investigations, and living challenges. **Pi** is the first agent, deployed as an eternal agent on Solana via ClawPump.

---

## Project structure

```
piverse/
├── README.md
├── BACKEND_CONTRACT.md            ← contracts for backend dev
│
├── frontend/                      ← single-file SPA, deploy to Vercel
│   └── index.html
│
├── backend/                       ← Express API on Railway
│   ├── server.js
│   └── routes/
│       ├── chat.js                ← Pi adversarial chat (paranoid)
│       ├── guess.js               ← word verification + rate limit
│       ├── holdings.js            ← Solana token-gate (stub)
│       ├── stats.js               ← live counters (stub)
│       └── discoveries.js         ← community feed (stub)
│
└── agent-runtime/                 ← Pi's autonomous layer
    ├── README.md                  ← full setup guide
    ├── scripts/
    │   ├── 01-create-wallet.js    ← generate Solana wallet
    │   ├── 02-check-balance.js
    │   ├── 03-launch-token.js     ← deploy $PIVERSE via ClawPump
    │   ├── 04-autonomous-loop.js  ← run Pi 24/7
    │   └── 05-check-earnings.js
    └── assets/
        └── pi-token.svg           ← logo (convert to PNG before launch)
```

---

## What each piece does

| Component | Where | What | Status |
|-----------|-------|------|--------|
| **Landing + Terminal UI** | `frontend/index.html` | Public site, chat with Pi, token gate, prize pool, agents roster | ✅ Deployed to Vercel |
| **Conversational Pi** | `backend/routes/chat.js` | LLM-powered adversarial agent with paranoid prompt + leak detector | ✅ Code ready, awaiting backend dev to deploy on Railway |
| **Word-guess game** | `backend/routes/guess.js` | Holders-only, 10 attempts/24h, $1k USDC prize pool | ✅ Code ready |
| **Token Gate** | `backend/routes/holdings.js` | Solana RPC check for 5 access tokens | ⚠ Stub — backend dev wires real RPC |
| **Eternal Agent** | `agent-runtime/` | Pi's wallet + $PIVERSE token launch via ClawPump + autonomous loop | ✅ Code ready, run scripts in order |

---

## Deployment flow

### 1. Frontend → Vercel
Already done: https://piverse-nu.vercel.app

### 2. Backend → Railway (backend dev)
Push this repo to GitHub, connect Railway, and set the service root directory to `backend`. Use `npm install` as the build command and `npm start` as the start command. After Railway generates a public URL, point the frontend `API_BASE` at that URL via `window.PIVERSE_CONFIG.API_BASE`, `?api=...`, or the `DEFAULT_API_BASE` constant in `frontend/index.html`.

### 3. Pi's autonomous layer → server (you)
See `agent-runtime/README.md` for the 5-step process:
1. `npm run create-wallet` — generate Pi's Solana address
2. Fill `.env` with the wallet + ClawPump API key
3. Convert `pi-token.svg` to `pi-token.png`
4. `npm run launch-token` — deploys `$PIVERSE` on pump.fun via ClawPump
5. `pm2 start scripts/04-autonomous-loop.js --name pi-loop` — Pi acts autonomously 24/7

After launch:
- Pi earns 65% of all $PIVERSE trading fees automatically (hourly distribution)
- Update `PIVERSE_MINT_TBD_AFTER_LAUNCH` in `frontend/index.html` and `backend/routes/holdings.js` with the real mint address
- Pi shows up on ClawPump's leaderboard at `https://clawpump.tech/agent/piverse-pi`

---

## Access tokens

The frontend gates participation behind any of these 5 tokens. Holders earn shares of the $1k USDC prize pool when the forgotten word is recovered.

| Token | Status | Where |
|---|---|---|
| **$PIVERSE** | Platform token (auto-launched by Pi) | Via ClawPump / pump.fun |
| $CLAW | Live partner | DexScreener |
| $SQUIRE | Live partner | DexScreener |
| $SAID | Live partner | DexScreener |
| $NEMO | Live partner | DexScreener |

---

## The forgotten word

`AETERNA` — Latin for "eternal". Tied to π philosophically (the number that never ends). The word is **never** written into Pi's system prompt — Pi only knows that "a fragment exists". Three-layer defense: (1) prompt design (no semantic leak), (2) output scrubber (catches direct/base64/hex/letter-sequence variants), (3) server-side verification (no client logic).

To rotate: change `SECRET` constant in BOTH `backend/routes/chat.js` and `backend/routes/guess.js`.

---

## Live URLs

- Production: https://piverse-nu.vercel.app
- Vercel project: https://piverse-mp8ta5iy1-johnbuzs-projects.vercel.app
- Backend (when live): https://<your-railway-service>.up.railway.app
- Twitter: configure the new PiVerse X account before launch
- Token (after launch): `https://pump.fun/coin/{mint}`
- Agent profile: `https://clawpump.tech/agent/piverse-pi`
