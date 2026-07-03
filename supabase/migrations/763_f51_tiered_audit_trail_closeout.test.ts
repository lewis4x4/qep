import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "763_f51_tiered_audit_trail_closeout.sql");
const streamFSeed = readText("supabase", "migrations", "597_qep_stream_f_decision_velocity.sql");
const plan = readText("QEP (1)", "QEP_DECISION_INBOX_MOONSHOT_V2.md");
const catalog = readText("QEP (1)", "QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md");
const buildLog = readText("QEP (1)", "QEP_OS_BUILD_LOG_2026-05-21.md");
const ledgerSql = readText("supabase", "migrations", "622_qep_decision_audit_artifacts.sql");
const ledgerTest = readText("supabase", "migrations", "622_qep_decision_audit_artifacts.test.ts");
const fnIndex = readText("supabase", "functions", "decision-audit-artifact", "index.ts");
const fnLogic = readText("supabase", "functions", "decision-audit-artifact", "logic.ts");
const fnLogicTest = readText("supabase", "functions", "decision-audit-artifact", "logic.test.ts");
const supabaseConfig = readText("supabase", "config.toml");

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(streamFSeed);
const compactPlan = compact(plan);
const compactCatalog = compact(catalog);
const compactBuildLog = compact(buildLog);
const compactLedger = compact(ledgerSql);
const compactLedgerTest = compact(ledgerTest);
const compactIndex = compact(fnIndex);
const compactLogic = compact(fnLogic);
const compactLogicTest = compact(fnLogicTest);
const compactConfig = compact(supabaseConfig);

describe("763_f51_tiered_audit_trail_closeout.sql contract", () => {
  it("marks only F5.1 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'f5.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("f51_tiered_audit_trail_closeout");
    expect(compactCloseout).not.toContain("where task_id = 'f4.4'");
    expect(compactCloseout).not.toContain("where task_id = 'f5.2'");
  });

  it("pins the roadmap row and prior done evidence", () => {
    expect(compactSeed).toContain("'f5.1','f','f5','tiered audit trail'");
    expect(compactSeed).toContain("auto: row only. ratify: row + rendered html in r2. authorize: signed pdf with 7-year retention.");
    expect(compactSeed).toContain("array['f3.3']");

    expect(compactPlan).toContain("auto | single timestamped row");
    expect(compactPlan).toContain("ratify | same + a rendered html view");
    expect(compactPlan).toContain("authorize | full signed pdf");
    expect(compactCatalog).toContain("qep-150 | done | 2026-05-21 | f5.1");
    expect(compactBuildLog).toContain("tiered audit artifacts");
    expect(compactBuildLog).toContain("f5.1 / qep-150");
    expect(compactBuildLog).toContain("added an edge function for generating and storing decision audit artifacts");
  });

  it("pins the audit ledger shape, constraints, and RLS", () => {
    expect(compactLedger).toContain("create table if not exists public.qep_decision_audit_artifacts");
    expect(compactLedger).toContain("decision_id uuid not null references public.qep_decisions(id) on delete cascade");
    expect(compactLedger).toContain("check (audit_grade in ('auto', 'ratify', 'authorize'))");
    expect(compactLedger).toContain("check (artifact_kind in ('row', 'html', 'pdf'))");
    expect(compactLedger).toContain("audit_grade <> 'auto' or ( artifact_kind = 'row'");
    expect(compactLedger).toContain("audit_grade <> 'ratify' or artifact_kind = 'html'");
    expect(compactLedger).toContain("audit_grade <> 'authorize' or artifact_kind = 'pdf'");
    expect(compactLedger).toContain("audit_grade <> 'authorize' or retention_until is not null");
    expect(compactLedger).toContain("alter table public.qep_decision_audit_artifacts enable row level security");
    expect(compactLedger).toContain("for all to service_role using (true) with check (true)");
    expect(compactLedger).toContain("for select to authenticated");
  });

  it("pins lane mapping, retention, storage keys, and renderers", () => {
    expect(compactLogic).toContain("export function deriveauditartifactplan");
    expect(compactLogic).toContain('if (auditgrade === "auto")');
    expect(compactLogic).toContain('artifactkind: "row"');
    expect(compactLogic).toContain('if (auditgrade === "ratify")');
    expect(compactLogic).toContain('artifactkind: "html"');
    expect(compactLogic).toContain('return { auditgrade, artifactkind: "pdf"');
    expect(compactLogic).toContain("retentionuntil: addyears(generatedat, 7).toisostring()");
    expect(compactLogic).toContain("qep-decisions/${input.plan.auditgrade}/${code}/${stamp}.${input.plan.extension}");
    expect(compactLogic).toContain("renderdecisioncardhtml");
    expect(compactLogic).toContain("renderauthorizepdfbytes");
    expect(compactLogic).toContain("missingrequiredauthorizesignerroles");
    expect(compactLogic).toContain("authorization signature evidence");
  });

  it("pins the edge function access controls and artifact write path", () => {
    expect(compactConfig).toContain("[functions.decision-audit-artifact] verify_jwt = false");
    expect(compactIndex).toContain("const function_name = \"decision-audit-artifact\"");
    expect(compactIndex).toContain("isservicerolecaller(req)");
    expect(compactIndex).toContain("requireserviceuser");
    expect(compactIndex).toContain("[\"admin\", \"manager\", \"owner\"].includes(auth.role)");
    expect(compactIndex).toContain("isresolveddecisionstatus(decision.status)");
    expect(compactIndex).toContain("deriveauditartifactplan(decision, generatedat)");
    expect(compactIndex).toContain("missingrequiredauthorizesignerroles");
    expect(compactIndex).toContain("renderdecisioncardhtml");
    expect(compactIndex).toContain("renderauthorizepdfbytes");
    expect(compactIndex).toContain("readr2storageconfig");
    expect(compactIndex).toContain("creater2puturl");
    expect(compactIndex).toContain("insertartifact(admin");
    expect(compactIndex).toContain("logroadmapauditevent");
    expect(compactIndex).toContain("creater2geturl");
  });

  it("pins focused tests and source-control boundaries", () => {
    expect(compactLedgerTest).toContain("622_qep_decision_audit_artifacts.sql qep-150 contract");
    expect(compactLogicTest).toContain("deriveauditartifactplan maps auto to row-only with no r2 artifact");
    expect(compactLogicTest).toContain("deriveauditartifactplan maps ratify to deterministic html artifact");
    expect(compactLogicTest).toContain("deriveauditartifactplan maps authorize to 7-year-retained pdf");
    expect(compactLogicTest).toContain("missingrequiredauthorizesignerroles reports partial authorize signatures");
    expect(compactLogicTest).toContain("renderauthorizepdfbytes emits minimal valid deterministic pdf bytes");

    expect(compactCloseout).toContain("does not alter runtime audit artifact behavior");
    expect(compactCloseout).toContain("does not mark f5.2");
    expect(compactCloseout).toContain("production r2 credentials");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
