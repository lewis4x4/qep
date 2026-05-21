#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const canonicalBrandGuide = join(root, "docs/qep_brand_guide.pdf");
const sourceBrandGuide = join(root, "docs/Brand Guide QEP.pdf");
const auditPath = join(root, "docs/reviews/QEP_E2_1_UI_BRAND_GUIDE_COMPLIANCE_AUDIT_2026-05-21.md");
const cssPath = join(root, "apps/web/src/index.css");
const tailwindPath = join(root, "apps/web/tailwind.config.js");
const srcRoot = join(root, "apps/web/src");

const requiredBrandTokens = [
  "--qep-orange",
  "--qep-orange-accessible",
  "--qep-dark",
  "--qep-charcoal",
  "--qep-slate",
  "--qep-gray",
  "--qep-light-gray",
  "--qep-bg",
  "--qep-live",
  "--qep-hot",
  "--qep-warm",
];

const requiredAuditPhrases = [
  "E2.1 / QEP-124",
  "docs/qep_brand_guide.pdf",
  "docs/Brand Guide QEP.pdf",
  "apps/web/src/index.css",
  "apps/web/tailwind.config.js",
  "Surface inventory",
  "Customer-facing surfaces",
  "Operational surfaces",
  "Admin/internal surfaces",
  "Raw color exceptions",
  "Follow-up remediation queue",
];

const ignoredPathParts = [
  "/__tests__/",
  ".test.",
  ".spec.",
  "/test-setup/",
];

const uiExtensions = new Set([".tsx", ".css"]);
const hexPattern = /#[0-9A-Fa-f]{3,8}\b/g;

function fail(message) {
  failures.push(message);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".netlify", "test-results"].includes(entry.name)) continue;
      walk(absolutePath, files);
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

function extensionOf(path) {
  const match = path.match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function isIgnored(relativePath) {
  return ignoredPathParts.some((part) => relativePath.includes(part));
}

function isSurfaceFile(relativePath) {
  return (
    relativePath === "apps/web/src/App.tsx" ||
    relativePath === "apps/web/src/index.css" ||
    /apps\/web\/src\/components\/.*\.tsx$/.test(relativePath) ||
    /apps\/web\/src\/features\/[^/]+\/pages\/.*\.tsx$/.test(relativePath) ||
    /apps\/web\/src\/features\/[^/]+\/components\/.*\.tsx$/.test(relativePath) ||
    /apps\/web\/src\/features\/[^/]+\/.*Routes\.tsx$/.test(relativePath) ||
    /apps\/web\/src\/features\/[^/]+\/.*Shell\.tsx$/.test(relativePath)
  );
}

function bucketSurface(relativePath) {
  if (/\/portal\//.test(relativePath) || /LoginPage|Quote|Voice|Customer|Rental|Parts|Service|Sales/.test(relativePath)) {
    return "customerFacing";
  }
  if (/\/floor\/|\/qrm\/|\/owner\/|\/service\/|\/parts\/|\/deal-room\/|\/sales\//.test(relativePath)) {
    return "operational";
  }
  if (/\/admin\/|Admin|Integration|Users|Workspace/.test(relativePath)) {
    return "adminInternal";
  }
  return "shared";
}

const failures = [];

if (!existsSync(sourceBrandGuide)) {
  fail("Missing source brand guide: docs/Brand Guide QEP.pdf");
}

if (!existsSync(canonicalBrandGuide)) {
  fail("Missing canonical roadmap brand guide alias: docs/qep_brand_guide.pdf");
} else {
  const stat = lstatSync(canonicalBrandGuide);
  if (!stat.isSymbolicLink() && stat.size === 0) {
    fail("Canonical brand guide alias exists but is empty.");
  }
}

if (!existsSync(cssPath)) {
  fail("Missing app brand token stylesheet: apps/web/src/index.css");
} else {
  const css = readFileSync(cssPath, "utf8");
  for (const token of requiredBrandTokens) {
    if (!css.includes(token)) {
      fail(`Missing brand token in apps/web/src/index.css: ${token}`);
    }
  }
}

if (!existsSync(tailwindPath)) {
  fail("Missing Tailwind brand-token bridge: apps/web/tailwind.config.js");
}

if (!existsSync(auditPath)) {
  fail("Missing E2.1 audit report: docs/reviews/QEP_E2_1_UI_BRAND_GUIDE_COMPLIANCE_AUDIT_2026-05-21.md");
} else {
  const audit = readFileSync(auditPath, "utf8");
  for (const phrase of requiredAuditPhrases) {
    if (!audit.includes(phrase)) {
      fail(`Audit report missing required phrase: ${phrase}`);
    }
  }
}

const allFiles = existsSync(srcRoot) ? walk(srcRoot) : [];
const uiFiles = allFiles
  .map((absolutePath) => relative(root, absolutePath))
  .filter((relativePath) => uiExtensions.has(extensionOf(relativePath)))
  .filter((relativePath) => !isIgnored(relativePath));

const surfaceFiles = uiFiles.filter(isSurfaceFile);
const buckets = {
  customerFacing: [],
  operational: [],
  adminInternal: [],
  shared: [],
};

for (const relativePath of surfaceFiles) {
  buckets[bucketSurface(relativePath)].push(relativePath);
}

let rawHexCount = 0;
const rawHexByFile = [];

for (const relativePath of uiFiles) {
  const content = readFileSync(join(root, relativePath), "utf8");
  const matches = content.match(hexPattern) ?? [];
  if (matches.length > 0) {
    rawHexCount += matches.length;
    rawHexByFile.push({ relativePath, count: matches.length });
  }
}

rawHexByFile.sort((a, b) => b.count - a.count || a.relativePath.localeCompare(b.relativePath));

if (surfaceFiles.length === 0) {
  fail("No UI surface files were inventoried; audit scope is empty.");
}

if (failures.length > 0) {
  console.error("E2.1 brand-guide compliance audit verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("E2.1 brand-guide compliance audit verification passed.");
console.log(`- Brand guide: ${relative(root, canonicalBrandGuide)}`);
console.log(`- Audit report: ${relative(root, auditPath)}`);
console.log(`- UI files scanned: ${uiFiles.length}`);
console.log(`- Surface files inventoried: ${surfaceFiles.length}`);
console.log(`- Customer-facing surfaces: ${buckets.customerFacing.length}`);
console.log(`- Operational surfaces: ${buckets.operational.length}`);
console.log(`- Admin/internal surfaces: ${buckets.adminInternal.length}`);
console.log(`- Shared shell/component surfaces: ${buckets.shared.length}`);
console.log(`- Raw hex color occurrences: ${rawHexCount}`);
console.log("- Top raw-color files:");
for (const entry of rawHexByFile.slice(0, 10)) {
  console.log(`  - ${entry.relativePath}: ${entry.count}`);
}
