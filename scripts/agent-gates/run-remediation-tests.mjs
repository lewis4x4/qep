import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { hasScratchPostgres } from "../testing/scratch-postgres.ts";
if (!hasScratchPostgres) throw new Error("Remediation database gates require local PostgreSQL test binaries (QEP_POSTGRES_BIN).");
const sql = readdirSync("supabase/migrations").filter((f) => /^84[0-7]_.*\.behavior\.test\.ts$|^839_.*\.behavior\.test\.ts$/.test(f)).sort().map((f) => `supabase/migrations/${f}`);
if (sql.length !== 9) throw new Error("Expected all nine remediation database behavior suites.");
const env = { ...process.env, LC_ALL: "C", LANG: "C", QEP_SKIP_LOCAL_ENV: "1" };
let failed = false;
for (const file of sql) {
 const result = spawnSync("bun", ["--no-env-file", "test", "--timeout", "30000", `./${file}`], { env, stdio: "inherit" });
 if (result.status !== 0) failed = true;
}
const edge = spawnSync("deno", ["test", "--no-lock", "--node-modules-dir=none", "--allow-read", "--allow-env",
 "supabase/functions/_shared/complete-report-rows.test.ts",
 "supabase/functions/_shared/flow-engine/replay-context.test.ts",
 "supabase/functions/process-offline-queue/handler.test.ts",
 "supabase/functions/_shared/portal-stripe-reconcile.test.ts",
 "supabase/functions/portal-stripe/handler.test.ts",
 "supabase/functions/_shared/voice-queue-identity.test.ts",
 "supabase/functions/_shared/service-closeout-recovery.test.ts",
], { env, stdio: "inherit" });
if (edge.status !== 0) failed = true;
process.exit(failed ? 1 : 0);
