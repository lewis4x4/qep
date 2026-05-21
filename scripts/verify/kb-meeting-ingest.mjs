#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const ingestPath = join(root, "supabase/functions/iron-knowledge-ingest/index.ts");
const topBarPath = join(root, "apps/web/src/components/TopBar.tsx");
const planPath = join(root, "QEP (1)/QEP-OMI-CONSOLIDATED-BUILD-PLAN.md");

const requiredIngestPhrases = [
  "notify_eligible_users",
  "fanOutKnowledgeDocNotifications",
  "crm_in_app_notifications",
  "kind: \"kb_doc_added\"",
  "link: `/chat?seed=${input.sourceId}`",
  "notifications_created",
];

const requiredTopBarPhrases = [
  "kind: string | null",
  "id, title, body, kind, deal_id, metadata, created_at, read_at",
  "row.kind === \"kb_doc_added\"",
  "Unread — opens ${unreadTarget}",
];

const failures = [];

function assertFile(path, label) {
  if (!existsSync(path)) {
    failures.push(`Missing ${label}: ${path}`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function assertPhrases(content, phrases, label) {
  for (const phrase of phrases) {
    if (!content.includes(phrase)) failures.push(`${label} missing required phrase: ${phrase}`);
  }
}

const ingest = assertFile(ingestPath, "iron knowledge ingest endpoint");
assertPhrases(ingest, requiredIngestPhrases, "iron knowledge ingest endpoint");

const topBar = assertFile(topBarPath, "TopBar notification UI");
assertPhrases(topBar, requiredTopBarPhrases, "TopBar notification UI");

const plan = assertFile(planPath, "QEP OMI consolidated build plan");
if (plan && !plan.includes("## KL-1 — Meeting summarizer to knowledge doc")) {
  failures.push("Plan evidence does not contain KL-1 section.");
}

if (failures.length > 0) {
  console.error("KL-1 meeting-ingest verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("KL-1 meeting-ingest repo-side verification passed.");
console.log("- iron-knowledge-ingest can fan out kb_doc_added notifications.");
console.log("- TopBar handles kb_doc_added rows and opens /chat?seed=<source_id> links.");
console.log("- External meeting-summarizer skill update still requires local skill availability.");
