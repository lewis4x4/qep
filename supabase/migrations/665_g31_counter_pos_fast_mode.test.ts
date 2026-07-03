import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "665_g31_counter_pos_fast_mode.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("665_g31_counter_pos_fast_mode.sql contract", () => {
  it("adds counter POS tender fields to the existing parts order spine", () => {
    expect(compactSql).toContain("alter table public.parts_orders");
    expect(compactSql).toContain("payment_classification text not null default 'cash'");
    expect(compactSql).toContain("payment_status text not null default 'unpaid'");
    expect(compactSql).toContain("charge_authorization_status text not null default 'not_applicable'");
    expect(compactSql).toContain("receipt_number text");
    expect(compactSql).not.toContain("create table public.counter_tickets");
  });

  it("requires Cash/Charge classification and tender shape", () => {
    expect(compactSql).toContain("parts_orders_g31_payment_classification_ck");
    expect(compactSql).toContain("payment_classification in ('cash', 'charge')");
    expect(compactSql).toContain("parts_orders_g31_tender_shape_ck");
    expect(compactSql).toContain("payment_status in ('unpaid', 'paid')");
    expect(compactSql).toContain("payment_status = 'charge_account'");
  });

  it("blocks release until cash is paid or charge is approved", () => {
    expect(compactSql).toContain("parts_orders_g31_counter_release_ck");
    expect(compactSql).toContain("status in ('draft', 'cancelled', 'canceled')");
    expect(compactSql).toContain("payment_classification = 'cash' and payment_status = 'paid'");
    expect(compactSql).toContain("payment_classification = 'charge' and charge_authorization_status in ('approved_credit', 'exec_approved')");
  });

  it("indexes receipt and tender review paths", () => {
    expect(compactSql).toContain("idx_parts_orders_g31_tender");
    expect(compactSql).toContain("parts_orders_g31_receipt_number_uidx");
    expect(compactSql).toContain("where receipt_number is not null");
  });

  it("marks G3.1 shipped with mission-aligned evidence", () => {
    expect(compactSql).toContain("where task_id = 'g3.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("g31_counter_pos_fast_mode_shipped");
    expect(compactSql).toContain("mission_alignment");
  });
});
