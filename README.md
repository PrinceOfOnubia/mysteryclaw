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
    │   ├── 03-launch-token.js     ← guarded launch metadata utility
    │   ├── 04-autonomous-loop.js  ← run Mysterio 24/7
    │   └── 05-check-earnings.js
    └── assets/
        └── myst-token.png           ← launched token logo
```

---

## What each piece does

| Component | Where | What | Status |
|-----------|-------|------|--------|
| **Landing + Terminal UI** | `frontend/index.html` | Public site, chat with Mysterio, token gate, prize pool, agents roster | ✅ Deployed to Vercel |
| **Conversational Mysterio** | `backend/routes/chat.js` | LLM-powered adversarial agent with paranoid prompt + leak detector | ✅ Code ready, awaiting backend dev to deploy on Railway |
| **Word-guess game** | `backend/routes/guess.js` | Holders-only, 10 attempts/3h game session, $1k USDC prize pool, server-side verification of Mysterio's sealed word | ✅ Code ready |
| **Token Gate** | `backend/routes/holdings.js` | Solana RPC check for access tokens | ⚠ Stub — backend dev wires real RPC |
| **Eternal Agent** | `agent-runtime/` | Optional AWS loop that observes hosted ClawPump state and posts autonomous fragments | ✅ Optional runtime path |
| **Hosted ClawPump bridge** | `backend/_clawpump.js` | Admin-only hosted Mysterio lifecycle, chat, skills, and selected-message sync | ✅ Optional AWS-independent control path |

---

## Deployment flow

### 1. Frontend → Vercel
Set this up in Vercel and attach `mysteryclaw.xyz`.

### 2. Backend → Railway (backend dev)
Push this repo to GitHub, connect Railway, and set the service root directory to `backend`. Use `npm install` as the build command and `npm start` as the start command. After Railway generates a public URL, point the frontend `API_BASE` at that URL via `window.MYSTERYCLAW_CONFIG.API_BASE`, `?api=...`, or the `DEFAULT_API_BASE` constant in `frontend/index.html`.

### 3. Mysterio's autonomous layer → Railway worker
See `agent-runtime/README.md` for the Railway worker process:
1. Create the hosted Mysterio agent in the ClawPump dashboard
2. Fill `.env` with its UUID, public wallet address, and ClawPump API key
3. Confirm `assets/myst-token.png` is the intended token image
4. Keep `$MYSTO` mint configuration aligned with Railway and the frontend
5. Deploy Railway service `mysterio-worker` with root `agent-runtime` and start command `npm run worker`

AWS/PM2 is deprecated for production automation. Stop PM2 only after the Railway worker is confirmed posting safely.

Launched token:
- Mysterio earns 65% of all $MYSTO trading fees automatically (hourly distribution)
- `$MYSTO` CA: `G6E1GoffSHQU2GGuZXcojs1RRYx6MmtgJVeB69s3eYKQ`
- Use the hosted ClawPump dashboard to inspect Mysterio's profile and wallet

---

## Access tokens

The frontend gates participation behind any of these access tokens. Holders earn shares of the $1k USDC prize pool when the forgotten word is recovered.

| Token | Status | Where |
|---|---|---|
| **$MYSTO** | Platform token | Via ClawPump / pump.fun |
| $CLAW | Live partner | DexScreener |
| $SQUIRE | Live partner | DexScreener |
| $SAID | Live partner | DexScreener |
| $NEMO | Live partner | DexScreener |
| $PENGXBT | Live partner | pump.fun |

---

## The forgotten word

MysteryClaw is designed so the secret feels like it belongs to Mysterio, not the team. For each epoch, Mysterio's private challenge process chooses the word, seals it server-side, and the backend verifies guesses against that sealed value. The frontend never receives the answer, and operators should not read, print, paste, or discuss the live word.

Operationally, the sealed value is held only in Railway env (`SECRET_WORD` for Tale 01, `ECHO_SECRET_WORD` for Echo). Never commit it. Never place it in docs, prompts, screenshots, tickets, logs, or chat. Even the team should treat the live word as unknown.

Defense layers: (1) prompt design keeps the plaintext word out of public/client code, (2) output scrubber catches direct/base64/hex/letter-sequence variants, (3) server-side verification means DevTools or frontend edits cannot win the prize.

To rotate: have Mysterio's private challenge process generate a new word and write only the sealed env value in Railway, then redeploy the backend without revealing the word to humans.

---

## Live URLs

- Production: https://mysteryclaw.xyz
- Vercel project: configure after creating the MysteryClaw Vercel project
- Backend (when live): https://<your-railway-service>.up.railway.app
- X/Twitter: https://x.com/mysteryclawpump?s=11
- Token: `https://pump.fun/coin/G6E1GoffSHQU2GGuZXcojs1RRYx6MmtgJVeB69s3eYKQ`
- Agent profile: open Mysterio from `https://agents.clawpump.tech/dashboard`
