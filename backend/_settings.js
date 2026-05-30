import { hasDatabase, query } from "./_db.js";

export async function getSetting(key, fallback = null) {
  if (!hasDatabase) return fallback;
  const result = await query(
    `select value from system_settings where key = $1`,
    [key]
  );
  return result.rows[0]?.value ?? fallback;
}

export async function setSetting(key, value, updatedBy = "admin") {
  if (!hasDatabase) {
    const err = new Error("database_not_configured");
    err.status = 503;
    throw err;
  }
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

export async function booleanSetting(key, fallback = false) {
  const value = await getSetting(key, fallback ? "true" : "false");
  return value === true || value === "true";
}
