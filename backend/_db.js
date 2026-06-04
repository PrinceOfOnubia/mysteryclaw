import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

export const hasDatabase = Boolean(process.env.DATABASE_URL);

export const pool = hasDatabase
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    })
  : null;

export async function query(text, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is required for this operation");
  }
  return pool.query(text, params);
}

export async function migrateDatabase() {
  if (!pool) return false;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(__dirname, "db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  return true;
}

export function requireDatabase() {
  if (!pool) {
    const err = new Error("database_not_configured");
    err.status = 503;
    throw err;
  }
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function redactSecret(value) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 8) return "***";
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

export async function auditLog(eventType, details = {}) {
  if (!pool) return;
  try {
    await pool.query(
      `insert into audit_logs (event_type, actor, wallet_pubkey, details)
       values ($1, $2, $3, $4)`,
      [
        eventType,
        details.actor || null,
        details.wallet_pubkey || null,
        JSON.stringify(details),
      ]
    );
  } catch (err) {
    console.error("[audit] failed:", err.message);
  }
}
