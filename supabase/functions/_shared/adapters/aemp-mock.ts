/**
 * AEMP 2.0 Telematics Mock Adapter — fleet telemetry synthetic data.
 */

import type {
  IntegrationAdapter,
  AdapterConfig,
  AdapterResult,
  AempRequest,
  AempResult,
  AempUnit,
} from "../integration-types.ts";

const MOCK_FLEET: AempUnit[] = [
  {
    serial_number: "BK595B-SN-2020-001",
    make: "Barko", model: "595B", year: 2020,
    cumulative_operating_hours: 4512,
    last_reported_at: new Date(Date.now() - 3_600_000).toISOString(),
    location: { lat: 30.3322, lon: -81.6556 },
  },
  {
    serial_number: "BK495ML-SN-2018-001",
    make: "Barko", model: "495ML", year: 2018,
    cumulative_operating_hours: 11248,
    last_reported_at: new Date(Date.now() - 7_200_000).toISOString(),
    location: { lat: 32.0835, lon: -81.0998 },
  },
  {
    serial_number: "ASV-RT75-SN-2023-001",
    make: "ASV", model: "RT-75", year: 2023,
    cumulative_operating_hours: 893,
    last_reported_at: new Date(Date.now() - 1_800_000).toISOString(),
    location: { lat: 33.7490, lon: -84.3880 },
  },
  {
    serial_number: "BAN-BC15-SN-2021-001",
    make: "Bandit", model: "BC15", year: 2021,
    cumulative_operating_hours: 1812,
    last_reported_at: new Date(Date.now() - 14_400_000).toISOString(),
  },
  {
    serial_number: "YAN-SV100-SN-2024-001",
    make: "Yanmar", model: "SV100", year: 2024,
    cumulative_operating_hours: 318,
    last_reported_at: new Date(Date.now() - 900_000).toISOString(),
    location: { lat: 29.9511, lon: -90.0715 },
  },
  {
    serial_number: "BK695-SN-2017-001",
    make: "Barko", model: "695", year: 2017,
    cumulative_operating_hours: 14200,
    last_reported_at: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    serial_number: "BK895-SN-2019-001",
    make: "Barko", model: "895", year: 2019,
    cumulative_operating_hours: 6821,
    last_reported_at: new Date(Date.now() - 21_600_000).toISOString(),
    location: { lat: 31.5685, lon: -84.2219 },
  },
];

export class AempMockAdapter implements IntegrationAdapter<AempRequest, AempResult> {
  readonly integrationKey = "aemp" as const;
  readonly isMock = true;

  async execute(
    request: AempRequest,
    _config: AdapterConfig
  ): Promise<AdapterResult<AempResult>> {
    await _simulateLatency(150, 300);

    const page = request.page ?? 1;
    const pageSize = 25;
    const start = (page - 1) * pageSize;
    const units = MOCK_FLEET.slice(start, start + pageSize);

    if (request.operation === "unit_detail" && request.unitSerial) {
      const unit = MOCK_FLEET.find((u) => u.serial_number === request.unitSerial);
      return {
        data: { units: unit ? [unit] : [], total_count: unit ? 1 : 0, page: 1 },
        badge: "DEMO",
        isMock: true,
        latencyMs: 200,
        source: "aemp-mock",
      };
    }

    return {
      data: { units, total_count: MOCK_FLEET.length, page },
      badge: "DEMO",
      isMock: true,
      latencyMs: 220,
      source: "aemp-mock",
    };
  }

  async testConnection(
    _config: AdapterConfig
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    await _simulateLatency(80, 150);
    return { success: true, latencyMs: 115 };
  }
}

function _simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, delay));
}
