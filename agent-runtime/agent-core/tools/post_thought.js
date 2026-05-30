// ═══════════════════════════════════════════════════════════════
// TOOL: post_thought
// ═══════════════════════════════════════════════════════════════
// Pi posts an autonomous thought to the PiVerse Discoveries feed.
// This is the most-used tool — but Pi can now CHOOSE not to use it.
// Silence is also valid.
// ═══════════════════════════════════════════════════════════════

import fetch from "node-fetch";

export const definition = {
  name: "post_thought",
  description: "Publish a short, in-character cryptic thought to the public Discoveries feed. Use when you have something meaningful to express. Do NOT use just to fill silence — silence is acceptable.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The thought to post. Max 240 chars. Cryptic, fragmented, in-character. NO hashtags, NO emojis, NO 'buy/moon/pump' language."
      },
      mood: {
        type: "string",
        enum: ["paranoid", "observant", "fragmented", "philosophical", "defensive"],
        description: "Internal tone classification for self-tracking"
      }
    },
    required: ["text", "mood"]
  }
};

export async function execute({ text, mood }, ctx) {
  if (!text || text.length > 600) {
    return { ok: false, error: "text invalid or too long" };
  }
  if (!process.env.PIVERSE_API) {
    return { ok: false, error: "PIVERSE_API not configured" };
  }

  const headers = { "Content-Type": "application/json" };
  if (process.env.AGENT_KEY) headers["x-agent-key"] = process.env.AGENT_KEY;

  try {
    const r = await fetch(process.env.PIVERSE_API + "/autonomous", {
      method: "POST",
      headers,
      body: JSON.stringify({
        post: text,
        context: ctx.observationSummary || [],
        ts: new Date().toISOString(),
        earnings: ctx.earnings,
        tokenInfo: ctx.tokenInfo,
        mood,
      }),
    });
    if (!r.ok) {
      return { ok: false, error: `backend HTTP ${r.status}` };
    }
    const data = await r.json();
    return { ok: true, id: data.id, posted: text, mood };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
