import { sha256 } from "./_db.js";

const DEFAULT_BASE_URL = "https://clawpump.tech/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

export function clawpumpConfigured() {
  return Boolean(process.env.CLAWPUMP_API_KEY && process.env.CLAWPUMP_AGENT_ID);
}

export function clawpumpAgentId() {
  return process.env.CLAWPUMP_AGENT_ID || null;
}

export async function startAgent() {
  return request(`/agents/${encodedAgentId()}/start`, { method: "POST" });
}

export async function stopAgent() {
  return request(`/agents/${encodedAgentId()}/stop`, { method: "POST" });
}

export async function sendAgentMessage(message) {
  if (!message || typeof message !== "string" || !message.trim()) {
    throw serviceError("message_required", 400);
  }
  if (message.length > 2_000) {
    throw serviceError("message_too_long", 400);
  }
  return request(`/agents/${encodedAgentId()}/chat`, {
    method: "POST",
    body: { message: message.trim() },
  });
}

export async function getAgentMessages() {
  return request(`/agents/${encodedAgentId()}/messages`);
}

export async function listSkills() {
  return request("/skills");
}

export function normalizeAgentMessages(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.messages || payload?.data || payload?.items || [];

  return Array.isArray(list) ? list.map(normalizeMessage).filter(Boolean) : [];
}

export function autonomousPostId(message) {
  return `CP-${sha256(`${clawpumpAgentId()}:${message.id}`).slice(0, 24).toUpperCase()}`;
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") return null;
  const id = message.id || message.messageId || message.message_id || message.uuid;
  const content = message.content || message.message || message.text || message.output;
  if (!id || typeof content !== "string" || !content.trim()) return null;
  return {
    id: String(id),
    role: String(message.role || message.author || message.type || "").toLowerCase(),
    content: content.trim(),
    createdAt: message.createdAt || message.created_at || message.timestamp || null,
  };
}

async function request(path, { method = "GET", body } = {}) {
  ensureConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.CLAWPUMP_API_KEY}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      const err = serviceError("clawpump_request_failed", response.status >= 500 ? 502 : response.status);
      err.upstreamStatus = response.status;
      throw err;
    }
    return payload;
  } catch (err) {
    if (err.name === "AbortError") throw serviceError("clawpump_timeout", 504);
    if (err.status) throw err;
    throw serviceError("clawpump_unavailable", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function baseUrl() {
  return (process.env.CLAWPUMP_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function encodedAgentId() {
  ensureConfigured();
  return encodeURIComponent(process.env.CLAWPUMP_AGENT_ID);
}

function ensureConfigured() {
  if (!clawpumpConfigured()) throw serviceError("clawpump_not_configured", 503);
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { content: text };
  }
}

function serviceError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}
