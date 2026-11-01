import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");

export const databaseConfigured = Boolean(process.env.DATABASE_URL);
export const pool = databaseConfigured
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  })
  : null;

let ready = false;

export function isDatabaseReady() {
  return ready;
}

export async function initializeDatabase() {
  if (!pool) return;
  await pool.query(schema);
  ready = true;
  console.info("PostgreSQL schema is ready.");
}

export async function closeDatabase() {
  if (pool) await pool.end();
}
