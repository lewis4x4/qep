import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/821_rental_worldclass_wave3.sql"),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("821 rental world-class wave 3", () => {
  it("seeds default commission on rent for the originator", () => {
    expect(compact).toContain("rental_ensure_default_commission");
    expect(compact).toContain("split_pct");
    expect(compact).toContain("trg_rental_seed_commission_on_rent");
    expect(compact).toContain("originated_by");
  });

  it("emits availability.low and cycle.due from the lifecycle scanner", () => {
    expect(compact).toContain("rental.availability.low");
    expect(compact).toContain("rental.cycle.due");
    expect(compact).toContain("headroom");
  });

  it("upserts jobsite geofences from lat/lng/radius", () => {
    expect(compact).toContain("rental_upsert_jobsite_geofence");
    expect(compact).toContain("customer_jobsite");
    expect(compact).toContain("st_buffer");
  });
});
