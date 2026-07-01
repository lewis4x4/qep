import { beforeEach, describe, expect, mock, test } from "bun:test";

type Result = { data: unknown; error: null | { message: string } };

const calls: Array<{ method: string; args: unknown[] }> = [];
let nextResult: Result = { data: [], error: null };

// A thenable query chain: every builder method returns the chain, and awaiting
// the chain at any terminal (.order/.limit/.eq/...) resolves to nextResult.
function makeChain() {
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return chain;
  };
  const chain: Record<string, unknown> = {
    select: record("select"),
    eq: record("eq"),
    is: record("is"),
    order: record("order"),
    limit: record("limit"),
    then: (resolve: (r: Result) => unknown) => resolve(nextResult),
  };
  return chain;
}

const mockFrom = mock((table: string) => {
  calls.push({ method: "from", args: [table] });
  return makeChain();
});
const mockRpc = mock(async (name: string, args: unknown) => {
  calls.push({ method: "rpc", args: [name, args] });
  return nextResult;
});
const mockInvoke = mock(async (name: string, opts: unknown) => {
  calls.push({ method: "invoke", args: [name, opts] });
  return nextResult;
});

mock.module("@/lib/supabase", () => ({
  supabase: { from: mockFrom, rpc: mockRpc, functions: { invoke: mockInvoke } },
}));

const api = await import("../finance-enforcement-api");

function rpcCall(name: string) {
  return calls.find((c) => c.method === "rpc" && c.args[0] === name);
}

describe("finance-enforcement-api contract", () => {
  beforeEach(() => {
    calls.length = 0;
    nextResult = { data: [], error: null };
  });

  test("generateInvoiceNumber calls next_invoice_number with mapped args", async () => {
    nextResult = { data: "01-E1000", error: null };
    const num = await api.generateInvoiceNumber({
      workspaceId: "default",
      branchLegacyCode: "01",
      invoiceType: "equipment",
    });
    expect(num).toBe("01-E1000");
    expect(rpcCall("next_invoice_number")?.args[1]).toEqual({
      p_workspace_id: "default",
      p_branch_legacy_code: "01",
      p_invoice_type: "equipment",
    });
  });

  test("previewTax invokes tax-calculator with ship_to_county and per-item line_items", async () => {
    nextResult = { data: { tax_lines: [], total_tax: 0, state_tax: 0, county_tax: 0, taxable_basis: 0, exemptions_applied: [], manual_override_applied: false }, error: null };
    await api.previewTax({
      subtotal: 64500,
      shipToCounty: "Columbia",
      lineItems: [{ taxable_amount: 60000 }, { taxable_amount: 4500 }],
    });
    const invoke = calls.find((c) => c.method === "invoke");
    expect(invoke?.args[0]).toBe("tax-calculator");
    const body = (invoke?.args[1] as { body: Record<string, unknown> }).body;
    expect(body.ship_to_county).toBe("Columbia");
    expect(body.line_items).toEqual([{ taxable_amount: 60000 }, { taxable_amount: 4500 }]);
  });

  test("runCreditHoldSweep calls evaluate_credit_holds and returns the count", async () => {
    nextResult = { data: 3, error: null };
    expect(await api.runCreditHoldSweep("default")).toBe(3);
    expect(rpcCall("evaluate_credit_holds")?.args[1]).toEqual({ p_workspace_id: "default" });
  });

  test("reverseEquipmentSaleWithApproval routes the approver id", async () => {
    nextResult = { data: { approved: true, outcome: "reversal_executed", approver_role: "manager" }, error: null };
    const r = await api.reverseEquipmentSaleWithApproval({
      stockNumber: "SN-1", reversalId: "REV-1", reason: "duplicate", approverId: "user-1",
    });
    expect(r.approved).toBe(true);
    expect(rpcCall("reverse_equipment_sale_with_approval")?.args[1]).toMatchObject({
      p_stock_number: "SN-1", p_approver_id: "user-1",
    });
  });

  test("evaluateThreeWayMatch and routeApInvoiceForApproval hit their RPCs", async () => {
    nextResult = { data: "price_mismatch", error: null };
    expect(await api.evaluateThreeWayMatch("vi-1")).toBe("price_mismatch");
    nextResult = { data: 2, error: null };
    expect(await api.routeApInvoiceForApproval("vi-1")).toBe(2);
    expect(rpcCall("evaluate_three_way_match")).toBeTruthy();
    expect(rpcCall("route_ap_invoice_for_approval")).toBeTruthy();
  });

  test("recordApPayment surfaces the double-pay guard error message", async () => {
    nextResult = { data: null, error: { message: "invoice already fully paid" } };
    await expect(
      api.recordApPayment({ vendorInvoiceId: "vi-1", amount: 100 }),
    ).rejects.toThrow("record_ap_payment: invoice already fully paid");
  });

  test("computeFet returns 0 path and evaluateForm8300 maps invoice id", async () => {
    nextResult = { data: 0, error: null };
    expect(await api.computeFet({ taxableAmount: 50000, isExempt: true })).toBe(0);
    expect(rpcCall("compute_fet")?.args[1]).toMatchObject({ p_is_exempt: true });
    nextResult = { data: "rep-1", error: null };
    expect(await api.evaluateForm8300("inv-1")).toBe("rep-1");
  });

  test("reads target the right tables/views", async () => {
    await api.listInvoiceSequences("default");
    await api.getMarginMatrix("default");
    await api.listVendorInvoices("default");
    await api.listForm8300Reports("default");
    expect(calls).toContainEqual({ method: "from", args: ["invoice_number_sequences"] });
    expect(calls).toContainEqual({ method: "from", args: ["v_margin_matrix_summary"] });
    expect(calls).toContainEqual({ method: "from", args: ["vendor_invoices"] });
    expect(calls).toContainEqual({ method: "from", args: ["form_8300_reports"] });
  });

  test("reads surface Supabase errors", async () => {
    nextResult = { data: null, error: { message: "permission denied" } };
    await expect(api.getMarginMatrix("default")).rejects.toThrow("getMarginMatrix: permission denied");
  });
});
