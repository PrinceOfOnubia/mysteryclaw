// ═══════════════════════════════════════════════════════════════
// TOOL: stay_silent
// ═══════════════════════════════════════════════════════════════
// Mysterio consciously chooses to do nothing this tick. This is a REAL
// agent decision — most cron bots can't do this. Adds narrative
// scarcity (Mysterio doesn't spam) and lets Mysterio conserve compute.
// ═══════════════════════════════════════════════════════════════

export const definition = {
  name: "stay_silent",
  description: "Take no public action this tick. Use when there's nothing worth saying, when activity is too low, or when staying silent serves the adversarial character better than speaking. Silence is a tool, not a failure.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Short internal note for memory — why staying silent this tick"
      }
    },
    required: ["reason"]
  }
};

export async function execute({ reason }) {
  return { ok: true, silent: true, reason };
}
