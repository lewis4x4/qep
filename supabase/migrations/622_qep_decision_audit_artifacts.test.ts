import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "622_qep_decision_audit_artifacts.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("622_qep_decision_audit_artifacts.sql QEP-150 contract", () => {
  it("creates the decision audit artifact ledger linked to qep_decisions", () => {
    expect(compactSql).toContain("create table if not exists public.qep_decision_audit_artifacts");
    expect(compactSql).toContain("decision_id uuid not null references public.qep_decisions(id) on delete cascade");
    expect(compactSql).toContain("audit_grade text not null");
    expect(compactSql).toContain("storage_key text");
    expect(compactSql).toContain("content_type text");
    expect(compactSql).toContain("checksum_sha256 text");
    expect(compactSql).toContain("byte_size bigint");
    expect(compactSql).toContain("retention_until timestamptz");
    expect(compactSql).toContain("status text not null default 'stored'");
  });

  it("enforces lane-derived artifact tier shapes", () => {
    expect(compactSql).toContain("check (audit_grade in ('auto', 'ratify', 'authorize'))");
    expect(compactSql).toContain("check (artifact_kind in ('row', 'html', 'pdf'))");
    expect(compactSql).toContain("audit_grade <> 'auto' or ( artifact_kind = 'row'");
    expect(compactSql).toContain("audit_grade <> 'ratify' or artifact_kind = 'html'");
    expect(compactSql).toContain("audit_grade <> 'authorize' or artifact_kind = 'pdf'");
    expect(compactSql).toContain("audit_grade <> 'authorize' or retention_until is not null");
  });

  it("keeps service-role write access and authenticated read access only", () => {
    expect(compactSql).toContain("alter table public.qep_decision_audit_artifacts enable row level security");
    expect(compactSql).toContain("for all to service_role using (true) with check (true)");
    expect(compactSql).toContain("for select to authenticated using (public.get_my_role() in ('admin', 'manager', 'owner'))");
  });
});
