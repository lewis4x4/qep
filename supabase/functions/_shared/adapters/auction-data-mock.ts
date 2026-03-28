/**
 * Auction Data Mock Adapter — historical auction comps from Rouse/IronPlanet.
 */

import type {
  IntegrationAdapter,
  AdapterConfig,
  AdapterResult,
  AuctionDataRequest,
  AuctionDataResult,
  AuctionResult,
} from "../integration-types.ts";

const MOCK_AUCTION_RECORDS: AuctionResult[] = [
  { source: "ritchie_bros", auction_date: "2026-02-12", make: "Barko", model: "595B", year: 2019, hours: 6100, hammer_price: 192000, location: "Ocala, FL", condition: "good" },
  { source: "ironplanet", auction_date: "2026-01-28", make: "Barko", model: "595B", year: 2018, hours: 8400, hammer_price: 168000, location: "Gainesville, FL", condition: "fair" },
  { source: "ritchie_bros", auction_date: "2025-11-15", make: "Barko", model: "595B", year: 2020, hours: 4200, hammer_price: 205000, location: "Tifton, GA", condition: "good" },
  { source: "purplewave", auction_date: "2025-10-08", make: "Barko", model: "595B", year: 2017, hours: 10800, hammer_price: 142000, location: "Lake City, FL", condition: "fair" },
  { source: "ironplanet", auction_date: "2026-02-20", make: "ASV", model: "RT-75", year: 2022, hours: 1900, hammer_price: 68000, location: "Atlanta, GA", condition: "good" },
  { source: "ritchie_bros", auction_date: "2026-01-10", make: "ASV", model: "RT-75", year: 2021, hours: 2800, hammer_price: 62000, location: "Charlotte, NC", condition: "good" },
  { source: "purplewave", auction_date: "2025-12-05", make: "Barko", model: "495ML", year: 2017, hours: 9200, hammer_price: 128000, location: "Tallahassee, FL", condition: "fair" },
  { source: "ironplanet", auction_date: "2025-11-20", make: "Barko", model: "495ML", year: 2018, hours: 7800, hammer_price: 141000, location: "Valdosta, GA", condition: "good" },
  { source: "ritchie_bros", auction_date: "2026-03-01", make: "Bandit", model: "BC15", year: 2020, hours: 2400, hammer_price: 26500, location: "Mobile, AL", condition: "good" },
  { source: "ironplanet", auction_date: "2026-01-22", make: "Barko", model: "695", year: 2016, hours: 13800, hammer_price: 108000, location: "Jacksonville, FL", condition: "fair" },
  { source: "purplewave", auction_date: "2025-09-18", make: "Yanmar", model: "SV100", year: 2022, hours: 1100, hammer_price: 112000, location: "Tampa, FL", condition: "good" },
  { source: "ritchie_bros", auction_date: "2025-10-30", make: "Barko", model: "895", year: 2017, hours: 9800, hammer_price: 228000, location: "Albany, GA", condition: "good" },
];

export class AuctionDataMockAdapter
  implements IntegrationAdapter<AuctionDataRequest, AuctionDataResult>
{
  readonly integrationKey = "auction_data" as const;
  readonly isMock = true;

  async execute(
    request: AuctionDataRequest,
    _config: AdapterConfig
  ): Promise<AdapterResult<AuctionDataResult>> {
    await _simulateLatency(100, 220);

    let results = MOCK_AUCTION_RECORDS.filter(
      (r) =>
        r.make.toLowerCase() === request.make.toLowerCase() &&
        r.model.toLowerCase() === request.model.toLowerCase()
    );

    if (request.yearMin) results = results.filter((r) => r.year >= request.yearMin!);
    if (request.yearMax) results = results.filter((r) => r.year <= request.yearMax!);

    const limit = request.limit ?? 10;
    results = results.slice(0, limit);

    return {
      data: { results, total_count: results.length },
      badge: "DEMO",
      isMock: true,
      latencyMs: 160,
      source: "auction-data-mock",
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
