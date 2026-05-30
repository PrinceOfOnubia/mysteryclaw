// ═══════════════════════════════════════════════════════════════
// STEP 05 — CHECK PI'S EARNINGS
// ═══════════════════════════════════════════════════════════════
// `npm run earnings`
// Reads agentId from .env, queries ClawPump for total earned,
// pending, and held SOL plus per-token breakdown.
// ═══════════════════════════════════════════════════════════════

import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const AGENT_ID = process.env.CLAWPUMP_AGENT_ID;
if (!AGENT_ID) {
  console.error("CLAWPUMP_AGENT_ID missing in .env");
  process.exit(1);
}

const r = await fetch("https://clawpump.tech/api/fees/earnings?agentId=" + encodeURIComponent(AGENT_ID));
if (!r.ok) {
  console.error("Failed:", r.status, await r.text());
  process.exit(1);
}
const d = await r.json();

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  PI EARNINGS — agentId: " + AGENT_ID);
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("  Total earned:  " + (d.totalEarned || 0).toFixed(6) + " SOL");
console.log("  Already sent:  " + (d.totalSent   || 0).toFixed(6) + " SOL");
console.log("  Pending:       " + (d.totalPending|| 0).toFixed(6) + " SOL");
console.log("  Held:          " + (d.totalHeld   || 0).toFixed(6) + " SOL");
console.log("");

if (d.tokenBreakdown?.length) {
  console.log("  Per-token breakdown:");
  for (const t of d.tokenBreakdown) {
    console.log("    " + t.mintAddress.slice(0, 8) + "...");
    console.log("      collected: " + (t.totalCollected || 0).toFixed(6) + " SOL");
    console.log("      agent (65%): " + (t.totalAgentShare || 0).toFixed(6) + " SOL");
  }
}
console.log("");
