import dotenv from "dotenv";
dotenv.config();

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to seed.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

try {
  await pool.query(
    `insert into prize_epochs (epoch_number, status)
     values (1, 'open')
     on conflict (epoch_number) do nothing`
  );
  console.log("PiVerse seed complete.");
} finally {
  await pool.end();
}
