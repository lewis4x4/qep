import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const path = join(
  process.cwd(),
  "supabase/migrations/823_rental_ops_health_and_commission_editor.sql",
);
const sql = readFileSync(path, "utf8");
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("823 rental ops health + commission editor", () => {
  it("ops health is workspace-guarded and browser-readable", () => {
    expect(compact).toContain("perform public.rental_assert_workspace(p_workspace_id)");
    expect(compact).toContain(
      "revoke all on function public.rental_ops_health(text) from public, anon",
    );
    expect(compact).toContain(
      "grant execute on function public.rental_ops_health(text) to authenticated, service_role",
    );
  });

  it("ops health reads every dashboard dimension", () => {
    for (const marker of [
      "'rental.cycle.due'",
      "'rental.availability.low'",
      "'rental.geofence.exit'",
      "rental_availability_pressure(current_date, current_date + 14)",
      "'customer_jobsite'",
      "lifecycle_state in ('reserved', 'on_rent', 'off_rent')",
    ]) {
      expect(compact).toContain(marker);
    }
  });

  it("cycle resolution excludes alerts still inside their 3-day window", () => {
    expect(compact).toContain(
      "count(*) filter (where billed and occurred_at <= now() - interval '3 days')",
    );
  });

  it("commission setter is service-only with no caller grants", () => {
    expect(compact).toContain(
      "rental_set_contract_commissions requires service_role",
    );
    expect(compact).toContain(
      "revoke all on function public.rental_set_contract_commissions(text, uuid, jsonb, uuid) from public, anon, authenticated",
    );
    expect(compact).toContain(
      "grant execute on function public.rental_set_contract_commissions(text, uuid, jsonb, uuid) to service_role",
    );
  });

  it("commission setter enforces the invariants", () => {
    expect(compact).toContain("if abs(v_sum - 100) > 0.01 then");
    expect(compact).toContain("salesperson is not a member of the rental workspace");
    expect(compact).toContain("duplicate salesperson in splits");
    expect(compact).toContain("for update");
  });

  it("returning reps are resurrected through the non-partial unique key", () => {
    expect(compact).toContain(
      "on conflict (rental_contract_id, salesperson_id) do update set split_pct = excluded.split_pct, role = excluded.role, deleted_at = null",
    );
  });

  it("removed reps are soft-deleted, never hard-deleted", () => {
    expect(compact).toContain("set deleted_at = now(), updated_at = now()");
    expect(compact).not.toContain("delete from public.rental_contract_commissions");
  });
});
