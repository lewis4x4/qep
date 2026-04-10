#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadLocalEnv(join(__dirname, "..", ".."));

function requiredEnv(name) {
  return process.env[name]?.trim() ?? "";
}

const strictMode =
  requiredEnv("KB_ISOLATION_REQUIRED") === "true" ||
  requiredEnv("CI") === "true";

function skip(reason) {
  console.log(`kb:workspace-isolation SKIP - ${reason}`);
  process.exit(0);
}

const url = requiredEnv("SUPABASE_URL") || requiredEnv("VITE_SUPABASE_URL");
const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const rawCases = requiredEnv("KB_ISOLATION_CASES");

if (!url || !serviceKey) {
  skip("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}

if (!rawCases) {
  skip("set KB_ISOLATION_CASES JSON to run workspace isolation checks");
}

const cases = JSON.parse(rawCases);
if (!Array.isArray(cases) || cases.length === 0) {
  skip("KB_ISOLATION_CASES must be a non-empty JSON array");
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;

for (const testCase of cases) {
  const { data, error } = await supabase.rpc("retrieve_document_evidence", {
    query_embedding: null,
    keyword_query: testCase.query,
    user_role: testCase.user_role ?? "manager",
    match_count: 8,
    semantic_match_threshold: 0.45,
    p_workspace_id: testCase.workspace_id,
  });

  if (error) {
    console.error(`workspace ${testCase.workspace_id} query failed: ${error.message}`);
    failures += 1;
    continue;
  }

  const titles = (data ?? []).map((row) => row.source_title ?? "");
  const forbidden = (testCase.forbidden_title_contains ?? []).filter((value) =>
    titles.some((title) => title.toLowerCase().includes(String(value).toLowerCase()))
  );

  if (forbidden.length > 0) {
    console.error(`workspace ${testCase.workspace_id} leaked forbidden titles for query "${testCase.query}"`);
    failures += 1;
  } else {
    console.log(`workspace ${testCase.workspace_id} OK for "${testCase.query}"`);
  }
}

if (failures > 0) {
  process.exit(1);
}
