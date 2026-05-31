import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "623_q10_rebate_stack_case_by_case_answer.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("623_q10_rebate_stack_case_by_case_answer.sql owner-answer contract", () => {
  it("targets only the Q10 decision row", () => {
    expect(compactSql).toContain("update public.qep_decisions");
    expect(compactSql).toContain("where code = 'q10'");
    expect(compactSql).not.toContain("delete from public.qep_decisions");
    expect(compactSql).not.toContain("drop table");
    expect(compactSql).not.toContain("alter table");
  });

  it("extends Q10 options with the case_by_case label without removing existing options", () => {
    expect(compactSql).toContain('"label":"stack_both"');
    expect(compactSql).toContain('"label":"exclusive"');
    expect(compactSql).toContain('"label":"per_oem"');
    expect(compactSql).toContain('"label":"case_by_case"');
  });

  it("transitions Q10 to answered with case_by_case and owner attribution", () => {
    expect(compactSql).toContain("set status = 'answered'::public.qep_decision_status");
    expect(compactSql).toContain("answered_by = owner_role");
    expect(compactSql).toContain("answered_at = now()");
    expect(compactSql).toContain("answered_option = 'case_by_case'");
    expect(compactSql).toContain("and status = 'open'");
  });

  it("records the source answer id in the rationale for audit traceability", () => {
    expect(compactSql).toContain("8c1456b0-a4f3-4488-9a5b-807e834d27cd");
  });

  it("wraps the update in a single transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });
});
