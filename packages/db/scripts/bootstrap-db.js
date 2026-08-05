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

// Continuous aggregates block DROP TABLE samples during force-reset.
run("node", ["./scripts/drop-timescale-caggs.js"]);
run("pnpm", ["prisma", "generate"]);
run("pnpm", ["prisma", "db", "push", "--force-reset", "--accept-data-loss"]);
run("node", ["./scripts/run-timescale-migrations.js"]);
run("node", ["./scripts/seed-demo.js"]);
