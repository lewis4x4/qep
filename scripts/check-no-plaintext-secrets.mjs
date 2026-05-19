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
const allowedExampleFiles = new Set([
  ".env.example",
  "apps/web/.env.example",
]);

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
const serviceRoleAssignment = /^(VITE_)?SUPABASE_SERVICE_ROLE_KEY=(?!<|$)/;
const jwtPattern =
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
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

function containsServiceRoleJwt(line) {
  for (const match of line.matchAll(jwtPattern)) {
    const [, payloadSegment] = match[0].split(".");
    const payload = decodeBase64UrlJson(payloadSegment);
    if (payload?.role === "service_role") return true;
  }
  return false;
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
    if (allowedExampleFiles.has(rel)) return;
    if (serviceRoleAssignment.test(line) || containsServiceRoleJwt(line)) {
      findings.push(`${rel}:${index + 1}`);
    }
  });
}

if (findings.length > 0) {
  console.error(
    "Plaintext secret scan failed. Remove real service-role/JWT values from:",
  );
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log("Plaintext secret scan passed.");
