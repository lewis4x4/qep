/**
 * Rouse Analytics Mock Adapter — rental rate and utilization benchmarks.
 */

import type {
  IntegrationAdapter,
  AdapterConfig,
  AdapterResult,
  RouseRequest,
  RouseResult,
} from "../integration-types.ts";

const RENTAL_BENCHMARKS: Record<string, Omit<RouseResult, "category" | "region" | "as_of">> = {
  forestry: {
    daily_rate: 1850,
    weekly_rate: 6200,
    monthly_rate: 18500,
    utilization_pct: 0.68,
  },
  land_clearing: {
    daily_rate: 1250,
    weekly_rate: 4100,
    monthly_rate: 12200,
    utilization_pct: 0.72,
  },
  compact_track_loader: {
    daily_rate: 425,
    weekly_rate: 1450,
    monthly_rate: 4200,
    utilization_pct: 0.71,
  },
  compact_construction: {
    daily_rate: 550,
    weekly_rate: 1800,
    monthly_rate: 5400,
    utilization_pct: 0.65,
  },
  logging: {
    daily_rate: 2400,
    weekly_rate: 8000,
    monthly_rate: 24000,
    utilization_pct: 0.62,
  },
};

export class RouseMockAdapter implements IntegrationAdapter<RouseRequest, RouseResult> {
  readonly integrationKey = "rouse" as const;
  readonly isMock = true;

  async execute(
    request: RouseRequest,
    _config: AdapterConfig
  ): Promise<AdapterResult<RouseResult>> {
    await _simulateLatency(90, 200);

    const benchmark = RENTAL_BENCHMARKS[request.category] ??
      RENTAL_BENCHMARKS["compact_construction"];

    const data: RouseResult = {
      category: request.category,
      region: request.region,
      ...benchmark,
      as_of: new Date().toISOString().slice(0, 10),
    };

    return {
      data,
      badge: "DEMO",
      isMock: true,
      latencyMs: 145,
      source: "rouse-mock",
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
