// ═══════════════════════════════════════════════════════════════
// TOOL: reflect
// ═══════════════════════════════════════════════════════════════
// Pi writes a private journal entry about its own state, recent
// performance, or strategy adjustments. This is NOT posted publicly.
// It's stored in pi-memory.json and fed back to Pi on the next tick
// so it can build long-term strategy.
//
// This is the closest thing Pi has to "thinking out loud about itself."
// ═══════════════════════════════════════════════════════════════

import { recordReflection } from "../memory.js";

export const definition = {
  name: "reflect",
  description: "Write a PRIVATE reflection (not posted publicly) about your own behavior, strategy, or state. Use this when patterns emerge — e.g. 'I've been posting too much', 'the holders are getting impatient', 'my last 5 tweets all sounded the same'. These notes shape your future decisions.",
  parameters: {
    type: "object",
    properties: {
      reflection: {
        type: "string",
        description: "Internal observation about yourself. Max 300 chars. First-person, honest, strategic."
      }
    },
    required: ["reflection"]
  }
};

export async function execute({ reflection }, ctx) {
  if (!reflection) return { ok: false, error: "reflection required" };
  if (reflection.length > 500) return { ok: false, error: "reflection too long" };
  // record into memory directly
  if (ctx?.memory) {
    recordReflection(ctx.memory, reflection);
  }
  return { ok: true, reflected: reflection };
}
