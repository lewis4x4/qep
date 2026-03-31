#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

type Check = {
  id: string;
  command: string;
  cwd?: string;
  required?: boolean;
};

const repoRoot = process.cwd();

const checks: Check[] = [
  {
    id: "web.typecheck",
    command: "bunx tsc -p apps/web/tsconfig.json --noEmit",
  },
  {
    id: "edge.integration-test-connection",
    command: "deno check --node-modules-dir=auto supabase/functions/integration-test-connection/index.ts",
    required: existsSync(join(repoRoot, "supabase/functions/integration-test-connection/index.ts")),
  },
  {
    id: "edge.onedrive-oauth",
    command: "deno check --node-modules-dir=auto supabase/functions/onedrive-oauth/index.ts",
    required: existsSync(join(repoRoot, "supabase/functions/onedrive-oauth/index.ts")),
  },
  {
    id: "edge.hubspot-oauth",
    command: "deno check --node-modules-dir=auto supabase/functions/hubspot-oauth/index.ts",
    required: existsSync(join(repoRoot, "supabase/functions/hubspot-oauth/index.ts")),
  },
  {
    id: "edge.ingest",
    command: "deno check --node-modules-dir=auto supabase/functions/ingest/index.ts",
    required: existsSync(join(repoRoot, "supabase/functions/ingest/index.ts")),
  },
];

let failed = false;

for (const check of checks) {
  if (check.required === false) {
    console.log(`SKIP ${check.id}`);
    continue;
  }

  const result = spawnSync(check.command, {
    cwd: check.cwd ?? repoRoot,
    env: process.env,
    shell: true,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if ((result.status ?? 1) === 0) {
    console.log(`PASS ${check.id}`);
    continue;
  }

  failed = true;
  console.error(`FAIL ${check.id}`);
  const output = [result.stdout ?? "", result.stderr ?? ""].join("\n").trim();
  if (output) {
    console.error(output);
  }
}

if (failed) {
  process.exit(1);
}

