import "dotenv/config";
import { readFile } from "node:fs/promises";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
const connectionString = process.env.DATABASE_URL?.trim();

export const databaseConfigured = Boolean(connectionString);
export const pool = databaseConfigured
  ? new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  })
  : null;

export function logDatabaseError(action, error) {
  const details = [];
  if (typeof error?.code === "string") details.push(`code=${error.code}`);
  if (typeof error?.syscall === "string") details.push(`syscall=${error.syscall}`);
  if (Number.isInteger(error?.port)) details.push(`port=${error.port}`);
  console.error(`[database] ${action} failed${details.length ? ` (${details.join(", ")})` : ""}.`);
}

pool?.on("error", (error) => logDatabaseError("idle connection", error));

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
