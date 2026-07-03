import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "748_e42_role_aware_knowledge_ingestion_closeout.sql");
const kl2Migration = readText("supabase", "migrations", "616_kb_audience_role_access.sql");
const verifier = readText("scripts", "verify", "kb-role-aware-access.mjs");
const ingest = readText("supabase", "functions", "iron-knowledge-ingest", "index.ts");
const hubAsk = readText("supabase", "functions", "hub-ask-brain", "index.ts");
const ironKnowledge = readText("supabase", "functions", "iron-knowledge", "index.ts");
const config = readText("supabase", "config.toml");
const plan = readText("QEP (1)", "QEP-OMI-CONSOLIDATED-BUILD-PLAN.md");
const packageJson = JSON.parse(readText("package.json"));

const compactCloseout = compact(closeoutSql);
const compactMigration = compact(kl2Migration);
const compactVerifier = compact(verifier);
const compactIngest = compact(ingest);
const compactHubAsk = compact(hubAsk);
const compactIronKnowledge = compact(ironKnowledge);
const compactConfig = compact(config);
const compactPlan = compact(plan);

describe("748_e42_role_aware_knowledge_ingestion_closeout.sql contract", () => {
  it("marks only E4.2 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'e4.2'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("role-aware knowledge ingestion");
    expect(compactCloseout).not.toContain("where task_id = 'e4.1'");
    expect(compactCloseout).not.toContain("where task_id = 'e2.2'");
  });

  it("pins the KL-2 plan and verifier contract", () => {
    expect(compactPlan).toContain("## kl-2 — role-aware knowledge ingestion");
    expect(compactPlan).toContain("enforce role filtering in sql/rpc");
    expect(compactPlan).toContain("unauthorized result is “no matches” without existence leakage");

    expect(packageJson.scripts["kb:role-access:verify"]).toBe("bun ./scripts/verify/kb-role-aware-access.mjs");
    expect(compactVerifier).toContain("kl-2 role-aware kb access verification passed");
    expect(compactVerifier).toContain("retrieval filters acl before ranking");
    expect(compactVerifier).toContain("p_caller_role: auth.role");
    expect(compactVerifier).toContain("p_caller_audience: auth.audience");
  });

  it("pins the ACL table, policies, and no-leakage retrieval filter", () => {
    expect(compactMigration).toContain("roadmap: e4.2 / qep-131");
    expect(compactMigration).toContain("create table if not exists public.kb_audience_role_access");
    expect(compactMigration).toContain("unique (source_id, audience, role)");
    expect(compactMigration).toContain("create policy kb_audience_role_access_service_all");
    expect(compactMigration).toContain("create policy kb_audience_role_access_visible_self");
    expect(compactMigration).toContain("create or replace function public.kb_role_can_access_source");
    expect(compactMigration).toContain("create policy hub_knowledge_source_acl_read");
    expect(compactMigration).toContain("create policy hub_knowledge_chunk_acl_read");
    expect(compactMigration).toContain("p_caller_role text default null");
    expect(compactMigration).toContain("p_caller_audience text default null");
    expect(compactMigration).toContain("candidate_scope");
    expect(compactMigration).toContain("public.kb_role_can_access_source(s.id, s.workspace_id, caller_role, caller_audience)");
    expect(compactMigration).toContain("before similarity ranking");

    const aclIndex = compactMigration.indexOf("public.kb_role_can_access_source(s.id, s.workspace_id, caller_role, caller_audience)");
    const rankedIndex = compactMigration.indexOf("ranked as");
    expect(aclIndex).toBeGreaterThan(0);
    expect(rankedIndex).toBeGreaterThan(aclIndex);
  });

  it("pins ingest authority checks and per-source ACL writes", () => {
    expect(compactIngest).toContain("iron-knowledge-ingest — kl-2 role-aware hub knowledge ingestion");
    expect(compactIngest).toContain("const allowed_admin_roles = new set([\"admin\", \"manager\", \"owner\"])");
    expect(compactIngest).toContain("allowed_roles required");
    expect(compactIngest).toContain("kb_audience_role_access");
    expect(compactIngest).toContain("hub_knowledge_source");
    expect(compactIngest).toContain("hub_knowledge_chunk");
    expect(compactIngest).toContain("openai_embedding_model");
    expect(compactIngest).toContain("embedding_status");
    expect(compactIngest).toContain("forbidden");
    expect(compactIngest).toContain("notification recipients failed");
    expect(compactIngest).toContain("kind: \"kb_doc_added\"");
  });

  it("pins retrieval caller propagation and config registration", () => {
    expect(compactHubAsk).toContain("workspace and role/audience isolation are enforced inside the rpc");
    expect(compactHubAsk).toContain("p_caller_role: auth.role");
    expect(compactHubAsk).toContain("p_caller_audience: auth.audience");
    expect(compactHubAsk).toContain("filtered before ranking");

    expect(compactIronKnowledge).toContain("role filtering must happen inside the retrieval rpc before ranking");
    expect(compactIronKnowledge).toContain("user_role: userrole");
    expect(compactIronKnowledge).toContain("p_workspace_id: workspaceid");

    expect(compactConfig).toContain("[functions.iron-knowledge-ingest]");
    expect(compactConfig).toContain("verify_jwt = false");
  });

  it("keeps E4.1, live embedding, workspace-isolation, and db-push boundaries explicit", () => {
    expect(compactCloseout).toContain("does not mark e4.1 shipped");
    expect(compactCloseout).toContain("openai_api_key");
    expect(compactCloseout).toContain("kb_isolation_cases");
    expect(compactCloseout).toContain("production upload/uat evidence");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
