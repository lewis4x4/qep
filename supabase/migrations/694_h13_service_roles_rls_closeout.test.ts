import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "694_h13_service_roles_rls_closeout.sql",
);
const enumMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "630_service_roles_user_role_enum.sql",
);
const rlsMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "631_service_roles_rls_foundation.sql",
);
const serviceAuthPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "_shared",
  "service-auth.ts",
);
const serviceJobRouterPath = join(
  process.cwd(),
  "supabase",
  "functions",
  "service-job-router",
  "index.ts",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();
const enumSql = readFileSync(enumMigrationPath, "utf8").toLowerCase();
const rlsSql = readFileSync(rlsMigrationPath, "utf8").replace(/\s+/g, " ").toLowerCase();
const serviceAuthSource = readFileSync(serviceAuthPath, "utf8");
const serviceJobRouterSource = readFileSync(serviceJobRouterPath, "utf8");

describe("694_h13_service_roles_rls_closeout.sql contract", () => {
  it("marks H13.1 shipped without a blocker", () => {
    expect(compactSql).toContain("where task_id = 'h13.1'");
    expect(compactSql).toContain("set ship_state = 'shipped'");
    expect(compactSql).toContain("blocking_decision = null");
  });

  it("locks the five service-department enum values", () => {
    for (const role of [
      "service_writer",
      "technician",
      "parts_counter",
      "dispatch",
      "finance_admin",
    ]) {
      expect(enumSql).toContain(`add value if not exists '${role}'`);
      expect(compactSql).toContain(role);
    }
  });

  it("records technician-owned-job RLS policy evidence", () => {
    expect(rlsSql).toContain('create policy "svc_jobs_select" on public.service_jobs for select');
    expect(rlsSql).toContain("coalesce((select public.get_my_role())::text, '') = 'technician'");
    expect(rlsSql).toContain("and technician_id = (select auth.uid())");
    expect(rlsSql).toContain('create policy "service_job_segments_technician_select"');
    expect(rlsSql).toContain("j.technician_id = (select auth.uid())");
    expect(compactSql).toContain("svc_jobs_select technician_id = auth.uid() policy");
  });

  it("records API role gates that match the RLS roles", () => {
    expect(serviceAuthSource).toContain("SERVICE_DEPARTMENT_ROLES");
    expect(serviceAuthSource).toContain('"service_writer"');
    expect(serviceAuthSource).toContain('"technician"');
    expect(serviceAuthSource).toContain('"parts_counter"');
    expect(serviceAuthSource).toContain('"dispatch"');
    expect(serviceAuthSource).toContain('"finance_admin"');
    expect(serviceJobRouterSource).toContain("canRunServiceJobAction");
    expect(serviceJobRouterSource).toContain('role === "technician"');
    expect(serviceJobRouterSource).toContain('role === "parts_counter"');
    expect(serviceJobRouterSource).toContain('role === "finance_admin"');
  });

  it("writes mission-aligned sync event evidence", () => {
    expect(compactSql).toContain("qep_roadmap_sync_events");
    expect(compactSql).toContain("mission_alignment");
    expect(compactSql).toContain("least-privilege roles");
    expect(compactSql).toContain("technician records stay constrained to assigned jobs");
  });
});
