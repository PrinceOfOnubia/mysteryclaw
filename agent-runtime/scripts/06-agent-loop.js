// ═══════════════════════════════════════════════════════════════
// AGENT LOOP v2 — TRUE AGENCY EDITION
// ═══════════════════════════════════════════════════════════════
// `npm run agent`
//
// What's different from 04-autonomous-loop.js:
//   - Mysterio has TOOLS it chooses between (post, silent, react, buyback,
//     tweet, reflect) — not a hardcoded "generate post" flow
//   - Mysterio has PERSISTENT MEMORY across ticks (mysterio-memory.json)
//   - Mysterio has GOALS that bias every decision
//   - Mysterio has REFLECTION — it analyzes its own behavior periodically
//   - Decisions are LOGGED with full reasoning trail
//
// Use this instead of 04-autonomous-loop.js for v2+ deployments.
// ═══════════════════════════════════════════════════════════════

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

import { loadMemory, saveMemory } from "../agent-core/memory.js";
import { gatherObservation } from "../agent-core/observe.js";
import { runDecisionCycle } from "../agent-core/decision-engine.js";

const TICK_MS = parseInt(process.env.LOOP_TICK_MS || "300000", 10); // 5 min default
const LAUNCH_FILE = path.resolve("./token-launch.json");

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  MYSTERIO AGENT v2 — TRUE AGENCY EDITION");
console.log("═══════════════════════════════════════════════════════════════");

// Load or initialize memory
const memory = loadMemory();
if (!memory.identity.wallet) memory.identity.wallet = process.env.MYSTERIO_WALLET_PUBKEY || process.env.PI_WALLET_PUBKEY || null;
if (!memory.identity.tokenMint && fs.existsSync(LAUNCH_FILE)) {
  try {
    const l = JSON.parse(fs.readFileSync(LAUNCH_FILE, "utf-8"));
    memory.identity.tokenMint = l.mintAddress;
  } catch {}
}
saveMemory(memory);

console.log("  Wallet:    " + (memory.identity.wallet || "(not set)"));
console.log("  Token:     " + (memory.identity.tokenMint || "(not launched)"));
console.log("  Tick:      every " + (TICK_MS / 1000) + "s");
console.log("  Memory:    " + memory.tickCount + " prior ticks · " +
            memory.decisions.length + " decisions · " +
            memory.reflections.length + " reflections");
console.log("  Mode:      " + (process.env.EXECUTE_REAL_TXNS === "true" ? "LIVE TXNS" : "SIMULATED TXNS"));
console.log("");

async function tick() {
  const start = Date.now();
  memory.tickCount++;
  memory.lastTickAt = new Date().toISOString();

  console.log("─── tick " + memory.tickCount + " @ " + memory.lastTickAt + " ───");

  // 1. OBSERVE
  console.log("  [observe] gathering state...");
  const observation = await gatherObservation();
  if (observation.summary?.length) {
    console.log("            " + observation.summary.join(" · "));
  } else {
    console.log("            (no observable data this tick)");
  }

  // 2. DECIDE + ACT
  console.log("  [decide] calling LLM with " + 6 + " tools available...");
  const result = await runDecisionCycle(memory, observation);

  if (!result.ok) {
    console.log("  [decide] FAILED: " + result.error);
  } else {
    if (result.reasoning) {
      console.log("  [reason] " + result.reasoning.replace(/\n/g, "\n           ").slice(0, 300));
    }
    if (result.toolCalls?.length) {
      console.log("  [acted] " + result.toolCalls.join(", "));
      for (const tr of result.toolResults) {
        const sym = tr.result.ok ? "✓" : "✗";
        const tag = tr.result.simulated ? " [SIM]" : "";
        const note = tr.result.posted
          ? '"' + tr.result.posted.slice(0, 60) + '..."'
          : tr.result.reason
            ? "(" + tr.result.reason.slice(0, 60) + ")"
            : tr.result.error
              ? tr.result.error
              : tr.result.reflected
                ? '[reflected]'
                : "";
        console.log("           " + sym + " " + tr.tool + tag + " " + note);
      }
    } else {
      console.log("  [acted] (no tool calls — odd)");
    }
  }

  // 3. PERSIST MEMORY
  saveMemory(memory);
  console.log("  [persist] memory saved · " + ((Date.now() - start) / 1000).toFixed(1) + "s tick\n");
}

// Run immediately, then on interval
try {
  await tick();
} catch (e) {
  console.error("Tick error:", e);
}
if (process.env.RUN_ONCE === "true") {
  console.log("RUN_ONCE=true; exiting after one tick.");
  process.exit(0);
}

setInterval(() => tick().catch(e => console.error("Tick error:", e)), TICK_MS);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nAgent loop stopped. Memory preserved at ./mysterio-memory.json");
  process.exit(0);
});
