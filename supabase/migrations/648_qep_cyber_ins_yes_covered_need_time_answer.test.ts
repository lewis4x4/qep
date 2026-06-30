import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "648_qep_cyber_ins_yes_covered_need_time_answer.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("648_qep_cyber_ins_yes_covered_need_time_answer.sql", () => {
  it("appends the yes_covered_need_time option to CYBER-INS options idempotently", () => {
    expect(compactSql).toContain("update public.qep_decisions");
    expect(compactSql).toContain("set options = options ||");
    expect(compactSql).toContain('"label":"yes_covered_need_time"');
    expect(compactSql).toContain("where code = 'cyber-ins'");
    expect(compactSql).toContain("not exists");
    expect(compactSql).toContain("jsonb_array_elements(options)");
    expect(compactSql).toContain("opt->>'label' = 'yes_covered_need_time'");
  });

  it("records the answered status, option, owner, and rationale on CYBER-INS", () => {
    expect(compactSql).toContain("status = 'answered'::public.qep_decision_status");
    expect(compactSql).toContain("answered_by = 'rylee'");
    expect(compactSql).toContain("answered_at = now()");
    expect(compactSql).toContain("answered_option = 'yes_covered_need_time'");
    expect(compactSql).toContain("answered_rationale");
    expect(compactSql).toContain("and status = 'open'");
  });

  it("captures source-answer provenance in the rationale", () => {
    expect(compactSql).toContain("1345941c-db62-4be6-bd56-d6c38d2e7317");
    expect(compactSql).toContain("c58ed852-444b-4e32-b900-24b9230aeade");
  });

  it("references the three named AI-powered internal tools", () => {
    expect(compactSql).toContain("iron quote");
    expect(compactSql).toContain("decision inbox");
    expect(compactSql).toContain("qep knowledge base");
  });

  it("wraps the work in a single transaction", () => {
    expect(compactSql).toContain("begin;");
    expect(compactSql).toContain("commit;");
  });
});
