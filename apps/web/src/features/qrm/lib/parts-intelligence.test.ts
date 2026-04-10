import { describe, expect, it } from "bun:test";
import { buildPartsIntelligenceBoard } from "./parts-intelligence";

describe("buildPartsIntelligenceBoard", () => {
  it("merges top customers with predictive kits and demand risk", () => {
    const board = buildPartsIntelligenceBoard({
      topCustomers: [
        { company_id: "c-1", company_name: "Acme Paving", revenue: 120000, order_count: 18 },
        { company_id: "c-2", company_name: "River Dirt", revenue: 90000, order_count: 12 },
      ],
      kits: [
        { id: "kit-1", crm_company_id: "c-1", company_name: "Acme Paving", confidence: 0.91, kit_value: 2200, stock_status: "all_in_stock", predicted_failure_type: "hydraulic" },
        { id: "kit-2", crm_company_id: "c-1", company_name: "Acme Paving", confidence: 0.84, kit_value: 1800, stock_status: "partial", predicted_failure_type: "pm_interval" },
        { id: "kit-3", crm_company_id: "c-2", company_name: "River Dirt", confidence: 0.78, kit_value: 900, stock_status: "none", predicted_failure_type: null },
      ],
      forecastRows: [
        { part_number: "FLT-100", branch_id: "memphis", stockout_risk: "critical", coverage_status: "action_required", predicted_qty: 12 },
        { part_number: "BELT-9", branch_id: "nashville", stockout_risk: "high", coverage_status: "watch", predicted_qty: 5 },
      ],
      inventoryRisks: [
        { part_number: "FLT-100", branch_id: "memphis", stock_status: "stockout", qty_on_hand: 0 },
      ],
    });

    expect(board.summary.topAccounts).toBe(2);
    expect(board.summary.predictiveKits).toBe(3);
    expect(board.summary.criticalForecasts).toBe(1);
    expect(board.summary.inventoryRisks).toBe(1);
    expect(board.accountSignals[0]?.companyId).toBe("c-1");
    expect(board.accountSignals[0]?.predictiveKitCount).toBe(2);
    expect(board.accountSignals[0]?.readyKitCount).toBe(1);
    expect(board.accountSignals[0]?.totalKitValue).toBe(4000);
    expect(board.demandSignals[0]?.partNumber).toBe("FLT-100");
  });
});
