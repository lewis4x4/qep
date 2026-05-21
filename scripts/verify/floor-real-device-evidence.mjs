#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const auditPath = join(root, "docs/operations/IRON_FLOOR_AUDIT_2026-05-17.md");

const requiredFiles = [
  "apps/web/src/features/floor/pages/FloorPage.tsx",
  "apps/web/src/features/floor/components/AdvisorActionCards.tsx",
  "apps/web/src/features/floor/components/AdvisorBriefingBanner.tsx",
  "apps/web/src/features/floor/components/__tests__/AdvisorActionCards.test.tsx",
  "apps/web/src/features/floor/components/__tests__/AdvisorBriefingBanner.test.tsx",
  "apps/web/src/features/floor/pages/__tests__/floor-view-as-noop.test.tsx",
];

const requiredAuditPhrases = [
  "E3.2 / QEP-128",
  "Status: BLOCKED",
  "real-device evidence lane",
  "iPhone",
  "Android phone",
  "iPad",
  "Safari",
  "Chrome",
  "No real-device iPhone Safari, Android Chrome, or iPad Safari evidence packet",
  "bun run floor:real-device:verify",
];

const evidenceRoots = [
  "docs/operations",
  "docs/testing",
  "test-results",
];

const realDeviceEvidencePattern = /(E3\.2|QEP-128|real[- ]device|iPhone Safari|Android Chrome|iPad Safari)/i;
const closurePattern = /(real[- ]device.*pass|iPhone Safari.*pass|Android Chrome.*pass|iPad Safari.*pass)/is;

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    failures.push(`Missing floor readiness file: ${file}`);
  }
}

if (!existsSync(auditPath)) {
  failures.push("Missing floor audit artifact: docs/operations/IRON_FLOOR_AUDIT_2026-05-17.md");
} else {
  const audit = readFileSync(auditPath, "utf8");
  for (const phrase of requiredAuditPhrases) {
    if (!audit.includes(phrase)) {
      failures.push(`Floor audit addendum missing required phrase: ${phrase}`);
    }
  }
}

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      walk(absolutePath, files);
    } else {
      files.push(absolutePath);
    }
  }
  return files;
}

const candidateEvidence = evidenceRoots
  .flatMap((evidenceRoot) => walk(join(root, evidenceRoot)))
  .filter((absolutePath) => /\.(md|json|txt)$/i.test(absolutePath))
  .filter((absolutePath) => absolutePath !== auditPath)
  .filter((absolutePath) => {
    const content = readFileSync(absolutePath, "utf8");
    return realDeviceEvidencePattern.test(content) && closurePattern.test(content);
  })
  .map((absolutePath) => relative(root, absolutePath));

if (failures.length > 0) {
  console.error("E3.2 floor real-device readiness verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("E3.2 floor real-device readiness verification passed.");
console.log(`- Audit artifact: ${relative(root, auditPath)}`);
console.log(`- Floor readiness files: ${requiredFiles.length}`);
if (candidateEvidence.length > 0) {
  console.log("- Candidate real-device closure evidence found:");
  for (const file of candidateEvidence) console.log(`  - ${file}`);
} else {
  console.log("- Candidate real-device closure evidence found: 0");
  console.log("- Roadmap state should remain BLOCKED until iPhone Safari + Android Chrome + iPad Safari evidence is recorded.");
}
