import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseDotEnvFile(filePath) {
  const parsed = {};
  const raw = readFileSync(filePath, "utf8");

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

function setIfMissing(targetKey, ...candidateKeys) {
  if (process.env[targetKey]?.trim()) return;
  for (const candidateKey of candidateKeys) {
    const candidateValue = process.env[candidateKey]?.trim();
    if (candidateValue) {
      process.env[targetKey] = candidateValue;
      return;
    }
  }
}

export function loadLocalEnv(cwd = process.cwd()) {
  const envFiles = [
    ".env.demo.local",
    ".env.local",
    ".env",
    ".secrets",
  ].map((fileName) => resolve(cwd, fileName));

  for (const filePath of envFiles) {
    if (!existsSync(filePath)) continue;
    const entries = parseDotEnvFile(filePath);
    for (const [key, rawValue] of Object.entries(entries)) {
      if (process.env[key]) continue;
      process.env[key] = normalizeEnvValue(rawValue);
    }
  }

  setIfMissing("SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  setIfMissing("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  setIfMissing("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");
}
