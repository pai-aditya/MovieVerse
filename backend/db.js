// PostgreSQL connection + data-access helpers.
// Connection is configured from individual env vars (the Kubernetes-friendly
// way, so each piece can come from a ConfigMap or a Secret) or a single
// DATABASE_URL if provided.

import pkg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pkg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "postgres",
        database: process.env.DB_NAME || "movieverse",
        max: Number(process.env.DB_POOL_MAX || 10),
      }
);

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

export const query = (text, params) => pool.query(text, params);

// Applies schema.sql. Idempotent (CREATE TABLE IF NOT EXISTS), so it is safe to
// call on every boot even though a dedicated migration Job also runs it.
export async function initSchema() {
  const schema = readFileSync(join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Database schema ensured");
}

// Lightweight liveness check for the readiness probe.
export async function checkConnection() {
  await pool.query("SELECT 1");
}

export default pool;
