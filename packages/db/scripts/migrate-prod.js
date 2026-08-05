/**
 * Production-safe DB bootstrap (no force-reset).
 * Drop Timescale caggs → prisma generate → db push → timescale SQL → demo seed
 *
 * Continuous aggregates are dropped first so Prisma never hits
 * "cannot drop table samples because other objects depend on it".
 * They are recreated by the Timescale migrations (idempotent).
 */
const { spawnSync } = require("child_process");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!process.env.DATABASE_URL) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

run("node", ["./scripts/drop-timescale-caggs.js"]);
run("pnpm", ["prisma", "generate"]);
run("pnpm", ["prisma", "db", "push", "--accept-data-loss"]);
run("node", ["./scripts/run-timescale-migrations.js"]);
run("node", ["./scripts/seed-demo.js"]);
