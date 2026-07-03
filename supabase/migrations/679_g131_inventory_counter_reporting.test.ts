import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "679_g131_inventory_counter_reporting.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("679_g131_inventory_counter_reporting.sql contract", () => {
  it("gates aggregate cost and margin reporting to reporting roles", () => {
    expect(compactSql).toContain(
      "create or replace function public.qep_parts_reporting_role",
    );
    expect(compactSql).toContain("'finance_admin'");
    expect(compactSql).toContain(
      "true for parts reporting consumers allowed to see aggregate cost, margin, inventory, and counter coaching metrics",
    );
    expect(compactSql).toContain(
      "create or replace function public.parts_reporting_margin_target_pct",
    );
    expect(compactSql).toContain("select 35.00::numeric");
  });

  it("creates inventory location and turns report views", () => {
    expect(compactSql).toContain(
      "create or replace view public.v_parts_inventory_location_report",
    );
    expect(compactSql).toContain("inventory_value_cents");
    expect(compactSql).toContain("dead_stock_value_cents");
    expect(compactSql).toContain("inventory_fill_rate_pct");
    expect(compactSql).toContain("public.parts_dead_stock_months()");
    expect(compactSql).toContain(
      "create or replace view public.v_parts_inventory_turns_report",
    );
    expect(compactSql).toContain("annual_sales_qty");
    expect(compactSql).toContain("inventory_turns");
    expect(compactSql).toContain("margin_vs_target_pct");
    expect(compactSql).toContain("is_dead_stock_18_months");
  });

  it("creates counter customer-experience and coaching report views", () => {
    expect(compactSql).toContain(
      "create or replace view public.v_parts_counter_order_report",
    );
    expect(compactSql).toContain("'customer_actual_experience'::text as fill_rate_basis");
    expect(compactSql).toContain("counter_fill_rate_pct");
    expect(compactSql).toContain("special_order_ratio_pct");
    expect(compactSql).toContain("quote_converted_to_sale");
    expect(compactSql).toContain("time_to_serve_minutes");
    expect(compactSql).toContain(
      "create or replace view public.v_parts_counterperson_coaching_report",
    );
    expect(compactSql).toContain("'coaching_not_ranking'::text as coaching_frame");
    expect(compactSql).not.toContain("leaderboard");
    expect(compactSql).not.toContain("dense_rank");
    expect(compactSql).not.toContain("rank() over");
  });

  it("exposes the two v1 report JSON contracts", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_inventory_report",
    );
    expect(compactSql).toContain("'api_contract', '/v1/reports/inventory'");
    expect(compactSql).toContain("'turns_basis', 'trailing_365_days'");
    expect(compactSql).toContain("'watch_numbers'");
    expect(compactSql).toContain(
      "create or replace function public.parts_counter_report",
    );
    expect(compactSql).toContain("'api_contract', '/v1/reports/counter'");
    expect(compactSql).toContain(
      "'headline_metric', 'counter_fill_rate_customer_actual_experience'",
    );
    expect(compactSql).toContain("'quote_to_sale_conversion_pct'");
    expect(compactSql).toContain("'coaching_rows'");
  });

  it("adds reporting indexes without broadening direct order-line cost access", () => {
    expect(compactSql).toContain("idx_parts_orders_g131_counter_reporting");
    expect(compactSql).toContain("idx_parts_order_lines_g131_part_workspace");
    expect(compactSql).toContain("idx_parts_fulfillment_events_g131_counter");
    expect(compactSql).toContain("idx_parts_order_events_g131_pick");
    expect(compactSql).not.toContain(
      "grant select (unit_cost, margin_pct, pricing_metadata)",
    );
  });

  it("marks G13.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'g13.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain(
      "g131_inventory_counter_reporting_shipped",
    );
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain(
      "weekly watch numbers for turns, fill rate, margin, dead stock, and counter service quality",
    );
  });
});
