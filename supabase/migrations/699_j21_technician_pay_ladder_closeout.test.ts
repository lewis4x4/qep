import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "699_j21_technician_pay_ladder_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("699_j21_technician_pay_ladder_closeout.sql contract", () => {
  it("marks only J2.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'j2.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'j1.1'");
    expect(compactSql).not.toContain("where task_id = 'k1.1'");
  });

  it("records the Road, Shop, Grapple ladder and certification evidence", () => {
    expect(compactSql).toContain("642_workforce_technician_cert_pay_ladder.sql");
    expect(compactSql).toContain("public.technician_pay_ladder_tiers");
    expect(compactSql).toContain("public.technician_pay_ladder_assignment");
    expect(compactSql).toContain("public.technician_oem_certifications");
    expect(compactSql).toContain("public.technician_in_house_certifications");
    expect(compactSql).toContain("public.v_technician_pay_ladder_progression");
    expect(compactSql).toContain("shop master 95% efficiency gate");
    expect(compactSql).toContain("road master 90% gate");
  });

  it("writes mission-aligned sync evidence and keeps live credentials manual", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("certification readiness");
    expect(compactSql).toContain("workforcetechnicianpayladderpage.tsx");
    expect(compactSql).toContain("manual_boundaries");
    expect(compactSql).toContain("live oem portal credentials");
    expect(compactSql).toContain("passwords or api secrets");
  });
});
