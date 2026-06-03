import crypto from "crypto";
import pg from "pg";

const { Pool } = pg;

let pool = null;

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function query(sql, params = []) {
  const db = getPool();
  if (!db) {
    const err = new Error("DATABASE_URL not configured");
    err.code = "DATABASE_NOT_CONFIGURED";
    throw err;
  }
  return db.query(sql, params);
}

export async function getSetting(key, fallback = null) {
  if (!hasDatabase()) return fallback;
  const result = await query("select value from system_settings where key = $1", [key]);
  return result.rows[0]?.value ?? fallback;
}

export async function setSetting(key, value, updatedBy = "mysterio-worker") {
  if (!hasDatabase()) return null;
  const result = await query(
    `insert into system_settings (key, value, updated_by)
     values ($1, $2, $3)
     on conflict (key)
     do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
     returning key, value, updated_at`,
    [key, value, updatedBy]
  );
  return result.rows[0];
}

export async function auditLog(eventType, details = {}) {
  if (!hasDatabase()) return;
  await query(
    `insert into audit_logs (event_type, actor, details)
     values ($1, $2, $3::jsonb)`,
    [eventType, "mysterio-worker", JSON.stringify(details)]
  );
}

export async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
