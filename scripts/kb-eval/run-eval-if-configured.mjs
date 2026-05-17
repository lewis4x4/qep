#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
loadLocalEnv(repoRoot);

function requiredEnv(name) {
  return process.env[name]?.trim() ?? "";
}

const strictMode =
  requiredEnv("KB_EVAL_REQUIRED") === "true" ||
  requiredEnv("CI") === "true";

const url = requiredEnv("SUPABASE_URL") || requiredEnv("VITE_SUPABASE_URL");
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !serviceKey) {
  if (strictMode) {
    console.error("kb:eval REQUIRED - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  console.log("kb:eval SKIP - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(0);
}

const result = spawnSync(
  "bun",
  ["run", "kb:eval"],
  {
    cwd: repoRoot,
    env: { ...process.env, KB_EVAL_REQUIRED: "true" },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
