/**
 * IntelliDealer Mock Adapter — realistic synthetic inventory, customer, and deal data.
 * Used when IntelliDealer credentials are not configured (Sprint 1 default).
 */

import type {
  IntegrationAdapter,
  AdapterConfig,
  AdapterResult,
  IntelliDealerRequest,
  IntelliDealerResult,
  IntelliDealerMachine,
  IntelliDealerCustomer,
  IntelliDealerDeal,
} from "../integration-types.ts";

const MOCK_MACHINES: IntelliDealerMachine[] = [
  { stock_number: "BK595B-001", make: "Barko", model: "595B", year: 2020, hours: 4500, condition: "good", list_price: 225000, cost_basis: 195000, inventory_status: "available" },
  { stock_number: "BK495ML-001", make: "Barko", model: "495ML", year: 2018, hours: 8200, condition: "fair", list_price: 155000, cost_basis: 128000, inventory_status: "available" },
  { stock_number: "ASV-RT75-001", make: "ASV", model: "RT-75", year: 2023, hours: 890, condition: "excellent", list_price: 78000, cost_basis: 64000, inventory_status: "available" },
  { stock_number: "ASV-RT75-002", make: "ASV", model: "RT-75", year: 2022, hours: 2100, condition: "good", list_price: 72000, cost_basis: 59000, inventory_status: "available" },
  { stock_number: "BAN-BC15-001", make: "Bandit", model: "BC15", year: 2021, hours: 1800, condition: "good", list_price: 32000, cost_basis: 26500, inventory_status: "available" },
  { stock_number: "BAN-BC15-002", make: "Bandit", model: "BC15", year: 2019, hours: 3400, condition: "fair", list_price: 27000, cost_basis: 21000, inventory_status: "available" },
  { stock_number: "YAN-SV100-001", make: "Yanmar", model: "SV100", year: 2024, hours: 312, condition: "excellent", list_price: 125000, cost_basis: 104000, inventory_status: "available" },
  { stock_number: "BK695-001", make: "Barko", model: "695", year: 2017, hours: 11200, condition: "fair", list_price: 118000, cost_basis: 91000, inventory_status: "available" },
  { stock_number: "BK895-001", make: "Barko", model: "895", year: 2019, hours: 6800, condition: "good", list_price: 285000, cost_basis: 245000, inventory_status: "available" },
  { stock_number: "ASV-VT70-001", make: "ASV", model: "VT-70", year: 2023, hours: 425, condition: "excellent", list_price: 62000, cost_basis: 51000, inventory_status: "available" },
  { stock_number: "BAN-HC30-001", make: "Bandit", model: "HC30", year: 2022, hours: 980, condition: "excellent", list_price: 48000, cost_basis: 39000, inventory_status: "sold" },
  { stock_number: "BK595B-002", make: "Barko", model: "595B", year: 2021, hours: 2900, condition: "good", list_price: 235000, cost_basis: 200000, inventory_status: "available" },
];

const MOCK_CUSTOMERS: IntelliDealerCustomer[] = [
  { external_id: "CUST-001", name: "Southeast Timber LLC", segment: "logging" },
  { external_id: "CUST-002", name: "Acme Land Clearing Inc", segment: "land_clearing" },
  { external_id: "CUST-003", name: "Blue Ridge Forestry Co", segment: "forestry" },
  { external_id: "CUST-004", name: "Gulf Coast Excavation", segment: "compact_construction" },
  { external_id: "CUST-005", name: "PineTop Lumber Group", segment: "logging" },
  { external_id: "CUST-006", name: "Red River Land Services", segment: "land_clearing" },
  { external_id: "CUST-007", name: "Mountain States Forestry", segment: "forestry" },
  { external_id: "CUST-008", name: "Coastal Brush Control", segment: "land_clearing" },
];

const MOCK_DEALS: IntelliDealerDeal[] = [
  { external_id: "DEAL-001", status: "quote_sent", closed_at: null },
  { external_id: "DEAL-002", status: "won", closed_at: "2026-02-14T00:00:00Z" },
  { external_id: "DEAL-003", status: "lost", closed_at: "2026-01-30T00:00:00Z" },
  { external_id: "DEAL-004", status: "negotiating", closed_at: null },
  { external_id: "DEAL-005", status: "won", closed_at: "2026-03-01T00:00:00Z" },
];

export class IntelliDealerMockAdapter
  implements IntegrationAdapter<IntelliDealerRequest, IntelliDealerResult>
{
  readonly integrationKey = "intellidealer" as const;
  readonly isMock = true;

  async execute(
    request: IntelliDealerRequest,
    _config: AdapterConfig
  ): Promise<AdapterResult<IntelliDealerResult>> {
    await _simulateLatency(80, 180);

    let data: IntelliDealerResult;

    switch (request.operation) {
      case "inventory":
        data = { machines: MOCK_MACHINES.filter((m) => m.inventory_status === "available") };
        break;
      case "inventory_item":
        data = {
          machine: MOCK_MACHINES.find((m) => m.stock_number === request.stockNumber),
        };
        break;
      case "customers":
        data = { customers: MOCK_CUSTOMERS };
        break;
      case "deals":
        data = { deals: MOCK_DEALS };
        break;
      default:
        data = {};
    }

    return {
      data,
      badge: "DEMO",
      isMock: true,
      latencyMs: 130,
      source: "intellidealer-mock",
    };
  }

  async testConnection(
    _config: AdapterConfig
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    await _simulateLatency(50, 100);
    return { success: true, latencyMs: 75 };
  }
}

function _simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, delay));
}
