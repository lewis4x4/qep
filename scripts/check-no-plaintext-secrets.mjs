#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const ignoredDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".netlify",
  "test-results",
]);
const allowedExampleFiles = new Set([
  ".env.example",
  "apps/web/.env.example",
]);
const serviceRoleAssignment = /^(VITE_)?SUPABASE_SERVICE_ROLE_KEY=(?!<|$)/;
const jwtPattern = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
const findings = [];

function decodeBase64UrlJson(segment) {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
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

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const full = join(dir, entry);
    const rel = relative(root, full);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (stat.size > 2_000_000) continue;
    const text = readFileSync(full, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (allowedExampleFiles.has(rel)) return;
      if (serviceRoleAssignment.test(line) || containsServiceRoleJwt(line)) {
        findings.push(`${rel}:${index + 1}`);
      }
    });
  }
}

walk(root);

if (findings.length > 0) {
  console.error("Plaintext secret scan failed. Remove real service-role/JWT values from:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log("Plaintext secret scan passed.");
