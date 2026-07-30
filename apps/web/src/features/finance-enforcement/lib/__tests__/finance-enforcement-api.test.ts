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

  test("foundation status proves QuickBooks Desktop is downstream output only", () => {
    const status = api.buildFinanceFoundationStatus([]);
    const quickBooks = status.systemBoundary.find((row) => row.system === "QuickBooks Desktop");
    expect(quickBooks?.role).toBe("downstream_output_only");
    expect(quickBooks?.isLedgerOfRecord).toBe(false);
    expect(quickBooks?.evidence.toLowerCase()).toContain("not the ledger");
  });

  test("foundation status represents migration 766 as QEP OS-owned finance logic", () => {
    const status = api.buildFinanceFoundationStatus([]);
    const tradeGate = status.capabilities.find((row) => row.migration === "766");
    expect(tradeGate).toMatchObject({
      ownerSystem: "qep_os",
      status: "shipped",
    });
    expect(tradeGate?.label).toContain("15% expected gross-margin");
    expect(tradeGate?.evidence).toContain("qep_trade_expected_margin_pct");
    expect(tradeGate?.evidence).toContain("qb_margin_thresholds 15% floor");
    expect(tradeGate?.evidence).toContain("trade_recondition_approval_audit");
  });

  test("foundation status exposes safe defaults as config-required nulls", () => {
    const status = api.buildFinanceFoundationStatus([
      {
        config_key: "invoice_pad_width",
        config_value: { digits: 6 },
        safe_default: { digits: 6 },
        authorizing_question: "Round 3 open item: invoice width",
        note: "Safe default is six digits.",
        is_active: true,
      },
      {
        config_key: "reconditioning_soft_cap_threshold",
        config_value: { threshold_cents: null },
        safe_default: { threshold_cents: null },
        authorizing_question: "Round 3 open item: trade-in reconditioning soft-cap",
        note: "No default dollar figure.",
        is_active: true,
      },
      {
        config_key: "trade_recondition_material_change_threshold",
        config_value: { percent_delta: 0.1, amount_delta: 2500, basis: "either" },
        safe_default: { amount_delta: 2500, basis: "either", percent_delta: 0.1 },
        authorizing_question: "Round 3 open item: material recon change threshold",
        note: "Safe default forces reapproval.",
        is_active: true,
      },
      {
        config_key: "trade_nonrepresented_discount_band",
        config_value: { min_discount_pct: 8, max_discount_pct: 10, default_discount_pct: 8 },
        safe_default: { default_discount_pct: 8, max_discount_pct: 10, min_discount_pct: 8 },
        authorizing_question: "Ryan 2026-07-03: non-represented trade valuation band",
        note: "Owner-reviewed Ryan policy.",
        is_active: true,
      },
      {
        config_key: "trade_valuation_guardrail",
        config_value: { max_trade_cost_pct_of_auction_value: 1, approval_required_above_guardrail: true },
        safe_default: { approval_required_above_guardrail: true, max_trade_cost_pct_of_auction_value: 1 },
        authorizing_question: "Ryan 2026-07-03: bring trades in at auction value or less",
        note: "Owner-reviewed Ryan guardrail.",
        is_active: true,
      },
    ]);

    const invoiceWidth = status.requiredConfig.find((row) => row.config_key === "invoice_pad_width");
    expect(invoiceWidth?.status).toBe("config_required");
    expect(invoiceWidth?.effective_value).toBeNull();
    expect(invoiceWidth?.parked_default).toEqual({ digits: 6 });

    const reconThreshold = status.requiredConfig.find((row) => row.config_key === "reconditioning_soft_cap_threshold");
    expect(reconThreshold?.status).toBe("config_required");
    expect(reconThreshold?.effective_value).toBeNull();

    const reconReapproval = status.requiredConfig.find((row) => row.config_key === "trade_recondition_material_change_threshold");
    expect(reconReapproval?.status).toBe("config_required");
    expect(reconReapproval?.effective_value).toBeNull();
    expect(reconReapproval?.parked_default).toEqual({ amount_delta: 2500, basis: "either", percent_delta: 0.1 });
    expect(reconReapproval?.note).toContain("Safe default forces reapproval.");

    const tradeDiscountBand = status.requiredConfig.find((row) => row.config_key === "trade_nonrepresented_discount_band");
    expect(tradeDiscountBand?.status).toBe("owner_reviewed");
    expect(tradeDiscountBand?.effective_value).toEqual({ min_discount_pct: 8, max_discount_pct: 10, default_discount_pct: 8 });

    const tradeGuardrail = status.requiredConfig.find((row) => row.config_key === "trade_valuation_guardrail");
    expect(tradeGuardrail?.status).toBe("config_required");
    expect(tradeGuardrail?.effective_value).toBeNull();
    expect(tradeGuardrail?.parked_default).toEqual({ max_trade_cost_pct_of_auction_value: 1, approval_required_above_guardrail: true });

    const bankAccounts = status.requiredConfig.find((row) => row.config_key === "bank_account_list");
    expect(bankAccounts?.status).toBe("config_required");
    expect(bankAccounts?.effective_value).toBeNull();
  });

  test("foundation status reads finance_foundation_config and preserves owner-reviewed values", async () => {
    nextResult = {
      data: [{
        config_key: "invoice_pad_width",
        config_value: { digits: 5 },
        safe_default: { digits: 6 },
        authorizing_question: "Round 3 open item: invoice width",
        note: "Owner-reviewed value.",
        is_active: true,
      }],
      error: null,
    };

    const status = await api.getFinanceFoundationStatus("default");
    const invoiceWidth = status.requiredConfig.find((row) => row.config_key === "invoice_pad_width");
    expect(invoiceWidth?.status).toBe("owner_reviewed");
    expect(invoiceWidth?.effective_value).toEqual({ digits: 5 });
    expect(status.configSummary.ownerReviewed).toBe(1);
    expect(calls).toContainEqual({ method: "from", args: ["finance_foundation_config"] });
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
