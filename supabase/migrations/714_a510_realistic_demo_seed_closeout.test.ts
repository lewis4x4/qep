import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readMigration = (name: string) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

const closeoutSql = readMigration("714_a510_realistic_demo_seed_closeout.sql");
const seedSql = readMigration("603_seed_realistic_data.sql");
const companySchemaSql = readMigration("472_qrm_company_wave2_columns.sql");
const crmSprint2Sql = readMigration("026_crm_sprint2_contact_company_management.sql");
const equipmentMoonshotSql = readMigration("047_crm_equipment_moonshot.sql");
const seedIds = readFileSync(join(process.cwd(), "scripts", "demo", "seed-ids.mjs"), "utf8");
const verifySeed = readFileSync(join(process.cwd(), "scripts", "demo", "verify-seed.mjs"), "utf8");

const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const compactCloseout = compact(closeoutSql);
const compactSeed = compact(seedSql);

describe("714_a510_realistic_demo_seed_closeout.sql contract", () => {
  it("marks only A5.10 shipped without a blocker", () => {
    expect(compactCloseout).toContain("where task_id = 'a5.10'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).not.toContain("where task_id = 'a5.9'");
    expect(compactCloseout).not.toContain("where task_id = 'a6.1'");
  });

  it("records the QB-14 seed evidence and manual boundaries", () => {
    expect(compactCloseout).toContain("603_seed_realistic_data.sql");
    expect(compactCloseout).toContain("scripts/demo/verify-seed.mjs");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("deterministic demo world");
    expect(compactCloseout).toContain("liveimport=false");
    expect(compactCloseout).toContain("externaldependency=null");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("anchors deterministic row bands, counts, and provenance metadata", () => {
    for (const range of ["generate_series(1, 60)", "generate_series(1, 200)", "generate_series(1, 100)", "generate_series(1, 20)", "generate_series(1, 80)"]) {
      expect(seedSql).toContain(range);
    }

    for (const uuidBand of ["b014c000", "b014c001", "b014e000", "b014d000", "b014a000"]) {
      expect(seedSql).toContain(uuidBand);
    }

    expect(compactSeed).toContain("'seedbatchid', 'qb14-realistic-demo-2026-05-20'");
    expect(compactSeed).toContain("'seedsource', 'qb14_demo_seed'");
    expect(compactSeed).toContain("'liveimport', false");
    expect(compactSeed).toContain("'provenance', 'deterministic_demo_seed'");
    expect(compactSeed).toContain("'externaldependency', null");
    expect(compactSeed).toContain("'seedordinal'");
  });

  it("keeps the seed rerunnable without overwriting non-seed rows", () => {
    for (const table of ["qrm_companies", "qrm_contacts", "qrm_equipment", "qrm_deals", "qrm_activities"]) {
      expect(compactSeed).toContain(`where public.${table}.metadata->>'seedbatchid' = 'qb14-realistic-demo-2026-05-20'`);
    }

    expect(compactSeed).toContain("on conflict (id) do update set");
    expect(compactSeed).toContain("on conflict (workspace_id, contact_id, company_id) do update set");
    expect(compactSeed).toContain("on conflict (workspace_id, name) do nothing");
  });

  it("documents natural-key guards used by the demo seed", () => {
    expect(compact(companySchemaSql)).toContain("create unique index if not exists idx_qrm_companies_legacy_customer_number");
    expect(compact(companySchemaSql)).toContain("on public.qrm_companies (workspace_id, legacy_customer_number)");
    expect(compact(crmSprint2Sql)).toContain("create unique index if not exists uq_crm_equipment_workspace_asset_tag");
    expect(compact(crmSprint2Sql)).toContain("on public.crm_equipment(workspace_id, lower(asset_tag))");
    expect(compact(equipmentMoonshotSql)).toContain("create unique index if not exists uq_crm_equipment_workspace_vin_pin");
    expect(compact(equipmentMoonshotSql)).toContain("on public.crm_equipment(workspace_id, lower(vin_pin))");
  });

  it("keeps the verification harness aligned to the QB-14 dataset", () => {
    expect(seedIds).toContain('QB14_REALISTIC_DEMO_BATCH_ID = "qb14-realistic-demo-2026-05-20"');
    expect(seedIds).toContain("QB14_REALISTIC_EXPECTED_COUNTS");
    expect(seedIds).toContain("companies: 60");
    expect(seedIds).toContain("contacts: 200");
    expect(seedIds).toContain("equipment: 100");
    expect(seedIds).toContain("activeDeals: 20");
    expect(seedIds).toContain("activities: 80");

    for (const check of [
      "QB-14 qrm_companies rows (60)",
      "QB-14 crm_companies compat rows (60)",
      "QB-14 contact primary companies exist",
      "QB-14 customer picker RPC finds",
      "QB-14 Quote Builder signals",
      "QB-14 authenticated app/RLS verification config",
    ]) {
      expect(verifySeed).toContain(check);
    }
  });
});
