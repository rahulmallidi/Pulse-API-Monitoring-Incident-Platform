const { Client } = require("pg");

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN");

    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

    await client.query(`
      ALTER TABLE incidents
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'pulse',
        ADD COLUMN IF NOT EXISTS vendor_tag TEXT,
        ADD COLUMN IF NOT EXISTS correlation_status TEXT,
        ADD COLUMN IF NOT EXISTS correlated_vendor_incident_id TEXT,
        ADD COLUMN IF NOT EXISTS confirmed_by_vendor_at TIMESTAMPTZ;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_incidents_vendor_state
      ON incidents (vendor_tag, state);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_components (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_tag TEXT NOT NULL,
        component_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(vendor_tag, component_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vendor_components_tag_status
      ON vendor_components (vendor_tag, status);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_tag TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        impact TEXT NOT NULL,
        started_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL,
        affected_components_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
        updates_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_url TEXT,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(vendor_tag, incident_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vendor_incidents_tag_status_updated
      ON vendor_incidents (vendor_tag, status, updated_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_poll_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_tag TEXT NOT NULL UNIQUE,
        host TEXT NOT NULL,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        is_stale BOOLEAN NOT NULL DEFAULT FALSE,
        last_success_at TIMESTAMPTZ,
        last_attempt_at TIMESTAMPTZ,
        last_error TEXT,
        backoff_until TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_vendor_poll_states_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_vendor_poll_states_updated_at'
        ) THEN
          CREATE TRIGGER trg_vendor_poll_states_updated_at
          BEFORE UPDATE ON vendor_poll_states
          FOR EACH ROW
          EXECUTE FUNCTION set_vendor_poll_states_updated_at();
        END IF;
      END;
      $$;
    `);

    await client.query("COMMIT");
    process.stdout.write("Applied relational schema updates for vendor stream and correlation fields.\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
