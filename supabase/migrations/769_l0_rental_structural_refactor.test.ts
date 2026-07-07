import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "769_l0_rental_structural_refactor.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const compactSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("769_l0_rental_structural_refactor.sql contract", () => {
  it("unanchors contracts from the portal and adds counter origination", () => {
    expect(compactSql).toContain("alter column portal_customer_id drop not null");
    expect(compactSql).toContain("qrm_company_id uuid references public.qrm_companies(id)");
    expect(compactSql).toContain("origination_channel");
    expect(compactSql).toContain("'counter', 'voice', 'iron', 'portal'");
    expect(compactSql).toContain("rental_contracts_customer_anchor");
    expect(compactSql).toContain(
      "portal_customer_id is not null or qrm_company_id is not null",
    );
  });

  it("models contract types with RPO terms required", () => {
    expect(compactSql).toContain(
      "'reservation', 'rental', 'rpo', 'demo', 'loaner', 'rerent'",
    );
    expect(compactSql).toContain("rental_contracts_rpo_requires_terms_chk");
    expect(compactSql).toContain("contract_type <> 'rpo' or rpo_eligible is true");
  });

  it("installs the lifecycle trunk with owned timestamps", () => {
    expect(compactSql).toContain("rental_contracts_lifecycle_state_chk");
    for (const state of [
      "'draft'", "'quoted'", "'reserved'", "'on_rent'", "'off_rent'",
      "'returned'", "'closed'", "'cancelled'", "'declined'", "'expired'",
    ]) {
      expect(compactSql).toContain(state);
    }
    expect(compactSql).toContain("on_rent_at timestamptz");
    expect(compactSql).toContain("off_rent_at timestamptz");
    expect(compactSql).toContain("returned_at timestamptz");
    expect(compactSql).toContain("closed_at timestamptz");
  });

  it("guards transitions with edge preconditions and clock stamps", () => {
    expect(compactSql).toContain("rental_contract_guard_transition");
    expect(compactSql).toContain("illegal rental lifecycle transition");
    expect(compactSql).toContain("needs an assigned unit before going on rent");
    expect(compactSql).toContain("needs a signature (or logged manager override)");
    expect(compactSql).toContain("requires a coi on file before going on rent");
    expect(compactSql).toContain("billing clock stops here");
    // The guard must fire BEFORE the status sync trigger (name ordering).
    expect(compactSql).toContain("trg_0_rental_contract_guard_transition");
    expect(compactSql).toContain("trg_a_rental_contract_sync_status");
  });

  it("keeps the portal booking machine as a synced sub-flow", () => {
    expect(compactSql).toContain("rental_contract_sync_status");
    expect(compactSql).toContain("when 'submitted' then 'draft'");
    expect(compactSql).toContain("when 'active' then 'on_rent'");
    expect(compactSql).toContain("when 'completed' then 'returned'");
  });

  it("types the IntelliDealer return codes at line level", () => {
    expect(compactSql).toContain("rental_contract_lines_return_code_chk");
    expect(compactSql).toContain("'returned', 'off_rent', 'exchange', 'hold'");
    expect(compactSql).toContain("add value if not exists 'off_rent'");
    expect(compactSql).toContain("add value if not exists 'held'");
  });

  it("activates fleet state on qrm_equipment directly (never the compat view)", () => {
    expect(compactSql).toContain("rental_recompute_equipment_fleet_state");
    expect(compactSql).toContain("update public.qrm_equipment");
    expect(compactSql).toContain("next_available_at");
    expect(compactSql).toContain("readiness_status");
    expect(compactSql).not.toContain("update public.crm_equipment");
  });

  it("assigns human contract numbers", () => {
    expect(compactSql).toContain("rental_contract_number_seq");
    expect(compactSql).toContain("rental_assign_contract_number");
    expect(compactSql).toContain("'rc-'");
  });
});
