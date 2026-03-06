import { spawnSync } from "node:child_process";

const checks = [
  {
    name: "Frontend build",
    command: "npm run guardrail:build",
  },
  {
    name: "SQL lint (linked public schema)",
    command: "npm run guardrail:sql",
  },
];

const run = (name, command) => {
  console.log(`\n[guardrail] Running: ${name}`);
  console.log(`[guardrail] Command: ${command}`);
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`[guardrail] FAIL: ${name}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[guardrail] PASS: ${name}`);
};

console.log("[guardrail] Starting release safety checks...");
checks.forEach((check) => run(check.name, check.command));

console.log("\n[guardrail] Automated checks passed.");
console.log("[guardrail] Manual smoke checklist (required before merge):");
console.log("1. Login/logout flow");
console.log("2. Item create/edit/save");
console.log("3. Invoice create/paid -> wallet update");
console.log("4. Refund/return dashboard refresh behavior");
console.log("5. Backup export + disaster restore basic path");
console.log("6. Catalog edit/save on first load");
console.log("7. Wallet receipt preview/download");

