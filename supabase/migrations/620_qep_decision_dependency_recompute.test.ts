import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "620_qep_decision_dependency_recompute.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(functionName: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${functionName}\\s*\\([\\s\\S]*?as\\s+\\$func\\$[\\s\\S]*?\\n\\$func\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").toLowerCase();
}

describe("620_qep_decision_dependency_recompute.sql F4.2 contract", () => {
  it("keeps unblocks_recompute_codes available with index + column comment", () => {
    expect(compactSql).toContain("alter table public.qep_decisions add column if not exists unblocks_recompute_codes text[]");
    expect(compactSql).toContain("create index if not exists qep_decisions_unblocks_recompute_codes_gin_idx");
    expect(compactSql).toContain("comment on column public.qep_decisions.unblocks_recompute_codes is");
  });

  it("recomputes dependency context only when parent transitions into resolved status", () => {
    const fn = compact(functionSql("fn_qep_decision_resolved_promote_tasks"));

    expect(fn).toContain("if not (new.status::text in ('answered','shadow_ship','superseded')) or (old.status::text in ('answered','shadow_ship','superseded')) then return new");
    expect(fn).toContain("if coalesce(array_length(new.unblocks_recompute_codes, 1), 0) > 0 then");
    expect(fn).toContain("where child.code = any(new.unblocks_recompute_codes)");
    expect(fn).toContain("and child.code <> new.code");
    expect(fn).toContain("and child.status::text in ('open', 'escalated', 'shadow_ship')");
  });

  it("appends structured parent answer context into ai_prep_packet", () => {
    const fn = compact(functionSql("fn_qep_decision_resolved_promote_tasks"));

    expect(fn).toContain("'parent_code', new.code");
    expect(fn).toContain("'parent_status', new.status::text");
    expect(fn).toContain("'answered_option', new.answered_option");
    expect(fn).toContain("'answered_rationale', new.answered_rationale");
    expect(fn).toContain("'answered_at', new.answered_at");
    expect(fn).toContain("'recomputed_at', now()");
    expect(fn).toContain("'dependency_context'");
    expect(fn).toContain("coalesce(child.ai_prep_packet->'dependency_context', '{}'::jsonb)");
    expect(fn).toContain("coalesce(child.ai_prep_packet #> '{dependency_context,parents}', '{}'::jsonb) || jsonb_build_object(new.code, v_dependency_payload)");
    expect(fn).toContain("'last_parent_resolution'");
    expect(fn).toContain("'dependency_recompute'");
    expect(fn).toContain("coalesce(child.ai_prep_packet->'dependency_recompute', '[]'::jsonb) || jsonb_build_array(v_dependency_payload)");
  });
});
