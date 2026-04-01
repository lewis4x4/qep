import { existsSync, readFileSync } from "node:fs";

function parseDotEnvFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const parsed = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) continue;
    parsed[key] = value;
  }

  return parsed;
}

function normalizeEnvValue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function loadLocalEnv() {
  const cwd = process.cwd();
  const envFiles = [
    `${cwd}/.env.demo.local`,
    `${cwd}/.env.local`,
    `${cwd}/.env`,
  ];

  for (const filePath of envFiles) {
    if (!existsSync(filePath)) continue;
    const entries = parseDotEnvFile(filePath);
    for (const [key, rawValue] of Object.entries(entries)) {
      if (process.env[key]) continue;
      process.env[key] = normalizeEnvValue(rawValue);
    }
  }
}

async function main() {
  loadLocalEnv();

  const action = process.argv[2] ?? "seed";
  if (action !== "seed" && action !== "reset") {
    throw new Error('Usage: bun ./scripts/demo/demo-admin.mjs [seed|reset]');
  }

  const projectUrl =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const demoAdminSecret = process.env.DEMO_ADMIN_SECRET;

  if (!projectUrl) {
    throw new Error("Missing SUPABASE_URL, VITE_SUPABASE_URL, or NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!demoAdminSecret) {
    throw new Error("Missing DEMO_ADMIN_SECRET in local env.");
  }

  if (!anonKey) {
    throw new Error(
      "Missing SUPABASE_ANON_KEY, VITE_SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const response = await fetch(`${projectUrl}/functions/v1/demo-admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "x-demo-admin-secret": demoAdminSecret,
    },
    body: JSON.stringify({ action }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`demo-admin ${response.status}: ${text}`);
  }

  process.stdout.write(`${text}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
