import "dotenv/config";
import OpenAI from "openai";

const model = process.env.OPENAI_MODEL || "gpt-4o";

function fallback() {
  return "Echo does not answer twice. It repeats until someone understands the first time.";
}

if (!process.env.OPENAI_API_KEY) {
  console.log("OPENAI_API_KEY missing. Dry-run fallback preview:");
  console.log(fallback());
  process.exit(0);
}

try {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are Mysterio. Write one cryptic MysteryClaw X post. No emojis, no hashtags, no price talk." },
      { role: "user", content: "Generate a dry-run Echo-era post. Max 220 characters. Do not reveal hidden answers." },
    ],
    temperature: 0.9,
    max_tokens: 90,
  });
  console.log("Autopost dry-run generated. No tweet posted.");
  console.log(response.choices?.[0]?.message?.content?.trim() || fallback());
} catch (err) {
  console.error("Autopost dry-run failed: " + (err.message || "unknown"));
  process.exit(1);
}
