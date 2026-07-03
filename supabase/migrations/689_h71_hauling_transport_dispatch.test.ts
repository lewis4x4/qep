import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "689_h71_hauling_transport_dispatch.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("689_h71_hauling_transport_dispatch.sql contract", () => {
  it("adds configurable truck-class and mileage-band haul rates", () => {
    expect(compactSql).toContain("create table if not exists public.service_haul_rate_sheets");
    expect(compactSql).toContain("truck_class");
    expect(compactSql).toContain("mileage_band_min");
    expect(compactSql).toContain("mileage_band_max");
    expect(compactSql).toContain("per_mile_rate_cents");
    expect(compactSql).toContain("per_haul_minimum_cents");
    expect(compactSql).toContain("service_calculate_haul_charge");
  });

  it("extends traffic tickets into service haul dispatch records", () => {
    expect(compactSql).toContain("alter table public.traffic_tickets");
    expect(compactSql).toContain("mileage_one_way");
    expect(compactSql).toContain("round_trip_miles");
    expect(compactSql).toContain("haul_total_cents");
    expect(compactSql).toContain("scheduled_start_at");
    expect(compactSql).toContain("service_advisor_id");
    expect(compactSql).toContain("v_service_haul_dispatch_board");
  });

  it("marks H7.1 shipped with quote and dispatch evidence", () => {
    expect(compactSql).toContain("where task_id = 'h7.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("supabase/functions/service-haul-router/index.ts");
    expect(compactSql).toContain("supabase/functions/service-quote-engine/index.ts");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("round-trip mileage");
  });
});
