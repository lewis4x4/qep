#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./_shared/local-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadLocalEnv(root);

const args = new Set(process.argv.slice(2));
const targetPath = resolve(root, "apps/web/src/lib/database.types.ts");
const configToml = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
const configProjectRef = configToml.match(/^project_id\s*=\s*"([a-z0-9]+)"/m)?.[1];
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || configProjectRef;

const cliArgs = ["gen", "types", "typescript"];
if (args.has("--local")) {
  cliArgs.push("--local");
} else {
  if (!projectRef) {
    console.error("Missing Supabase project ref. Set SUPABASE_PROJECT_REF or supabase/config.toml project_id.");
    process.exit(2);
  }
  cliArgs.push("--project-id", projectRef, "--schema", "public");
}

const result = spawnSync("supabase", cliArgs, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 30,
});

if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

let output = result.stdout.trimEnd();
if (!output.includes("export type UserRole = Database[")) {
  output += "\n\nexport type UserRole = Database[\"public\"][\"Enums\"][\"user_role\"]\n";
}

writeFileSync(targetPath, `${output}\n`, "utf8");
console.log(`Wrote ${targetPath}${args.has("--local") ? " from local Supabase" : ` from project ${projectRef}`}.`);
