/**
 * Manufacturer Incentives Mock Adapter — active OEM incentive programs.
 */

import type {
  IntegrationAdapter,
  AdapterConfig,
  AdapterResult,
  IncentivesRequest,
  IncentivesResult,
  IncentiveProgram,
} from "../integration-types.ts";

const MOCK_PROGRAMS: IncentiveProgram[] = [
  {
    oem_name: "Barko",
    program_name: "Q1 2026 Spring Sales Push",
    discount_type: "percentage",
    discount_value: 3.5,
    eligible_categories: ["forestry", "logging"],
    eligible_models: [],
    stacking_rules: "stackable",
    start_date: "2026-01-01",
    end_date: "2026-03-31",
  },
  {
    oem_name: "Barko",
    program_name: "695 Clearance Allowance",
    discount_type: "fixed_amount",
    discount_value: 8500,
    eligible_categories: ["forestry"],
    eligible_models: ["695"],
    stacking_rules: "exclusive",
    start_date: "2026-02-01",
    end_date: "2026-04-30",
  },
  {
    oem_name: "ASV",
    program_name: "RT-75 Demo Unit Rebate",
    discount_type: "fixed_amount",
    discount_value: 3000,
    eligible_categories: ["compact_construction", "land_clearing"],
    eligible_models: ["RT-75"],
    stacking_rules: "stackable",
    start_date: "2026-01-15",
    end_date: "2026-06-30",
  },
  {
    oem_name: "ASV",
    program_name: "Fleet Discount Program",
    discount_type: "percentage",
    discount_value: 2.0,
    eligible_categories: ["compact_construction", "land_clearing", "compact_track_loader"],
    eligible_models: [],
    stacking_rules: "max_2",
    start_date: "2026-01-01",
    end_date: null,
  },
  {
    oem_name: "Bandit",
    program_name: "2026 BC Series Promotion",
    discount_type: "percentage",
    discount_value: 4.0,
    eligible_categories: ["land_clearing", "forestry"],
    eligible_models: ["BC15", "BC30"],
    stacking_rules: "exclusive",
    start_date: "2026-03-01",
    end_date: "2026-05-31",
  },
  {
    oem_name: "Yanmar",
    program_name: "SV Series New Model Launch",
    discount_type: "fixed_amount",
    discount_value: 5000,
    eligible_categories: ["compact_construction"],
    eligible_models: ["SV100", "SV114"],
    stacking_rules: "stackable",
    start_date: "2026-02-15",
    end_date: "2026-07-31",
  },
];

export class ManufacturerIncentivesMockAdapter
  implements IntegrationAdapter<IncentivesRequest, IncentivesResult>
{
  readonly integrationKey = "manufacturer_incentives" as const;
  readonly isMock = true;

  async execute(
    request: IncentivesRequest,
    _config: AdapterConfig
  ): Promise<AdapterResult<IncentivesResult>> {
    await _simulateLatency(60, 130);

    let programs = MOCK_PROGRAMS;

    if (request.oem) {
      programs = programs.filter((p) => p.oem_name.toLowerCase() === request.oem!.toLowerCase());
    }
    if (request.category) {
      programs = programs.filter(
        (p) => p.eligible_categories.includes(request.category!) || p.eligible_categories.length === 0
      );
    }
    if (request.model) {
      programs = programs.filter(
        (p) => p.eligible_models.includes(request.model!) || p.eligible_models.length === 0
      );
    }

    return {
      data: { programs, as_of: new Date().toISOString() },
      badge: "DEMO",
      isMock: true,
      latencyMs: 95,
      source: "manufacturer-incentives-mock",
    };
  }

  async testConnection(
    _config: AdapterConfig
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    await _simulateLatency(40, 80);
    return { success: true, latencyMs: 60 };
  }
}

function _simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, delay));
}
