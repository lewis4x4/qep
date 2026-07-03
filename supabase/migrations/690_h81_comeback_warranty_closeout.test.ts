import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "690_h81_comeback_warranty_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("690_h81_comeback_warranty_closeout.sql contract", () => {
  it("marks H8.1 shipped without leaving a blocker", () => {
    expect(compactSql).toContain("where task_id = 'h8.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
  });

  it("records comeback, warranty, invoice, and UI evidence", () => {
    expect(compactSql).toContain("639_service_h8_comeback_warranty.sql");
    expect(compactSql).toContain("service-job-router/index.ts");
    expect(compactSql).toContain("service-h8-comeback-warranty.ts");
    expect(compactSql).toContain("service-invoice.ts");
    expect(compactSql).toContain("serviceworkordergatepanels.tsx");
    expect(compactSql).toContain("v_service_comeback_technician_rates");
    expect(compactSql).toContain("v_service_warranty_claim_lifecycle");
  });

  it("writes mission-aligned sync event evidence", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("qep-fault comeback");
    expect(compactSql).toContain("warranty claims");
  });
});
