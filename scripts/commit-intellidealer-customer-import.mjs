#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { loadLocalEnv } from "./_shared/local-env.mjs";

loadLocalEnv(process.cwd());

const runId = process.argv[2];
if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) {
  console.error("Usage: bun ./scripts/commit-intellidealer-customer-import.mjs <run-id>");
  process.exit(2);
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN.");
  process.exit(2);
}

const projectRef =
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  readFileSync("supabase/config.toml", "utf8").match(/^project_id\s*=\s*"([a-z0-9]+)"/m)?.[1];

if (!projectRef) {
  console.error("Missing Supabase project ref.");
  process.exit(2);
}

const query = `
set statement_timeout = '15min';
set local request.jwt.claim.role = 'service_role';
select public.commit_intellidealer_customer_import('${runId}'::uuid) as result;
`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  },
);

const text = await response.text();
if (!response.ok) {
  console.error(text);
  process.exit(1);
}

console.log(text);
