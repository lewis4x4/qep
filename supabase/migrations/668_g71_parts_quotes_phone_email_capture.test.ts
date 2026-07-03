import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "668_g71_parts_quotes_phone_email_capture.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("668_g71_parts_quotes_phone_email_capture.sql contract", () => {
  it("extends existing parts quote and order spines instead of creating duplicates", () => {
    expect(compactSql).toContain("alter table public.parts_quotes");
    expect(compactSql).toContain("quote_source text not null default 'counter'");
    expect(compactSql).toContain("expires_at timestamptz");
    expect(compactSql).toContain("freight_estimate_cents bigint not null default 0");
    expect(compactSql).toContain("converted_parts_order_id uuid references public.parts_orders");
    expect(compactSql).toContain("alter table public.parts_orders");
    expect(compactSql).toContain("originating_parts_quote_id uuid references public.parts_quotes");
    expect(compactSql).not.toContain("create table public.parts_quote_orders");
  });

  it("supports phone/email capture and keeps freight/payment rules explicit", () => {
    expect(compactSql).toContain("parts_quotes_g71_quote_source_ck");
    expect(compactSql).toContain("'phone'");
    expect(compactSql).toContain("'email'");
    expect(compactSql).toContain("parts_orders_order_source_check");
    expect(compactSql).toContain("'email'");
    expect(compactSql).toContain("parts_quotes_g71_freight_source_ck");
    expect(compactSql).toContain("'vendor_estimate'");
    expect(compactSql).toContain("cash_up_front_including_freight");
  });

  it("adds workspace guards and parts-counter policies for quote/order mutation", () => {
    expect(compactSql).toContain("create or replace function public.parts_quotes_enforce_customer_workspace");
    expect(compactSql).toContain("parts_quotes_enforce_customer_workspace_trg");
    expect(compactSql).toContain("create or replace function public.parts_quote_lines_sync_workspace");
    expect(compactSql).toContain("parts_quote_lines_sync_workspace_trg");
    expect(compactSql).toContain("parts_quotes_g71_parts_operator");
    expect(compactSql).toContain("parts_quote_lines_g71_parts_operator");
    expect(compactSql).toContain("parts_orders_g71_parts_operator");
    expect(compactSql).toContain("public.qep_parts_operator_role()");
  });

  it("adds convert-dont-rekey quote-to-order RPC", () => {
    expect(compactSql).toContain("create or replace function public.parts_convert_quote_to_order");
    expect(compactSql).toContain("for update");
    expect(compactSql).toContain("parts quote has already been converted");
    expect(compactSql).toContain("parts quote is expired");
    expect(compactSql).toContain("insert into public.parts_orders");
    expect(compactSql).toContain("insert into public.parts_order_lines");
    expect(compactSql).toContain("update public.parts_quotes");
    expect(compactSql).toContain("event_type");
    expect(compactSql).toContain("'quote_converted'");
  });

  it("keeps converted orders cash-up-front including freight", () => {
    expect(compactSql).toContain("v_freight_cents := greatest");
    expect(compactSql).toContain("v_total_cents := greatest(v_subtotal_cents - v_discount_cents + v_tax_cents + v_freight_cents");
    expect(compactSql).toContain("payment_classification");
    expect(compactSql).toContain("payment_status");
    expect(compactSql).toContain("'unpaid'");
    expect(compactSql).toContain("freight_charge_cents");
    expect(compactSql).toContain("po_total_cents");
  });

  it("marks G7.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'g7.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("g71_parts_quotes_phone_email_capture_shipped");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain(
      "capture phone/email requests as priced short-lived quotes",
    );
  });
});
