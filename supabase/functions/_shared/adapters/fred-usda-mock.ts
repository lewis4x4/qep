/**
 * FRED / USDA Economic Data Mock Adapter — macro economic indicators.
 */

import type {
  IntegrationAdapter,
  AdapterConfig,
  AdapterResult,
  FredUsdaRequest,
  FredUsdaResult,
  EconomicObservation,
} from "../integration-types.ts";

// FRED series: realistic recent values for QEP-relevant indicators
const MOCK_SERIES: Record<string, { name: string; unit: string; value: number }> = {
  HOUST: { name: "Housing Starts", unit: "thousands_of_units", value: 1412 },
  TTLCONS: { name: "Total Construction Spending", unit: "millions_usd", value: 2124500 },
  PRRESCONS: { name: "Private Residential Construction Spending", unit: "millions_usd", value: 878200 },
  PNRESCONS: { name: "Private Nonresidential Construction Spending", unit: "millions_usd", value: 1048300 },
  WPUFD4131: { name: "Lumber & Wood Products PPI", unit: "index_1982_100", value: 287.4 },
  PCU321113321113: { name: "Sawmill & Wood Preservation PPI", unit: "index_1982_100", value: 312.8 },
  USSLIND: { name: "US Leading Indicators Index", unit: "index", value: 101.2 },
  DCOILWTICO: { name: "Crude Oil (WTI)", unit: "usd_per_barrel", value: 71.85 },
};

// USDA timber prices (static for mock)
const USDA_TIMBER: Record<string, { name: string; unit: string; value: number }> = {
  USDA_SOFTWOOD_SAWTIMBER: { name: "Softwood Sawtimber Price Index", unit: "usd_per_mbf", value: 385.0 },
  USDA_HARDWOOD_PULPWOOD: { name: "Hardwood Pulpwood Price Index", unit: "usd_per_cord", value: 42.5 },
};

export class FredUsdaMockAdapter
  implements IntegrationAdapter<FredUsdaRequest, FredUsdaResult>
{
  readonly integrationKey = "fred_usda" as const;
  readonly isMock = true;

  async execute(
    request: FredUsdaRequest,
    _config: AdapterConfig
  ): Promise<AdapterResult<FredUsdaResult>> {
    await _simulateLatency(80, 180);

    const combined = { ...MOCK_SERIES, ...USDA_TIMBER };
    const observationDate = new Date().toISOString().slice(0, 10);

    const observations: EconomicObservation[] = request.indicators
      .filter((id) => combined[id])
      .map((id) => {
        const series = combined[id];
        return {
          indicator_key: id.toLowerCase(),
          indicator_name: series.name,
          value: series.value,
          unit: series.unit,
          observation_date: observationDate,
          series_id: id,
        };
      });

    // Return all indicators if no specific indicators requested
    const result: EconomicObservation[] =
      observations.length > 0
        ? observations
        : Object.entries(combined).map(([id, series]) => ({
            indicator_key: id.toLowerCase(),
            indicator_name: series.name,
            value: series.value,
            unit: series.unit,
            observation_date: observationDate,
            series_id: id,
          }));

    return {
      data: { observations: result, as_of: new Date().toISOString() },
      badge: "DEMO",
      isMock: true,
      latencyMs: 130,
      source: "fred-usda-mock",
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
