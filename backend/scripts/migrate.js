import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

const schemaPath = path.resolve(__dirname, "../db/schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");

try {
  await pool.query(sql);
  console.log("PiVerse database migration complete.");
} finally {
  await pool.end();
}
