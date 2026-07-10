import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/820_rental_worldclass_wave2.sql"),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();

describe("820 rental world-class wave 2", () => {
  it("writes geofence_events from telematics GPS vs jobsite polygons", () => {
    expect(compact).toContain("create or replace function public.rental_evaluate_geofence_crossings");
    expect(compact).toContain("join public.telematics_feeds");
    expect(compact).toContain("customer_jobsite");
    expect(compact).toContain("insert into public.geofence_events");
    expect(compact).toContain("event_type = 'exited'");
    expect(compact).toContain("st_covers");
  });

  it("hooks geofence evaluation into intelligence scan and a 15-minute cron", () => {
    expect(compact).toContain("rental_intelligence_scan");
    expect(compact).toContain("rental-geofence-evaluate");
    expect(compact).toContain("*/15 * * * *");
  });

  it("ranks conversion board from rental and RPO truth", () => {
    expect(compact).toContain("create or replace function public.rental_conversion_board");
    expect(compact).toContain("rpo_credit_accrued_cents");
    expect(compact).toContain("trailing_90d_billed_cents");
    expect(compact).toContain("rank_score");
  });
});
