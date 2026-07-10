import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const path = join(
  process.cwd(),
  "supabase/migrations/822_rental_worldclass_security_and_signal_hardening.sql",
);
const sql = readFileSync(path, "utf8");
const compact = sql.replace(/\s+/g, " ").toLowerCase();

function functionSql(name: string): string {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  expect(match).not.toBeNull();
  return (match?.[0] ?? "").replace(/\s+/g, " ").toLowerCase();
}

describe("822 rental security and signal hardening", () => {
  it("removes authenticated access from internal geofence and mutation RPCs", () => {
    expect(compact).toContain(
      "revoke all on function public.rental_evaluate_geofence_crossings(text) from public, anon, authenticated",
    );
    expect(compact).toContain(
      "grant execute on function public.rental_evaluate_geofence_crossings(text) to service_role",
    );
    expect(compact).toContain(
      "revoke all on function public.rental_ensure_default_commission(text, uuid, uuid) from public, anon, authenticated",
    );
    expect(compact).toContain(
      "grant execute on function public.rental_upsert_jobsite_geofence( text, uuid, text, double precision, double precision, numeric, uuid ) to service_role",
    );
  });

  it("guards the browser-facing conversion board by active workspace", () => {
    const wrapper = functionSql("rental_conversion_board");
    expect(wrapper).toContain(
      "perform public.rental_assert_workspace(p_workspace_id)",
    );
    expect(compact).toContain(
      "revoke all on function public.rental_conversion_board_v1_unchecked(text, integer) from public, anon, authenticated, service_role",
    );
  });

  it("requires service role and workspace membership for attribution writes", () => {
    const wrapper = functionSql("rental_ensure_default_commission");
    const internal = functionSql("rental_ensure_default_commission_internal");
    const fence = functionSql("rental_upsert_jobsite_geofence");
    expect(wrapper).toContain("auth.role()) is distinct from 'service_role'");
    expect(internal).toContain("from public.profile_workspaces pw");
    expect(internal).toContain("pw.workspace_id = p_workspace_id");
    expect(fence).toContain("auth.role()) is distinct from 'service_role'");
    expect(fence).toContain("pw.profile_id = p_actor_id");
    expect(fence).toContain("pw.workspace_id = p_workspace_id");
    expect(fence).toContain("pg_advisory_xact_lock(hashtextextended");
  });

  it("seeds draft attribution atomically through the insert trigger", () => {
    const trigger = functionSql("rental_seed_commission_on_rent");
    expect(trigger).toContain("if tg_op = 'insert'");
    expect(trigger).toContain(
      "perform public.rental_ensure_default_commission_internal",
    );
    expect(compact).toContain(
      "revoke all on function public.rental_seed_commission_on_rent() from public, anon, authenticated, service_role",
    );
  });

  it("derives the next invoice date from 28-day arrears semantics", () => {
    const candidates = functionSql("rental_cycle_due_candidates");
    expect(candidates).toContain("c.on_rent_at::date + 28");
    expect(candidates).toContain("invoice.last_period_end + 29");
    expect(candidates).toContain("ri.workspace_id = c.workspace_id");
    expect(candidates).toContain("next_cycle_due");
  });

  it("takes minimum daily headroom and avoids line/hold double counting", () => {
    const pressure = functionSql("rental_availability_pressure");
    expect(pressure).toContain("generate_series(p_from, p_to");
    expect(pressure).toContain("partition by d.workspace_id, d.category");
    expect(pressure).toContain(
      "order by d.fleet_count - d.demand_count asc",
    );
    expect(pressure).toContain(
      "active_hold.rental_contract_line_id = l.id",
    );
    expect(pressure).toContain(
      "coalesce(e.readiness_status::text, 'available') <> 'in_service'",
    );
  });
});
