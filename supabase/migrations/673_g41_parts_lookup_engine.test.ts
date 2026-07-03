import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "673_g41_parts_lookup_engine.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("673_g41_parts_lookup_engine.sql contract", () => {
  it("creates the unified lookup RPC instead of a parallel catalog table", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_lookup_engine",
    );
    expect(compactSql).toContain("returns table");
    expect(compactSql).toContain("lookup_path text");
    expect(compactSql).toContain("stock_locations jsonb");
    expect(compactSql).toContain("diagrams jsonb");
    expect(compactSql).not.toContain("create table public.parts_lookup");
  });

  it("supports all five required lookup paths", () => {
    expect(compactSql).toContain("'part_number'::text as lookup_path");
    expect(compactSql).toContain("'keyword'::text as lookup_path");
    expect(compactSql).toContain("'kit'::text as lookup_path");
    expect(compactSql).toContain("'supersession'::text as lookup_path");
    expect(compactSql).toContain("then 'machine_serial'");
    expect(compactSql).toContain("else 'machine_model'");
  });

  it("prioritizes machine lookup with fitment and diagram evidence", () => {
    expect(compactSql).toContain("join public.parts_by_machine pbm");
    expect(compactSql).toContain("pbm.serial_prefix");
    expect(compactSql).toContain(
      "a.machine_serial like lower(pbm.serial_prefix) || '%'",
    );
    expect(compactSql).toContain(
      "coalesce(pbm.metadata -> 'diagrams', '[]'::jsonb)",
    );
    expect(compactSql).toContain("'priority_path', true");
  });

  it("uses kit headers and kit lines for kit lookup", () => {
    expect(compactSql).toContain("join public.parts_kits k");
    expect(compactSql).toContain("join public.parts_kit_items ki");
    expect(compactSql).toContain("k.status = 'active'");
    expect(compactSql).toContain("'quantity', ki.quantity");
    expect(compactSql).toContain("'required', ki.required");
  });

  it("uses the existing cross-reference graph for supersessions", () => {
    expect(compactSql).toContain(
      "from args a join public.parts_cross_references x",
    );
    expect(compactSql).toContain(
      "x.relationship in ('supersedes', 'superseded_by')",
    );
    expect(compactSql).toContain("when 'supersedes' then 'superseded_by'");
    expect(compactSql).toContain("when 'superseded_by' then 'supersedes'");
  });

  it("bridges normalized parts, legacy catalog rows, and stock evidence", () => {
    expect(compactSql).toContain("from public.parts p");
    expect(compactSql).toContain("from public.parts_catalog pc");
    expect(compactSql).toContain("not exists ( select 1 from public.parts p");
    expect(compactSql).toContain("from public.parts_stock s");
    expect(compactSql).toContain("left join public.parts_locations l");
  });

  it("keeps execution workspace-scoped through invoker/RLS semantics", () => {
    expect(compactSql).toContain("security invoker");
    expect(compactSql).toContain("public.get_my_workspace()");
    expect(compactSql).toContain(
      "grant execute on function public.parts_lookup_engine",
    );
    expect(compactSql).toContain("to authenticated, service_role");
  });

  it("extends counter inquiry auditing for the new lookup categories", () => {
    expect(compactSql).toContain(
      "drop constraint if exists counter_inquiries_match_type_check",
    );
    expect(compactSql).toContain("counter_inquiries_g41_match_type_check");
    expect(compactSql).toContain("'machine_serial'");
    expect(compactSql).toContain("'machine_model'");
    expect(compactSql).toContain("'kit'");
    expect(compactSql).toContain("'supersession'");
  });

  it("marks G4.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'g4.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("g41_parts_lookup_engine_shipped");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain(
      "part-number, machine make/model/serial with diagram metadata, keyword, kit, and supersession paths",
    );
  });
});
