import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "684_h10_internal_rental_fleet_service.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("684_h10_internal_rental_fleet_service.sql contract", () => {
  it("adds internal work classification, destination, and posting state", () => {
    expect(compactSql).toContain("service_internal_work_class");
    expect(compactSql).toContain("service_internal_cost_destination");
    expect(compactSql).toContain("renter_fault_billable");
    expect(compactSql).toContain("internal_cost_posting_status");
    expect(compactSql).toContain("used_unit_landed_cost");
    expect(compactSql).toContain("rental_unit");
    expect(compactSql).toContain("new_unit_prep");
  });

  it("blocks non-renter-fault internal work from customer invoices", () => {
    expect(compactSql).toContain("enforce_service_customer_invoice_h10_internal_guard");
    expect(compactSql).toContain("customer_invoices_h10_internal_guard_trg");
    expect(compactSql).toContain("v_job.request_type = 'internal'");
    expect(compactSql).toContain("v_job.renter_fault_billable = false");
    expect(compactSql).toContain("not customer invoices");
  });

  it("posts internal cost to a dedicated ledger and queue view", () => {
    expect(compactSql).toContain("create table if not exists public.service_internal_cost_postings");
    expect(compactSql).toContain("service_post_internal_work_order_cost");
    expect(compactSql).toContain("internal_cost_posted_cents");
    expect(compactSql).toContain("v_service_internal_cost_posting_queue");
    expect(compactSql).toContain("approved_service_quote");
    expect(compactSql).toContain("service_ledgers");
  });

  it("marks H10.1 shipped with mission evidence", () => {
    expect(compactSql).toContain("where task_id = 'h10.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("renter-fault work remains billable");
  });
});
