import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "692_i31_accessory_installs_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("692_i31_accessory_installs_closeout.sql contract", () => {
  it("marks only I3.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'i3.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("where task_id = 'i2.1'");
    expect(compactSql).not.toContain("where task_id = 'i4.1'");
  });

  it("records tank, cooler, and extension accessory install evidence", () => {
    expect(compactSql).toContain("644_grapple_build_child_entities.sql");
    expect(compactSql).toContain("public.grapple_build_accessory_installs");
    expect(compactSql).toContain("public.ensure_grapple_build_accessory_install_steps");
    expect(compactSql).toContain("public.v_grapple_build_accessory_installs");
    expect(compactSql).toContain("ensuregrappleaccessoryinstallsteps");
    expect(compactSql).toContain("completegrappleaccessoryinstall");
    expect(compactSql).toContain("tank/cooler/extension");
  });

  it("writes mission-aligned sync event evidence and preserves production/service separation", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("without turning accessory work into a service work order");
  });
});
