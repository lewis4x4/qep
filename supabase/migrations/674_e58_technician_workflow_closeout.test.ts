import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "674_e58_technician_workflow_closeout.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("674_e58_technician_workflow_closeout.sql contract", () => {
  it("marks E5.8 shipped without introducing operational schema", () => {
    expect(compactSql).toContain("where task_id = 'e5.8'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
    expect(compactSql).not.toContain("create table");
    expect(compactSql).not.toContain("alter table");
  });

  it("links the closeout to H5 technician execution evidence", () => {
    expect(compactSql).toContain(
      "637_service_h5_technician_execution_documentation.sql",
    );
    expect(compactSql).toContain("diagnostic and repair sign-off");
    expect(compactSql).toContain("labor-story fields");
    expect(compactSql).toContain("quoted-time overrun tracking");
    expect(compactSql).toContain("before/during/after photo metadata");
    expect(compactSql).toContain("warranty-parts label/turn-in");
    expect(compactSql).toContain("service advisor documentation-review close gate");
  });

  it("writes mission-aligned roadmap sync evidence", () => {
    expect(compactSql).toContain("insert into public.qep_roadmap_sync_events");
    expect(compactSql).toContain("e58_technician_workflow_closeout");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("equipment repair quality");
    expect(compactSql).toContain("customer-visible labor stories");
  });
});
