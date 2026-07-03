import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "669_g81_parts_pricing_engine_counter_discount_cap.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("669_g81_parts_pricing_engine_counter_discount_cap.sql contract", () => {
  it("adds Parts-Manager-owned customer and volume price configuration", () => {
    expect(compactSql).toContain(
      "create table if not exists public.parts_customer_prices",
    );
    expect(compactSql).toContain(
      "create table if not exists public.parts_volume_prices",
    );
    expect(compactSql).toContain("parts_customer_prices_admin_all");
    expect(compactSql).toContain("parts_volume_prices_admin_all");
    expect(compactSql).toContain("public.qep_parts_admin_role()");
    expect(compactSql).toContain(
      "parts-manager-owned customer-specific parts prices",
    );
    expect(compactSql).not.toContain("parts_counter_prices_admin_all");
  });

  it("adds pricing snapshots and approval state to quote and order lines", () => {
    expect(compactSql).toContain("alter table public.parts_order_lines");
    expect(compactSql).toContain(
      "price_source text not null default 'list_price'",
    );
    expect(compactSql).toContain(
      "requested_discount_pct numeric(5, 2) not null default 0",
    );
    expect(compactSql).toContain(
      "discount_approval_status text not null default 'not_required'",
    );
    expect(compactSql).toContain(
      "margin_floor_applied boolean not null default false",
    );
    expect(compactSql).toContain("alter table public.parts_quote_lines");
    expect(compactSql).toContain("final_unit_price_cents bigint");
  });

  it("hides cost and margin from direct authenticated table reads", () => {
    expect(compactSql).toContain(
      "revoke select (unit_cost, margin_pct, pricing_metadata)",
    );
    expect(compactSql).toContain(
      "on public.parts_order_lines from anon, authenticated",
    );
    expect(compactSql).toContain(
      "revoke select (unit_cost_cents, margin_pct, pricing_metadata)",
    );
    expect(compactSql).toContain(
      "on public.parts_quote_lines from anon, authenticated",
    );
    expect(compactSql).toContain(
      "create or replace view public.parts_order_line_pricing_audit",
    );
    expect(compactSql).toContain("and public.qep_parts_admin_role()");
  });

  it("resolves list/customer/volume prices and applies target/floor policy server-side", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_compute_priced_line_private",
    );
    expect(compactSql).toContain(
      "create or replace function public.parts_resolve_priced_line",
    );
    expect(compactSql).toContain("from public.parts_customer_prices cp");
    expect(compactSql).toContain("from public.parts_volume_prices vp");
    expect(compactSql).toContain("name = 'g8.1 parts 35% target'");
    expect(compactSql).toContain("name = 'g8.1 parts 25% floor'");
    expect(compactSql).toContain("'counter_discount_cap_pct', 5");
  });

  it("caps counter authority at 5 percent and blocks ticket release until manager decision", () => {
    expect(compactSql).toContain(
      "when v_requested_discount <= 5 then 'counter'",
    );
    expect(compactSql).toContain("else 'parts_manager'");
    expect(compactSql).toContain("else 'pending_parts_manager_approval'");
    expect(compactSql).toContain(
      "create or replace function public.parts_orders_block_g81_unapproved_discount",
    );
    expect(compactSql).toContain(
      "discount_approval_status in ('pending_parts_manager_approval', 'rejected')",
    );
    expect(compactSql).toContain(
      "parts manager approval is required for discounts beyond 5 percent",
    );
    expect(compactSql).toContain(
      "create or replace function public.parts_decide_line_discount",
    );
  });

  it("preserves accepted quote pricing during convert-dont-rekey order conversion", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_convert_quote_to_order",
    );
    expect(compactSql).toContain("l.price_source");
    expect(compactSql).toContain("l.requested_discount_pct");
    expect(compactSql).toContain("l.discount_approval_status");
    expect(compactSql).toContain("g81_preserve_pricing");
    expect(compactSql).toContain("'pricing_policy', 'g8.1'");
  });

  it("marks G8.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'g8.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain(
      "g81_parts_pricing_engine_counter_discount_cap_shipped",
    );
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("over-5-percent discounts");
  });
});
