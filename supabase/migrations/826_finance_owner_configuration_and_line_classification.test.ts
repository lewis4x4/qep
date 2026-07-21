import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/826_finance_owner_configuration_and_line_classification.sql",
  ),
  "utf8",
);
const quickBooks = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/quickbooks-gl.ts"),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("826 finance owner configuration + structural classification", () => {
  it("places answered finance policy without secrets", () => {
    for (const key of [
      "invoice_pad_width",
      "department_invoice_prefixes",
      "branch_allocation_basis",
      "book_depreciation_policy",
      "open_service_wo_cutover_policy",
      "master_id_strategy",
      "quickbooks_desktop_boundary",
      "bank_account_register",
      "deposit_liability_policy",
      "finance_charge_policy_requested",
    ]) {
      expect(compact).toContain(`'${key}'`);
    }
    expect(compact).toContain('"contains_account_numbers":false');
    expect(compact).toContain('"activation_status":"legal_review_required"');
  });

  it("uses the owner-approved E/R/P/W mapping", () => {
    expect(compact).toContain(
      "when 'equipment' then 'e' when 'rental' then 'r' when 'parts' then 'p' when 'service' then 'w'",
    );
    expect(compact).toContain('"service":"w"');
    expect(compact).toContain('{"digits":5}');
    expect(compact).toContain("and slug = '01'");
    expect(compact).not.toContain("and slug = 'lakecity-branch'");
    expect(compact).toContain("historical lakecity-branch row used by legacy inventory references");
  });

  it("persists both department and segment on canonical line tables", () => {
    for (const table of [
      "customer_invoice_line_items",
      "parts_invoice_lines",
      "service_quote_lines",
      "service_billing_rows",
    ]) {
      expect(compact).toContain(`alter table public.${table}`);
    }
    expect(compact).toContain("finance_department");
    expect(compact).toContain("finance_segment");
    expect(compact).toContain("finance_category");
  });

  it("keeps parts on service work orders in the Parts department", () => {
    expect(compact).toContain(
      "create index if not exists idx_service_billing_rows_parts_line_latest on public.service_billing_rows (parts_invoice_line_id, created_at desc) where deleted_at is null and parts_invoice_line_id is not null",
    );
    expect(compact).toContain(
      "case when v_line_type = 'part' then 'parts' else 'service' end",
    );
    expect(compact).toContain("canonical parts rows stay parts");
  });

  it("does not backfill mixed service invoices from descriptions", () => {
    expect(compact).toContain("historical service lines remain unclassified");
    expect(compact).toContain("description-string heuristic");
    expect(compact).toContain("no description matching is used");
  });

  it("routes QuickBooks lines from structural fields, not copy", () => {
    expect(quickBooks).toContain("finance_department");
    expect(quickBooks).toContain("finance_category");
    expect(quickBooks).toContain("resolveRevenueAccount");
    expect(quickBooks).not.toContain('lower.includes("labor")');
    expect(quickBooks).not.toContain("description.split");
  });
});
