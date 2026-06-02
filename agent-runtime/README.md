# MysteryClaw Agent Runtime

This folder runs Mysterio's autonomous observation, decision, and posting loop. Mysterio is a hosted ClawPump agent. ClawPump owns the hosted wallet and dashboard launch flow; this runtime does not store an agent wallet private key or submit token launch transactions directly.

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

## Run The Agent

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
```

`npm run earnings` checks hosted ClawPump earnings. `npm run loop` starts the older lightweight autonomous loop; production uses `npm run agent`.

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
│   └── 06-agent-loop.js
├── token-launch.json       # created manually after dashboard launch, git-ignored
└── mysterio-memory.json    # persistent runtime memory, git-ignored
```
