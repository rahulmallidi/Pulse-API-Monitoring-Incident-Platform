/**
 * Drop Timescale continuous aggregates that depend on `samples`.
 * Safe to re-run; timescale SQL migrations recreate them with IF NOT EXISTS.
 */
const { Client } = require("pg");

const VIEWS = ["samples_1d", "samples_1h", "samples_5m", "samples_1m"];

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const view of VIEWS) {
      await client.query(`DROP MATERIALIZED VIEW IF EXISTS ${view} CASCADE;`);
      process.stdout.write(`Dropped continuous aggregate ${view} (if present)\n`);
    }
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
