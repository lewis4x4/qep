/**
 * IronGuides Mock Adapter — realistic regression-based equipment valuations.
 */

import type {
  IntegrationAdapter,
  AdapterConfig,
  AdapterResult,
  IronGuidesRequest,
  IronGuidesResult,
} from "../integration-types.ts";

// Depreciation baseline by make/category (% of list retained per year, per 1000hrs)
const DEPRECIATION: Record<string, { yearlyPct: number; hourlyPct: number; baseFmv: number }> = {
  "Barko 595B": { yearlyPct: 0.06, hourlyPct: 0.003, baseFmv: 280000 },
  "Barko 495ML": { yearlyPct: 0.065, hourlyPct: 0.004, baseFmv: 215000 },
  "Barko 695": { yearlyPct: 0.06, hourlyPct: 0.003, baseFmv: 260000 },
  "Barko 895": { yearlyPct: 0.055, hourlyPct: 0.003, baseFmv: 390000 },
  "ASV RT-75": { yearlyPct: 0.08, hourlyPct: 0.005, baseFmv: 95000 },
  "ASV VT-70": { yearlyPct: 0.08, hourlyPct: 0.005, baseFmv: 78000 },
  "Bandit BC15": { yearlyPct: 0.09, hourlyPct: 0.006, baseFmv: 45000 },
  "Bandit HC30": { yearlyPct: 0.085, hourlyPct: 0.005, baseFmv: 62000 },
  "Yanmar SV100": { yearlyPct: 0.07, hourlyPct: 0.004, baseFmv: 155000 },
};

function estimateFmv(make: string, model: string, year: number, hours: number): number {
  const key = `${make} ${model}`;
  const rates = DEPRECIATION[key] ?? { yearlyPct: 0.08, hourlyPct: 0.005, baseFmv: 100000 };
  const age = new Date().getFullYear() - year;
  const ageFactor = Math.max(0.25, 1 - rates.yearlyPct * age);
  const hoursFactor = Math.max(0.3, 1 - rates.hourlyPct * (hours / 1000));
  return Math.round(rates.baseFmv * ageFactor * hoursFactor);
}

export class IronGuidesMockAdapter
  implements IntegrationAdapter<IronGuidesRequest, IronGuidesResult>
{
  readonly integrationKey = "ironguides" as const;
  readonly isMock = true;

  async execute(
    request: IronGuidesRequest,
    _config: AdapterConfig
  ): Promise<AdapterResult<IronGuidesResult>> {
    await _simulateLatency(100, 250);

    const fmv = estimateFmv(request.make, request.model, request.year, request.hours);
    const variance = 0.08; // ±8%
    const low = Math.round(fmv * (1 - variance));
    const high = Math.round(fmv * (1 + variance));

    const data: IronGuidesResult = {
      valuation_id: `VAL-MOCK-${Date.now()}`,
      fair_market_value: fmv,
      low_estimate: low,
      high_estimate: high,
      confidence: 0.72,
      comparables: [
        { source: "auction_comp", price: Math.round(fmv * 0.97), location: "FL" },
        { source: "dealer_listing", price: Math.round(fmv * 1.05), location: "GA" },
        { source: "recent_sale", price: Math.round(fmv * 0.99), location: "AL" },
      ],
      as_of: new Date().toISOString(),
    };

    return {
      data,
      badge: "ESTIMATED",
      isMock: true,
      latencyMs: 175,
      source: "ironguides-mock",
    };
  }

  async testConnection(
    _config: AdapterConfig
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    await _simulateLatency(60, 120);
    return { success: true, latencyMs: 90 };
  }
}

function _simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, delay));
}
