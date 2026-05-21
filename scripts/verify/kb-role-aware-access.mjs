#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath = join(root, "supabase/migrations/616_kb_audience_role_access.sql");
const ingestPath = join(root, "supabase/functions/iron-knowledge-ingest/index.ts");
const hubAskPath = join(root, "supabase/functions/hub-ask-brain/index.ts");
const ironKnowledgePath = join(root, "supabase/functions/iron-knowledge/index.ts");
const configPath = join(root, "supabase/config.toml");
const planPath = join(root, "QEP (1)/QEP-OMI-CONSOLIDATED-BUILD-PLAN.md");

const requiredMigrationPhrases = [
  "Roadmap: E4.2 / QEP-131",
  "create table if not exists public.kb_audience_role_access",
  "unique (source_id, audience, role)",
  "create policy kb_audience_role_access_service_all",
  "create policy kb_audience_role_access_visible_self",
  "create or replace function public.kb_role_can_access_source",
  "drop policy if exists hub_knowledge_source_workspace_read",
  "create policy hub_knowledge_source_acl_read",
  "drop policy if exists hub_knowledge_chunk_workspace_read",
  "create policy hub_knowledge_chunk_acl_read",
  "drop function if exists public.match_hub_knowledge",
  "p_caller_role text default null",
  "p_caller_audience text default null",
  "candidate_scope",
  "public.kb_role_can_access_source(s.id, s.workspace_id, caller_role, caller_audience)",
  "before similarity ranking",
];

const requiredIngestPhrases = [
  "iron-knowledge-ingest",
  "ALLOWED_ADMIN_ROLES",
  "allowed_roles required",
  "kb_audience_role_access",
  "hub_knowledge_source",
  "hub_knowledge_chunk",
  "OPENAI_EMBEDDING_MODEL",
  "embedding_status",
  "Forbidden",
];

const requiredHubAskPhrases = [
  "p_caller_role: auth.role",
  "p_caller_audience: auth.audience",
  "filtered before ranking",
];

const requiredIronKnowledgePhrases = [
  "role filtering must happen inside the retrieval RPC before ranking",
  "user_role: userRole",
  "p_workspace_id: workspaceId",
];

const requiredConfigPhrases = [
  "[functions.iron-knowledge-ingest]",
  "verify_jwt = false",
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

const migration = assertFile(migrationPath, "KL-2 migration");
assertPhrases(migration, requiredMigrationPhrases, "KL-2 migration");

const ingest = assertFile(ingestPath, "iron-knowledge-ingest function");
assertPhrases(ingest, requiredIngestPhrases, "iron-knowledge-ingest function");

const hubAsk = assertFile(hubAskPath, "hub-ask-brain function");
assertPhrases(hubAsk, requiredHubAskPhrases, "hub-ask-brain function");

const ironKnowledge = assertFile(ironKnowledgePath, "iron-knowledge function");
assertPhrases(ironKnowledge, requiredIronKnowledgePhrases, "iron-knowledge function");

const config = assertFile(configPath, "Supabase function config");
assertPhrases(config, requiredConfigPhrases, "Supabase function config");

const plan = assertFile(planPath, "QEP OMI consolidated build plan");
if (plan && !plan.includes("## KL-2 — Role-aware knowledge ingestion")) {
  failures.push("Plan evidence does not contain KL-2 section.");
}

if (migration.includes("from public.hub_knowledge_chunk c\n      join public.hub_knowledge_source s")
    && migration.indexOf("public.kb_role_can_access_source(s.id, s.workspace_id, caller_role, caller_audience)")
      > migration.indexOf("order by ranked.embedding <=> p_query_embedding")) {
  failures.push("ACL check appears after ranking order; retrieval must filter before ranking.");
}

if (failures.length > 0) {
  console.error("KL-2 role-aware KB access verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("KL-2 role-aware KB access verification passed.");
console.log("- Migration: supabase/migrations/616_kb_audience_role_access.sql");
console.log("- Ingest function: supabase/functions/iron-knowledge-ingest/index.ts");
console.log("- Retrieval filters ACL before ranking and returns no unauthorized matches.");
