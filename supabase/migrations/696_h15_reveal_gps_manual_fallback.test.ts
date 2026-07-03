import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(process.cwd(), "supabase", "migrations", "696_h15_reveal_gps_manual_fallback.sql");
const quoteEnginePath = join(process.cwd(), "supabase", "functions", "service-quote-engine", "index.ts");
const haulRouterPath = join(process.cwd(), "supabase", "functions", "service-haul-router", "index.ts");
const telematicsAdapterPath = join(process.cwd(), "supabase", "functions", "_shared", "telematics-adapter.ts");
const genericAdapterPath = join(process.cwd(), "supabase", "functions", "_shared", "adapters", "generic-telematics.ts");
const telematicsIngestPath = join(process.cwd(), "supabase", "functions", "telematics-ingest", "index.ts");

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();
const quoteEngine = readFileSync(quoteEnginePath, "utf8");
const haulRouter = readFileSync(haulRouterPath, "utf8");
const telematicsAdapter = readFileSync(telematicsAdapterPath, "utf8");
const genericAdapter = readFileSync(genericAdapterPath, "utf8");
const telematicsIngest = readFileSync(telematicsIngestPath, "utf8");

describe("696_h15_reveal_gps_manual_fallback.sql contract", () => {
  it("adds provider-neutral mileage source columns", () => {
    expect(compactSql).toContain("last_odometer_miles");
    expect(compactSql).toContain("field_mileage_miles");
    expect(compactSql).toContain("field_mileage_source");
    expect(compactSql).toContain("field_mileage_provider_trip_id");
    expect(compactSql).toContain("mileage_source");
    expect(compactSql).toContain("mileage_provider_trip_id");
    expect(compactSql).toContain("verizon_reveal");
    expect(compactSql).toContain("generic_telematics");
  });

  it("marks H15.1 shipped without a blocker and records mission evidence", () => {
    expect(compactSql).toContain("where task_id = 'h15.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("manual fallback");
  });

  it("locks provider-neutral odometer mileage ingestion", () => {
    expect(telematicsAdapter).toContain("odometerMiles");
    expect(genericAdapter).toContain('"odometer_miles"');
    expect(genericAdapter).toContain('"vehicle_mileage"');
    expect(telematicsIngest).toContain("last_odometer_miles");
  });

  it("locks manual fallback pricing for field and haul mileage", () => {
    expect(quoteEngine).toContain("field_mileage_miles");
    expect(quoteEngine).toContain('line_type: "optional"');
    expect(quoteEngine).toContain('h15_gate: "reveal_gps_manual_fallback"');
    expect(quoteEngine).toContain("Field Mileage");
    expect(haulRouter).toContain("mileage_source");
    expect(haulRouter).toContain("mileage_provider_trip_id");
    expect(haulRouter).toContain("normalizeServiceMileageSource");
  });
});
