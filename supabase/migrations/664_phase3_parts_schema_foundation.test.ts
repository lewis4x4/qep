import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "664_phase3_parts_schema_foundation.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

const requiredTables = [
  "parts",
  "parts_locations",
  "parts_bins",
  "parts_stock",
  "parts_by_machine",
  "parts_kits",
  "parts_kit_items",
  "parts_documents",
  "parts_document_lines",
  "purchase_orders",
  "purchase_order_lines",
  "parts_transfers",
  "parts_transfer_lines",
  "core_ledger",
  "customer_returns",
  "vendor_returns",
  "cycle_counts",
  "cycle_count_lines",
];

const childTriggers = [
  "parts_kit_items_sync_workspace_trg",
  "parts_document_lines_sync_workspace_trg",
  "purchase_order_lines_sync_workspace_trg",
  "parts_transfer_lines_sync_workspace_trg",
  "cycle_count_lines_sync_workspace_trg",
];

describe("664_phase3_parts_schema_foundation.sql contract", () => {
  it("creates the required Phase 3 Parts foundation tables", () => {
    for (const table of requiredTables) {
      expect(compactSql).toContain(`create table if not exists public.${table}`);
      expect(compactSql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("preserves existing OEM credential and service warranty surfaces with compatibility extensions", () => {
    expect(compactSql).toContain("create or replace view public.oem_portals");
    expect(compactSql).toContain("from public.oem_portal_profiles");
    expect(compactSql).toContain("comment on table public.oem_portal_credentials");
    expect(compactSql).not.toContain("create table if not exists public.oem_portal_credentials");

    expect(compactSql).toContain("alter table public.warranty_claims");
    expect(compactSql).toContain("alter column service_job_id drop not null");
    expect(compactSql).toContain("claim_scope text not null default 'service'");
    expect(compactSql).toContain("warranty_claims_phase3_scope_parent_ck");
    expect(compactSql).not.toContain("create table if not exists public.warranty_claims");
  });

  it("defines parts-specific role helpers without inventing a new enum role", () => {
    expect(compactSql).toContain("create or replace function public.qep_parts_staff_role()");
    expect(compactSql).toContain("'parts_counter'");
    expect(compactSql).toContain("'service_writer'");
    expect(compactSql).toContain("'finance_admin'");
    expect(compactSql).not.toContain("'parts_manager'");
  });

  it("adds service role and workspace-scoped staff/operator policies", () => {
    for (const table of requiredTables) {
      const servicePolicy =
        table === "parts" ? "parts_phase3_service_all" : `${table}_service_all`;
      expect(compactSql).toContain(servicePolicy);
    }

    expect(compactSql).toContain("workspace_id = (select public.get_my_workspace())");
    expect(compactSql).toContain("public.qep_parts_staff_role()");
    expect(compactSql).toContain("public.qep_parts_operator_role()");
    expect(compactSql).toContain("public.qep_parts_admin_role()");
  });

  it("keeps child line workspaces pinned to their parent headers", () => {
    expect(compactSql).toContain("create or replace function public.qep_phase3_parts_child_workspace_from_parent()");

    for (const trigger of childTriggers) {
      expect(compactSql).toContain(trigger);
      expect(compactSql).toContain("execute function public.qep_phase3_parts_child_workspace_from_parent");
    }
  });

  it("backfills from existing parts_catalog and parts_inventory instead of starting empty", () => {
    expect(compactSql).toContain("from public.parts_catalog pc");
    expect(compactSql).toContain("from public.parts_inventory pi");
    expect(compactSql).toContain("legacy_inventory_id");
    expect(compactSql).toContain("'parts_catalog'");
    expect(compactSql).toContain("'parts_inventory'");
  });

  it("marks G1.1 shipped with migration evidence and mission alignment", () => {
    expect(compactSql).toContain("where task_id = 'g1.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("supabase/migrations/664_phase3_parts_schema_foundation.sql");
    expect(compactSql).toContain("g11_phase3_parts_schema_foundation_shipped");
    expect(compactSql).toContain("mission_alignment");
  });
});
