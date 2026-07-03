import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "678_g121_cycle_counts_dead_stock.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("678_g121_cycle_counts_dead_stock.sql contract", () => {
  it("defines ADR-019 dead stock as exactly 18 months", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_dead_stock_months",
    );
    expect(compactSql).toContain("select 18");
    expect(compactSql).toContain(
      "dead stock is no movement in 18 months, not the earlier 12-month recommendation",
    );
    expect(compactSql).toContain("dead_stock_months = public.parts_dead_stock_months()");
  });

  it("adds a stock movement ledger for variance and dead-stock evidence", () => {
    expect(compactSql).toContain(
      "create table if not exists public.parts_stock_movements",
    );
    expect(compactSql).toContain("'cycle_count_adjustment'");
    expect(compactSql).toContain("quantity_delta numeric(14, 4) not null");
    expect(compactSql).toContain("idx_parts_stock_movements_part_location");
    expect(compactSql).toContain("parts_stock_movements_operator_mutate");
  });

  it("extends cycle count headers and lines with weighted selection and variance fields", () => {
    expect(compactSql).toContain("alter table public.cycle_counts");
    expect(compactSql).toContain(
      "selection_strategy text not null default 'weighted_velocity_value'",
    );
    expect(compactSql).toContain("line_count integer not null default 0");
    expect(compactSql).toContain("alter table public.cycle_count_lines");
    expect(compactSql).toContain("priority_score numeric(8, 2) not null default 0");
    expect(compactSql).toContain("variance_value_cents bigint not null default 0");
    expect(compactSql).toContain("review_required boolean not null default false");
  });

  it("builds weighted cycle count and 18-month dead-stock views", () => {
    expect(compactSql).toContain(
      "create or replace view public.v_parts_cycle_count_candidates",
    );
    expect(compactSql).toContain(
      "now() - make_interval(months => public.parts_dead_stock_months())",
    );
    expect(compactSql).toContain("then 'high_value'");
    expect(compactSql).toContain("then 'fast'");
    expect(compactSql).toContain("then 'dead'");
    expect(compactSql).toContain(
      "create or replace view public.v_parts_dead_stock_18_months",
    );
    expect(compactSql).toContain("where is_dead_stock_18_months = true");
    expect(compactSql).toContain("suggested return/discount/scrap actions are deferred");
  });

  it("generates count lists using high-value and fast-moving priority", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_generate_cycle_count",
    );
    expect(compactSql).toContain("public.qep_parts_operator_role()");
    expect(compactSql).toContain("weighted_velocity_value");
    expect(compactSql).toContain("dead_stock_review");
    expect(compactSql).toContain("order by case when p_count_type = 'dead_stock_review'");
    expect(compactSql).toContain("'suggested_actions_deferred', true");
  });

  it("records and posts count variances into stock and movement evidence", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_record_cycle_count_line",
    );
    expect(compactSql).toContain("variance_decision = case");
    expect(compactSql).toContain(
      "create or replace function public.parts_post_cycle_count_variances",
    );
    expect(compactSql).toContain("qty_on_hand = v_line.counted_qty");
    expect(compactSql).toContain("'cycle_count_adjustment'");
    expect(compactSql).toContain("'posted_line_count', v_posted");
  });

  it("marks G12.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'g12.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain(
      "g121_cycle_counts_dead_stock_shipped",
    );
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain(
      "without prematurely automating return/discount/scrap decisions",
    );
  });
});
