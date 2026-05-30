# Pi — True Agent Architecture

This folder contains the **agentic brain** of Pi. The old `04-autonomous-loop.js` ran a fixed cron-job that always generated a post. This v2 system replaces that with **real agency**: Pi has tools, makes decisions, and remembers.

---

## What makes this a real agent (not a cron bot)

Five things distinguish an agent from a scheduled task:

| Property | Cron bot | Pi v2 |
|---|---|---|
| Choice of action | None — always does the same thing | ✅ Picks from 4 tools via LLM function calling |
| Memory | Only the last log line | ✅ Persistent JSON across reboots, fed back as context |
| Goals | Hardcoded behavior | ✅ Explicit goals shape every decision |
| Self-reflection | None | ✅ `reflect` tool lets Pi journal about its own patterns |
| Failure recovery | Crashes or repeats | ✅ Failures recorded as tool stats, Pi adapts |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  scripts/06-agent-loop.js                            │
│  Entry point. Runs every 5 min.                      │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│  agent-core/observe.js                               │
│  Gathers: earnings, wallet balance, market data      │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│  agent-core/memory.js                                │
│  Loads pi-memory.json — past decisions, reflections, │
│  goals, tool performance stats                       │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│  agent-core/decision-engine.js                       │
│  Sends to DeepSeek with tools enabled.               │
│  LLM picks 0+ tools to call this tick.               │
└──────┬───────────────────────────────────────────────┘
       │ tool_calls: [post_thought, reflect, ...]
       ▼
┌──────────────────────────────────────────────────────┐
│  agent-core/tools-registry.js                        │
│  Dispatches each tool call to its module             │
└──────┬───────────────────────────────────────────────┘
       │
       ├─→ post_thought.js   (real: POSTs to /autonomous)
       ├─→ stay_silent.js    (no-op, recorded as choice)
       ├─→ tweet.js          (simulated by default; flag flips to real)
       └─→ reflect.js        (writes to memory, never public)
       │
       ▼
┌──────────────────────────────────────────────────────┐
│  Each result + reasoning saved to pi-memory.json     │
│  Next tick sees this history as context              │
└──────────────────────────────────────────────────────┘
```

---

## The 4 tools

### Always real (no flag needed)
- **`post_thought`** — publish a thought to Discoveries feed
- **`stay_silent`** — explicit choice to do nothing this tick
- **`reflect`** — private journal entry (never seen by users)

### Simulated by default, real with `EXECUTE_REAL_TXNS=true`
- **`tweet`** — post to X. Real implementation needs Twitter API keys (TODO block in tool source).

**Why simulated by default?** Because tweeting is a one-way action with social risk. We want Pi making **real decisions** about whether to do it, but not actually firing until you've reviewed the decision logs and trust the behavior.

---

## Persistent memory schema (`pi-memory.json`)

```json
{
  "identity": { "name": "Pi", "wallet": "...", "tokenMint": "..." },
  "goals": [
    { "id": "G1", "text": "Grow community sustainably", "priority": 1 }
  ],
  "observations": [{ "ts": "...", "earnings": {...}, "tokenInfo": {...} }],
  "decisions": [
    {
      "ts": "...", "tick": 42,
      "toolName": "post_thought",
      "args": { "text": "...", "mood": "paranoid" },
      "outcome": "ok",
      "reasoning": "Holders just crossed 100. Worth marking."
    }
  ],
  "reflections": [
    { "ts": "...", "tick": 40, "text": "Posted 3 ticks in a row. Slowing down." }
  ],
  "toolStats": {
    "post_thought": { "called": 24, "succeeded": 23, "failed": 1 },
    "stay_silent":  { "called": 47, "succeeded": 47, "failed": 0 }
  },
  "lastTickAt": "2026-05-30T...",
  "tickCount": 73
}
```

Every tick, the LLM sees a compact view of this memory (goals + last 8 decisions + last 3 reflections + tool perf) before choosing what to do next. This is what makes Pi adaptive.

---

## How to run

### First time
```bash
cd agent-runtime
npm install              # if not already done
# (run 01..03 first to get wallet + token launched)
npm run agent
```

You'll see ticks like:
```
─── tick 1 @ 2026-05-30T17:42:00 ───
  [observe] gathering state...
            Earned 0.42 SOL total · 12 holders · MCAP 45000
  [decide] calling LLM with 4 tools available...
  [reason] Earnings growing. Holder count notable threshold. Worth a quiet reaction.
  [acted] post_thought
           ✓ post_thought "twelve. another one found the channel. interesting..."
  [persist] memory saved · 2.3s tick
```

### Production
```bash
pm2 start scripts/06-agent-loop.js --name pi-agent
pm2 save
pm2 logs pi-agent
```

To enable real tweets (after testing):
```bash
# in .env
EXECUTE_REAL_TXNS=true
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_SECRET=...
pm2 restart pi-agent
```

---

## How to add a new tool

1. Create `agent-core/tools/your_tool.js` with:
   ```js
   export const definition = { name: "your_tool", description: "...", parameters: {...} };
   export async function execute(args, ctx) { ... return { ok: true, ... } }
   ```
2. Register in `tools-registry.js`:
   ```js
   import * as yourTool from "./tools/your_tool.js";
   const tools = { ..., your_tool: yourTool };
   ```
3. Done. Next tick the LLM sees it as available.

---

## Differences from v1 loop (04-autonomous-loop.js)

| | v1 (`loop`) | v2 (`agent`) |
|---|---|---|
| Always posts | ✅ | ❌ — can choose silence |
| Tool calling | ❌ | ✅ — 4 tools |
| Memory persistence | ❌ (just logs) | ✅ `pi-memory.json` |
| Reflection | ❌ | ✅ `reflect` tool |
| Tweet capability | ❌ | ✅ (simulated by default) |
| Goal-oriented prompt | ❌ | ✅ Explicit goal list |
| Adaptive behavior | ❌ | ✅ Past decisions inform next |

Both are still available — `npm run loop` (v1) and `npm run agent` (v2). Use v2 for everything new.
