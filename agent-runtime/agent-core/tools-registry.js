// ═══════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════
// Loads all tools, exposes their OpenAI-compatible definitions to
// the LLM, and dispatches tool calls back to the right module.
// ═══════════════════════════════════════════════════════════════

import * as postThought from "./tools/post_thought.js";
import * as staySilent from "./tools/stay_silent.js";
import * as tweet from "./tools/tweet.js";
import * as reflect from "./tools/reflect.js";

const tools = {
  post_thought: postThought,
  stay_silent: staySilent,
  tweet: tweet,
  reflect: reflect,
};

// OpenAI function-calling schema array — fed to LLM as `tools` param
export function getToolDefinitions() {
  return Object.values(tools).map(t => ({
    type: "function",
    function: t.definition,
  }));
}

// Execute a tool by name. Returns { ok, ...result }
export async function executeTool(name, args, ctx) {
  const tool = tools[name];
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  try {
    const result = await tool.execute(args, ctx);
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function listToolNames() {
  return Object.keys(tools);
}
