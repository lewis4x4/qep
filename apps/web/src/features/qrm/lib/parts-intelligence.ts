export interface PartsIntelTopCustomer {
  company_id: string;
  company_name: string;
  revenue: number;
  order_count: number;
}

export interface PartsIntelKit {
  id: string;
  crm_company_id: string | null;
  company_name?: string;
  confidence: number;
  kit_value: number;
  stock_status: string;
  predicted_failure_type: string | null;
}

export interface PartsIntelForecastRow {
  part_number: string;
  branch_id: string;
  stockout_risk: string;
  coverage_status: "action_required" | "watch" | "covered" | "no_inventory";
  predicted_qty: number;
}

export interface PartsIntelInventoryRisk {
  part_number: string;
  branch_id: string;
  stock_status: "stockout" | "critical" | "reorder" | "healthy" | "no_profile";
  qty_on_hand: number;
}

export interface PartsIntelligenceAccountSignal {
  companyId: string;
  companyName: string;
  annualRevenue: number;
  orderCount: number;
  predictiveKitCount: number;
  readyKitCount: number;
  totalKitValue: number;
}

export interface PartsIntelligenceDemandSignal {
  partNumber: string;
  branchId: string;
  demandRisk: string;
  coverageStatus: string;
  predictedQty: number;
}

export interface PartsIntelligenceSummary {
  topAccounts: number;
  predictiveKits: number;
  criticalForecasts: number;
  inventoryRisks: number;
}

export interface PartsIntelligenceBoard {
  summary: PartsIntelligenceSummary;
  accountSignals: PartsIntelligenceAccountSignal[];
  demandSignals: PartsIntelligenceDemandSignal[];
}

export function buildPartsIntelligenceBoard(input: {
  topCustomers: PartsIntelTopCustomer[];
  kits: PartsIntelKit[];
  forecastRows: PartsIntelForecastRow[];
  inventoryRisks: PartsIntelInventoryRisk[];
}): PartsIntelligenceBoard {
  const kitGroups = new Map<string, PartsIntelKit[]>();
  for (const kit of input.kits) {
    if (!kit.crm_company_id) continue;
    const list = kitGroups.get(kit.crm_company_id) ?? [];
    list.push(kit);
    kitGroups.set(kit.crm_company_id, list);
  }

  const accountSignals = input.topCustomers.map((customer) => {
    const kits = kitGroups.get(customer.company_id) ?? [];
    return {
      companyId: customer.company_id,
      companyName: customer.company_name,
      annualRevenue: customer.revenue,
      orderCount: customer.order_count,
      predictiveKitCount: kits.length,
      readyKitCount: kits.filter((kit) => kit.stock_status === "all_in_stock").length,
      totalKitValue: kits.reduce((sum, kit) => sum + kit.kit_value, 0),
    };
  }).sort((a, b) => {
    if (b.predictiveKitCount !== a.predictiveKitCount) return b.predictiveKitCount - a.predictiveKitCount;
    return b.annualRevenue - a.annualRevenue;
  });

  const demandSignals = input.forecastRows
    .map((row) => ({
      partNumber: row.part_number,
      branchId: row.branch_id,
      demandRisk: row.stockout_risk,
      coverageStatus: row.coverage_status,
      predictedQty: row.predicted_qty,
    }))
    .sort((a, b) => {
      const weight: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
      if ((weight[b.demandRisk] ?? 0) !== (weight[a.demandRisk] ?? 0)) {
        return (weight[b.demandRisk] ?? 0) - (weight[a.demandRisk] ?? 0);
      }
      return b.predictedQty - a.predictedQty;
    });

  return {
    summary: {
      topAccounts: accountSignals.length,
      predictiveKits: input.kits.length,
      criticalForecasts: input.forecastRows.filter((row) => row.stockout_risk === "critical").length,
      inventoryRisks: input.inventoryRisks.length,
    },
    accountSignals,
    demandSignals,
  };
}
