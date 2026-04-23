#!/usr/bin/env bun

import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..", "..");
loadLocalEnv(repoRoot);

const options = parseArgs(process.argv.slice(2));
if (!options.workspace) {
  console.error("Usage: bun ./scripts/floor/seed-layouts-for-workspace.mjs --workspace <workspace_id> [--source default]");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: sourceRows, error: sourceError } = await supabase
  .from("floor_layouts")
  .select("iron_role, layout_json")
  .eq("workspace_id", options.source)
  .is("user_id", null)
  .order("iron_role", { ascending: true });

if (sourceError) {
  console.error(`Could not read source layouts: ${sourceError.message}`);
  process.exit(1);
}

if (!sourceRows || sourceRows.length === 0) {
  console.error(`No role-default layouts found for source workspace ${options.source}.`);
  process.exit(1);
}

let seededCount = 0;
for (const row of sourceRows) {
  const { data: existing, error: existingError } = await supabase
    .from("floor_layouts")
    .select("id")
    .eq("workspace_id", options.workspace)
    .eq("iron_role", row.iron_role)
    .is("user_id", null)
    .maybeSingle();

  if (existingError) {
    console.error(`Could not check target layout for ${row.iron_role}: ${existingError.message}`);
    process.exit(1);
  }

  const write = existing?.id
    ? supabase
        .from("floor_layouts")
        .update({ layout_json: row.layout_json, updated_by: null })
        .eq("id", existing.id)
    : supabase.from("floor_layouts").insert({
        workspace_id: options.workspace,
        iron_role: row.iron_role,
        user_id: null,
        layout_json: row.layout_json,
        updated_by: null,
      });

  const { error: writeError } = await write;
  if (writeError) {
    console.error(`Could not seed ${row.iron_role}: ${writeError.message}`);
    process.exit(1);
  }
  seededCount += 1;
}

console.log(
  JSON.stringify(
    {
      verdict: "PASS",
      source_workspace: options.source,
      target_workspace: options.workspace,
      seeded_role_defaults: seededCount,
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const parsed = {
    workspace: "",
    source: "default",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace") {
      parsed.workspace = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--workspace=")) {
      parsed.workspace = arg.slice("--workspace=".length);
      continue;
    }
    if (arg === "--source") {
      parsed.source = argv[i + 1] ?? "default";
      i += 1;
      continue;
    }
    if (arg.startsWith("--source=")) {
      parsed.source = arg.slice("--source=".length) || "default";
    }
  }
  parsed.workspace = parsed.workspace.trim();
  parsed.source = parsed.source.trim() || "default";
  return parsed;
}
