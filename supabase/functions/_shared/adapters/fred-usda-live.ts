import { FredUsdaMockAdapter } from "./fred-usda-mock.ts";
import { resilientFetch } from "../resilient-fetch.ts";
import type {
  AdapterConfig,
  AdapterResult,
  EconomicObservation,
  FredUsdaRequest,
  FredUsdaResult,
  IntegrationAdapter,
} from "../integration-types.ts";

interface FredObservationResponse {
  observations?: Array<{ date?: string; value?: string }>;
}

const DEFAULT_INDICATORS = [
  "HOUST",
  "TTLCONS",
  "PRRESCONS",
  "PNRESCONS",
  "DCOILWTICO",
  "USDA_SOFTWOOD_SAWTIMBER",
];

const INDICATOR_META: Record<string, { name: string; unit: string }> = {
  HOUST: { name: "Housing Starts", unit: "thousands_of_units" },
  TTLCONS: { name: "Total Construction Spending", unit: "millions_usd" },
  PRRESCONS: {
    name: "Private Residential Construction Spending",
    unit: "millions_usd",
  },
  PNRESCONS: {
    name: "Private Nonresidential Construction Spending",
    unit: "millions_usd",
  },
  DCOILWTICO: { name: "Crude Oil (WTI)", unit: "usd_per_barrel" },
  USDA_SOFTWOOD_SAWTIMBER: {
    name: "Softwood Sawtimber Price Index",
    unit: "usd_per_mbf",
  },
  USDA_HARDWOOD_PULPWOOD: {
    name: "Hardwood Pulpwood Price Index",
    unit: "usd_per_cord",
  },
};

const USDA_FALLBACK_VALUES: Record<string, number> = {
  USDA_SOFTWOOD_SAWTIMBER: 385,
  USDA_HARDWOOD_PULPWOOD: 42.5,
};

function parseCredentialsRaw(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] =>
            typeof entry[1] === "string"
          ),
      );
    } catch {
      return {};
    }
  }

  return {
    fred_api_key: trimmed,
  };
}

function resolveFredApiKey(config: AdapterConfig): string | null {
  const credentials = config.credentials ?? {};
  const fromRaw = typeof credentials.raw === "string"
    ? parseCredentialsRaw(credentials.raw)
    : {};

  const candidates = [
    credentials.fred_api_key,
    credentials.api_key,
    credentials.key,
    fromRaw.fred_api_key,
    fromRaw.api_key,
    fromRaw.key,
    Deno.env.get("FRED_API_KEY") ?? undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function isUsdaIndicator(indicator: string): boolean {
  return indicator.startsWith("USDA_");
}

async function fetchLatestFredObservation(
  indicator: string,
  apiKey: string,
): Promise<EconomicObservation> {
  const params = new URLSearchParams({
    series_id: indicator,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: "5",
  });

  const url =
    `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
  const { response } = await resilientFetch(url, {
    integrationKey: "fred_usda",
    operationKey: `series_${indicator.toLowerCase()}`,
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const payload = (await response.json()) as FredObservationResponse;
  const latest = payload.observations?.find((obs) => {
    const value = obs.value;
    return typeof value === "string" && value !== ".";
  });

  if (!latest?.value || !latest.date) {
    throw new Error(`No observation found for indicator ${indicator}`);
  }

  const value = Number.parseFloat(latest.value);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid observation value for indicator ${indicator}`);
  }

  const meta = INDICATOR_META[indicator] ?? { name: indicator, unit: "value" };

  return {
    indicator_key: indicator.toLowerCase(),
    indicator_name: meta.name,
    value,
    unit: meta.unit,
    observation_date: latest.date,
    series_id: indicator,
  };
}

export class FredUsdaLiveAdapter
  implements IntegrationAdapter<FredUsdaRequest, FredUsdaResult> {
  readonly integrationKey = "fred_usda" as const;
  readonly isMock = false;

  private readonly mockAdapter = new FredUsdaMockAdapter();

  async execute(
    request: FredUsdaRequest,
    config: AdapterConfig,
  ): Promise<AdapterResult<FredUsdaResult>> {
    const startedAt = Date.now();
    const apiKey = resolveFredApiKey(config);

    if (!apiKey) {
      return this.mockAdapter.execute(request, config);
    }

    const indicators = request.indicators.length > 0
      ? request.indicators
      : DEFAULT_INDICATORS;

    const observations: EconomicObservation[] = [];
    let usedFallback = false;
    const failures: Array<{ indicator: string; error: string }> = [];

    await Promise.all(
      indicators.map(async (indicator) => {
        if (isUsdaIndicator(indicator)) {
          const fallbackValue = USDA_FALLBACK_VALUES[indicator];
          if (typeof fallbackValue === "number") {
            usedFallback = true;
            const meta = INDICATOR_META[indicator] ?? {
              name: indicator,
              unit: "value",
            };
            observations.push({
              indicator_key: indicator.toLowerCase(),
              indicator_name: meta.name,
              value: fallbackValue,
              unit: meta.unit,
              observation_date: new Date().toISOString().slice(0, 10),
              series_id: indicator,
            });
          }
          return;
        }

        try {
          const observation = await fetchLatestFredObservation(
            indicator,
            apiKey,
          );
          observations.push(observation);
        } catch (error) {
          failures.push({
            indicator,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    if (observations.length === 0) {
      const reasons = failures.map((failure) =>
        `${failure.indicator}:${failure.error}`
      );
      throw new Error(`FRED live fetch failed: ${reasons.join("; ")}`);
    }

    const badge = usedFallback || failures.length > 0
      ? "LIMITED_MARKET_DATA"
      : "LIVE";

    return {
      data: {
        observations,
        as_of: new Date().toISOString(),
      },
      badge,
      isMock: false,
      latencyMs: Date.now() - startedAt,
      source: failures.length > 0 ? "fred-live-partial" : "fred-live",
    };
  }

  async testConnection(
    config: AdapterConfig,
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const startedAt = Date.now();
    const apiKey = resolveFredApiKey(config);

    if (!apiKey) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        error: "Missing FRED API key",
      };
    }

    try {
      await fetchLatestFredObservation("HOUST", apiKey);
      return {
        success: true,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
