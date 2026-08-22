import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(here, "837_service_ro_close_invoice_ar_closeout.sql"),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ");

describe("837_service_ro_close_invoice_ar_closeout.sql contract", () => {
  it("defines tenant-bound AR sync RPC for service invoice closeout", () => {
    expect(compact).toContain("service_sync_ar_open_item_for_invoice");
    expect(compact).toContain("get_my_workspace()");
    expect(compact).toContain("workspace mismatch");
    expect(compact).toContain("qrm_ar_open_items");
    expect(compact).toContain("current_ar_balance");
  });

  it("extends v_rep_customers with open_ar_balance from customer_invoices", () => {
    expect(compact).toContain("open_ar_balance");
    expect(compact).toContain("customer_invoices ci");
    expect(compact).toContain("equipment_summary");
  });
});
