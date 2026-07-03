import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "674_g51_multi_location_stock_transfers.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("674_g51_multi_location_stock_transfers.sql contract", () => {
  it("extends the Phase 3 transfer spine instead of creating a parallel workflow table", () => {
    expect(compactSql).toContain("alter table public.parts_transfers");
    expect(compactSql).toContain("parts_order_id uuid references public.parts_orders");
    expect(compactSql).toContain("customer_choice text not null default 'transfer'");
    expect(compactSql).toContain("reservation_expires_at timestamptz");
    expect(compactSql).toContain("alter table public.parts_transfer_lines");
    expect(compactSql).toContain("qty_reserved numeric(14, 4) not null default 0");
    expect(compactSql).not.toContain("create table public.parts_transfer_queue");
  });

  it("keeps reservations quantity-safe and indexed by order and route", () => {
    expect(compactSql).toContain("parts_transfers_g51_customer_choice_ck");
    expect(compactSql).toContain("customer_choice in ('transfer', 'oem_order')");
    expect(compactSql).toContain("parts_transfer_lines_g51_qty_reserved_requested_ck");
    expect(compactSql).toContain("qty_reserved <= qty_requested");
    expect(compactSql).toContain("idx_parts_transfers_order");
    expect(compactSql).toContain("idx_parts_transfers_route_schedule");
    expect(compactSql).toContain("idx_parts_stock_available_route");
  });

  it("adds a counter-visible stock option RPC with transfer and OEM choices", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_location_stock_options",
    );
    expect(compactSql).toContain("returns table");
    expect(compactSql).toContain("option_type text");
    expect(compactSql).toContain("'interbranch_transfer'::text as option_type");
    expect(compactSql).toContain("'oem_order'::text as option_type");
    expect(compactSql).toContain("from public.branch_transfer_edges edge");
    expect(compactSql).toContain("lead_time_hours");
    expect(compactSql).toContain("oem_order_eta_days");
  });

  it("adds a transactional reservation RPC that locks stock and creates transfer records", () => {
    expect(compactSql).toContain(
      "create or replace function public.parts_reserve_interbranch_transfer",
    );
    expect(compactSql).toContain("language plpgsql");
    expect(compactSql).toContain("for update of s");
    expect(compactSql).toContain("v_available < v_quantity");
    expect(compactSql).toContain("update public.parts_stock");
    expect(compactSql).toContain("qty_reserved = qty_reserved + v_quantity");
    expect(compactSql).toContain("insert into public.parts_transfers");
    expect(compactSql).toContain("insert into public.parts_transfer_lines");
    expect(compactSql).toContain("'status', 'reserved'");
  });

  it("keeps execution workspace-scoped through invoker/RLS semantics", () => {
    expect(compactSql).toContain("security invoker");
    expect(compactSql).toContain("public.get_my_workspace()");
    expect(compactSql).toContain(
      "grant execute on function public.parts_location_stock_options",
    );
    expect(compactSql).toContain(
      "grant execute on function public.parts_reserve_interbranch_transfer",
    );
    expect(compactSql).toContain("to authenticated, service_role");
  });

  it("marks G5.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'g5.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("g51_multi_location_stock_transfers_shipped");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain(
      "compare lake city/belleview stock transfer timing against oem-order timing",
    );
  });
});
