// Standalone schema migration runner. Invoked by the Kubernetes migration Job
// (`npm run migrate`) and usable locally. Applies db/schema.sql then exits.

import pool, { initSchema } from "./db.js";

async function main() {
  console.log("Running database migration...");
  await initSchema();
  console.log("Migration complete.");
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
