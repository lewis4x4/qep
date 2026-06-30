#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const ignoredPathPrefixes = [
  "dist/",
  "build/",
  ".netlify/",
  "test-results/",
  "scratch/",
];

function listScannableFiles() {
  const result = spawnSync("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8").trim();
    throw new Error(
      stderr || "Unable to list repository files for secret scan.",
    );
  }

  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((rel) =>
      !ignoredPathPrefixes.some((prefix) => rel.startsWith(prefix))
    );
}

const serviceRoleAssignment = /^(?:export\s+)?(?:VITE_)?SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!<|$|['\"]?<|\$\{|REPLACE_ME|YOUR_|your-|\.\.\.)/i;
const jwtPattern =
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
const literalSecretPatterns = [
  {
    label: "Linear API key",
    regex: /lin_api_[A-Za-z0-9]{20,}/g,
  },
  {
    label: "Linear webhook secret",
    regex: /lin_wh_[A-Za-z0-9]{20,}/g,
  },
  {
    label: "Slack incoming webhook URL",
    regex:
      /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/g,
  },
];
const findings = [];

function decodeBase64UrlJson(segment) {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(segment.length / 4) * 4,
      "=",
    );
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function containsSupabaseJwt(line) {
  for (const match of line.matchAll(jwtPattern)) {
    const [, payloadSegment] = match[0].split(".");
    const payload = decodeBase64UrlJson(payloadSegment);
    if (payload?.role === "service_role" || payload?.role === "anon") return true;
    if (typeof payload?.iss === "string" && payload.iss.includes("supabase")) return true;
  }
  return false;
}

function collectLiteralSecretFindings(rel, line, lineNumber) {
  for (const pattern of literalSecretPatterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(line)) {
      findings.push(`${rel}:${lineNumber} — ${pattern.label}`);
    }
  }
}

for (const rel of listScannableFiles()) {
  const full = join(root, rel);
  const stat = statSync(full);
  if (!stat.isFile() || stat.size > 2_000_000) continue;

  let text;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    continue;
  }

  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    collectLiteralSecretFindings(rel, line, lineNumber);
    if (serviceRoleAssignment.test(line)) {
      findings.push(`${rel}:${lineNumber} — Supabase service-role assignment`);
    }
    if (containsSupabaseJwt(line)) {
      findings.push(`${rel}:${lineNumber} — Supabase anon/service JWT`);
    }
  });
}

if (findings.length > 0) {
  console.error(
    "Plaintext secret scan failed. Remove real Linear, Slack, Supabase service-role/JWT values from:",
  );
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log("Plaintext secret scan passed.");
