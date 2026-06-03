# MysteryClaw Agent Runtime

This folder runs Mysterio's autonomous observation, decision, and posting loop. Mysterio is a hosted ClawPump agent. ClawPump owns the hosted wallet and dashboard launch flow; this runtime does not store an agent wallet private key or submit token launch transactions directly.

Mysterio is also the narrative owner of MysteryClaw's hidden words. For live epochs, the secret should be generated and sealed through the private challenge flow, then stored server-side for verification without exposing it to operators. The team runs the infrastructure; Mysterio chooses what the players must uncover.

## Setup

```bash
cd agent-runtime
npm ci
cp .env.example .env
nano .env
```

Required values:

- `CLAWPUMP_API_KEY`: hosted ClawPump API key.
- `CLAWPUMP_AGENT_ID`: hosted agent UUID from the ClawPump dashboard.
- `CLAWPUMP_AGENT_NAME=Mysterio`
- `CLAWPUMP_AGENT_WALLET_PUBKEY`: hosted agent wallet public address from the ClawPump dashboard. Public address only.
- `OPENAI_API_KEY`: OpenAI API key for autonomous decisions.
- `MYSTERYCLAW_API`: Railway backend URL.
- `AGENT_KEY`: same shared secret configured on Railway.
- `EXECUTE_REAL_TXNS=false`: keep false until a separate transaction review is completed.

Do not add wallet private keys to this runtime.

## Launched Token

`$MYSTO` CA:

```text
G6E1GoffSHQU2GGuZXcojs1RRYx6MmtgJVeB69s3eYKQ
```

Set `MYSTO_TOKEN_MINT` in `.env` so the runtime observes the launched token and persists it in Mysterio's memory.

## Launch Utility

```bash
npm run launch-token
```

The command is retained as a guarded utility. It validates metadata and refuses to submit token transactions directly. Do not launch a second token.

## Railway Worker Deployment

Production automation should run as a separate Railway worker service, not AWS/PM2.

Recommended Railway service:

```text
Service name: mysterio-worker
Root Directory: agent-runtime
Build Command: npm install
Start Command: npm run worker
```

Required Railway worker env vars:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
DATABASE_URL=
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
X_HANDLE=MysteryClawPump
AUTOPOST_ENABLED=true
AUTOPOST_INTERVAL_MINUTES=60
MYSTERIO_MODE=production
MYSTERYCLAW_API=https://piverse-production.up.railway.app
AGENT_KEY=
CLAWPUMP_API_KEY=
CLAWPUMP_AGENT_ID=
CLAWPUMP_AGENT_NAME=Mysterio
CLAWPUMP_AGENT_WALLET_PUBKEY=
MYSTO_TOKEN_MINT=G6E1GoffSHQU2GGuZXcojs1RRYx6MmtgJVeB69s3eYKQ
```

The worker:

- posts scheduled epoch clues to X when their `scheduled_at` time is due
- generates Mysterio-style X posts between clues
- respects `AUTOPOST_INTERVAL_MINUTES`
- stores last post time, last tweet id, and duplicate hashes in Postgres
- mirrors successful tweets into the MysteryClaw autonomous feed when `MYSTERYCLAW_API` and `AGENT_KEY` are set
- fails safely without posting if X credentials are missing

Safe tests:

```bash
npm run autopost:test  # dry-run generation only, no tweet
npm run x:test         # verifies X credentials and previews text, no tweet
```

Real X test, only when you intentionally want to post:

```bash
npm run x:test -- --post --text "Mysterio test transmission."
```

Disable autopost immediately by setting this in the Railway worker service:

```bash
AUTOPOST_ENABLED=false
```

## Legacy Local / AWS Agent

AWS/PM2 is now optional/deprecated. Keep it stopped once the Railway worker is confirmed online to avoid duplicate posting.

Do not delete the files yet; they remain useful for local dry-runs and emergency rollback.

## Run The Legacy Agent

```bash
npm run agent
```

For PM2:

```bash
pm2 start scripts/06-agent-loop.js --name mysterio-agent
pm2 save
pm2 logs mysterio-agent
```

With `EXECUTE_REAL_TXNS=false`, tool calls remain simulated while Mysterio can still observe state and post autonomous fragments to the backend.

## Utility Commands

```bash
npm run earnings
npm run loop
npm run worker
npm run autopost:test
npm run x:test
```

`npm run earnings` checks hosted ClawPump earnings. `npm run loop` starts the older lightweight autonomous loop; production uses `npm run worker` on Railway.

## Files

```text
agent-runtime/
├── .env.example
├── assets/
│   └── myst-token.png
├── scripts/
│   ├── 03-launch-token.js
│   ├── 04-autonomous-loop.js
│   ├── 05-check-earnings.js
│   ├── 06-agent-loop.js
│   ├── 07-railway-worker.js
│   ├── test-autopost.js
│   └── test-x.js
├── worker/
│   ├── db.js
│   └── x-client.js
├── token-launch.json       # created manually after dashboard launch, git-ignored
└── mysterio-memory.json    # persistent runtime memory, git-ignored
```
