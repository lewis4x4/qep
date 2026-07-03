import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "683_h11_service_rate_margin_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("683_h11_service_rate_margin_closeout.sql contract", () => {
  it("marks H1.1 shipped without introducing operational schema", () => {
    expect(compactSql).toContain("where task_id = 'h1.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("create table");
    expect(compactSql).not.toContain("alter table");
  });

  it("links the closeout to rate-card and quote-engine evidence", () => {
    expect(compactSql).toContain("632_service_rate_margin_engine.sql");
    expect(compactSql).toContain("supabase/functions/service-quote-engine/index.ts");
    expect(compactSql).toContain("equipment-class door-rate cards");
    expect(compactSql).toContain("large construction");
    expect(compactSql).toContain("grapple");
    expect(compactSql).toContain("field service");
    expect(compactSql).toContain("35% hard floor");
    expect(compactSql).toContain("55% target");
  });

  it("writes mission-aligned roadmap sync evidence", () => {
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("h11_service_rate_margin_closeout");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("service gross margin");
    expect(compactSql).toContain("work is authorized");
  });
});
