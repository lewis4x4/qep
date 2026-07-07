#!/usr/bin/env bun
/**
 * Rental department demo seed (Stream L / L0).
 *
 * Populates a believable rental fleet + contracts across every contract type
 * and lifecycle state so no rental surface demos empty (charter §0: zero-row
 * "BUILT" is banned). Idempotent: fixed UUIDs, upserts, safe to re-run.
 *
 * Usage:
 *   bun ./scripts/demo/rental-seed.mjs seed    # create/refresh demo rows
 *   bun ./scripts/demo/rental-seed.mjs reset   # delete exactly what seed created
 *   bun ./scripts/demo/rental-seed.mjs plan    # print what would be written
 *
 * UUID conventions: contracts use the f000000e- prefix (already covered by the
 * demo purge migration); rental-specific children use f000000f-. Fleet units
 * are flagged via metadata.demoSeedBatchId AND restored to customer_owned on
 * reset rather than deleted (they may be pre-existing rows).
 */
import { createClient } from "@supabase/supabase-js";

const BATCH_ID = "rental-seed-l0";
const WORKSPACE_FALLBACK = "default";

function createAdmin() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Deterministic ids — f000000e (contracts, purge-covered) / f000000f (children).
const C = (n) => `f000000e-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;
const L = (n) => `f000000f-0000-4000-8000-00000001${String(n).padStart(4, "0")}`;
const R = (n) => `f000000f-0000-4000-8000-00000002${String(n).padStart(4, "0")}`;
const RR = (n) => `f000000f-0000-4000-8000-00000003${String(n).padStart(4, "0")}`;

const dayMs = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * dayMs).toISOString();
const day = (offsetDays) => iso(offsetDays).slice(0, 10);

async function main() {
  const mode = process.argv[2] ?? "seed";
  const admin = createAdmin();

  // Anchor on real rows: first workspace company + rep profile + branch.
  const { data: company } = await admin
    .from("qrm_companies")
    .select("id, workspace_id, name")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!company) throw new Error("No qrm_companies row to anchor rental demo data on — run the CRM seed first.");
  const workspaceId = company.workspace_id ?? WORKSPACE_FALLBACK;

  const { data: profile } = await admin.from("profiles").select("id").limit(1).maybeSingle();
  const { data: branch } = await admin.from("branches").select("id").limit(1).maybeSingle();

  // Pick 6 equipment units to promote into the demo rental fleet.
  const { data: units } = await admin
    .from("qrm_equipment")
    .select("id, name")
    .limit(6);
  if (!units || units.length < 6) throw new Error("Need at least 6 qrm_equipment rows for the demo fleet.");

  const fleetRates = [
    { daily: 350, weekly: 1050, monthly: 3150 },
    { daily: 425, weekly: 1275, monthly: 3825 },
    { daily: 275, weekly: 825, monthly: 2475 },
    { daily: 550, weekly: 1650, monthly: 4950 },
    { daily: 300, weekly: 900, monthly: 2700 },
    { daily: 475, weekly: 1425, monthly: 4275 },
  ];

  // Contracts across every type + lifecycle state (charter L0 acceptance).
  const contracts = [
    { id: C(1), type: "rental", lifecycle: "draft", unit: null, start: 2, end: 16 },
    { id: C(2), type: "reservation", lifecycle: "reserved", unit: 1, start: 7, end: 21 },
    { id: C(3), type: "rental", lifecycle: "on_rent", unit: 2, start: -10, end: 18 },
    { id: C(4), type: "rental", lifecycle: "off_rent", unit: 3, start: -21, end: -1 },
    { id: C(5), type: "rpo", lifecycle: "on_rent", unit: 4, start: -45, end: 45, rpo: true },
    { id: C(6), type: "loaner", lifecycle: "on_rent", unit: 5, start: -3, end: 11 },
    { id: C(7), type: "rental", lifecycle: "returned", unit: 0, start: -30, end: -2, overdue: false },
    { id: C(8), type: "rental", lifecycle: "on_rent", unit: 0, start: -40, end: -5, overdue: true },
    { id: C(9), type: "demo", lifecycle: "closed", unit: 1, start: -60, end: -46 },
  ];
  // NOTE on unit reuse: C(7)/C(9) are terminal — their lines are 'returned' so
  // they don't collide with live holds on the same unit.

  if (mode === "plan") {
    console.log(`[plan] workspace=${workspaceId} fleet=${units.length} contracts=${contracts.length}`);
    for (const c of contracts) console.log(`  ${c.id} ${c.type}/${c.lifecycle}`);
    return;
  }

  if (mode === "reset") {
    await admin.from("rental_returns").delete().like("id", "f000000f-0000-4000-8000-00000003%");
    await admin.from("rental_rate_rules").delete().like("id", "f000000f-0000-4000-8000-00000002%");
    await admin.from("rental_contract_lines").delete().like("id", "f000000f-0000-4000-8000-00000001%");
    await admin.from("rental_contracts").delete().like("id", "f000000e-%");
    await admin
      .from("qrm_equipment")
      .update({ ownership: "customer_owned", daily_rental_rate: null, weekly_rental_rate: null, monthly_rental_rate: null, readiness_status: null, next_available_at: null })
      .in("id", units.map((u) => u.id))
      .filter("metadata->>demoSeedBatchId", "eq", BATCH_ID);
    console.log("[reset] rental demo rows removed; fleet units restored");
    return;
  }

  // 1. Promote the demo fleet (marked so reset can restore them).
  for (let i = 0; i < units.length; i++) {
    const { error } = await admin
      .from("qrm_equipment")
      .update({
        ownership: "rental_fleet",
        availability: "available",
        readiness_status: "available",
        daily_rental_rate: fleetRates[i].daily,
        weekly_rental_rate: fleetRates[i].weekly,
        monthly_rental_rate: fleetRates[i].monthly,
        rental_fleet_date: day(-180),
        metadata: { demoSeedBatchId: BATCH_ID },
      })
      .eq("id", units[i].id);
    if (error) throw new Error(`fleet update failed: ${error.message}`);
  }

  // 2. Rate rules (class-level card so the pricing admin has content).
  const rateRules = units.slice(0, 3).map((u, i) => ({
    id: R(i + 1),
    workspace_id: workspaceId,
    equipment_id: u.id,
    daily_rate: fleetRates[i].daily,
    weekly_rate: fleetRates[i].weekly,
    monthly_rate: fleetRates[i].monthly,
    minimum_days: 1,
    is_active: true,
    priority_rank: 10,
    notes: `demo:${BATCH_ID}`,
  }));
  {
    const { error } = await admin.from("rental_rate_rules").upsert(rateRules, { onConflict: "id" });
    if (error) throw new Error(`rate rules failed: ${error.message}`);
  }

  // 3. Contracts + lines. Lifecycle rows are written directly with their
  //    timestamps (the seeder is service-role and states are terminalized in
  //    order), exercising the same rows the guard governs at runtime.
  for (const c of contracts) {
    const unit = c.unit == null ? null : units[c.unit];
    const onRent = ["on_rent", "off_rent", "returned", "closed"].includes(c.lifecycle);
    const rates = fleetRates[c.unit ?? 0];
    const contractRow = {
      id: c.id,
      workspace_id: workspaceId,
      qrm_company_id: company.id,
      origination_channel: "counter",
      originated_by: profile?.id ?? null,
      contract_type: c.type,
      status: c.lifecycle,          // counter rows mirror lifecycle verbatim
      lifecycle_state: c.lifecycle,
      request_type: "booking",
      delivery_mode: "pickup",
      requested_start_date: day(c.start),
      requested_end_date: day(c.end),
      approved_start_date: c.lifecycle === "draft" ? null : day(c.start),
      approved_end_date: c.lifecycle === "draft" ? null : day(c.end),
      equipment_id: unit?.id ?? null,
      assignment_status: unit ? "assigned" : "pending_assignment",
      branch_id: branch?.id ?? null,
      estimate_daily_rate: rates.daily,
      estimate_weekly_rate: rates.weekly,
      estimate_monthly_rate: rates.monthly,
      agreed_daily_rate: onRent ? rates.daily : null,
      agreed_weekly_rate: onRent ? rates.weekly : null,
      agreed_monthly_rate: onRent ? rates.monthly : null,
      on_rent_at: onRent ? iso(c.start) : null,
      off_rent_at: ["off_rent", "returned", "closed"].includes(c.lifecycle) ? iso(c.end - 1) : null,
      returned_at: ["returned", "closed"].includes(c.lifecycle) ? iso(c.end) : null,
      closed_at: c.lifecycle === "closed" ? iso(c.end + 1) : null,
      rate_override_approved_by: onRent ? profile?.id ?? null : null,
      rate_override_reason: onRent ? `demo:${BATCH_ID} check-out override` : null,
      rpo_eligible: Boolean(c.rpo),
      rpo_purchase_price_cents: c.rpo ? 18_500_000 : null,
      rpo_rental_credit_pct: c.rpo ? 0.75 : null,
      rpo_exercise_deadline: c.rpo ? day(60) : null,
      deposit_required: false,
      tax_exempt: false,
      coi_required: false,
      po_required: false,
      delivery_required: false,
      pickup_required: false,
      delivery_address: {},
      pickup_address: {},
      tax_sourcing_method: "branch_origin",
      dealer_notes: `demo:${BATCH_ID}`,
    };
    const { error } = await admin.from("rental_contracts").upsert(contractRow, { onConflict: "id" });
    if (error) throw new Error(`contract ${c.id} failed: ${error.message}`);

    if (unit) {
      const lineStatus =
        c.lifecycle === "reserved" ? "reserved"
        : c.lifecycle === "on_rent" ? "active"
        : c.lifecycle === "off_rent" ? "off_rent"
        : ["returned", "closed"].includes(c.lifecycle) ? "returned"
        : "quoted";
      const { error: lineError } = await admin.from("rental_contract_lines").upsert({
        id: L(contracts.indexOf(c) + 1),
        workspace_id: workspaceId,
        rental_contract_id: c.id,
        line_number: 1,
        quantity: 1,
        equipment_id: unit.id,
        rental_start_at: iso(c.start),
        rental_end_at: iso(c.end),
        actual_returned_at: ["returned", "closed"].includes(c.lifecycle) ? iso(c.end) : null,
        outbound_meter_hours: onRent ? 1240.5 : null,
        return_meter_hours: ["returned", "closed"].includes(c.lifecycle) ? 1290.0 : null,
        daily_rate_cents: Math.round(rates.daily * 100),
        weekly_rate_cents: Math.round(rates.weekly * 100),
        monthly_rate_cents: Math.round(rates.monthly * 100),
        return_code:
          c.lifecycle === "off_rent" ? "off_rent"
          : ["returned", "closed"].includes(c.lifecycle) ? "returned"
          : null,
        rpo_eligible: Boolean(c.rpo),
        status: lineStatus,
      }, { onConflict: "id" });
      if (lineError) throw new Error(`line for ${c.id} failed: ${lineError.message}`);
    }
  }

  // 4. A return-in-flight for the off_rent contract (feeds /ops/returns).
  {
    const { error } = await admin.from("rental_returns").upsert({
      id: RR(1),
      workspace_id: workspaceId,
      equipment_id: units[3].id,
      rental_contract_id: C(4),
      rental_contract_reference: "off-rent pickup pending",
      status: "inspection_pending",
      inspection_checklist: [
        { item: "Inspect exterior condition", completed: false },
        { item: "Inspect tires, tracks, and attachment wear", completed: false },
        { item: "Capture condition photo evidence", completed: false },
        { item: "Record hour meter and return notes", completed: false },
      ],
      condition_photos: [],
      has_charges: null,
      aging_bucket: "0-3d",
    }, { onConflict: "id" });
    if (error) throw new Error(`rental return failed: ${error.message}`);
  }

  console.log(
    `[seed] rental demo ready: ${units.length} fleet units, ${rateRules.length} rate rules, ` +
    `${contracts.length} contracts (draft/quoted/reserved/on_rent/off_rent/returned/closed, ` +
    `types rental/reservation/rpo/demo/loaner), 1 return in flight, 1 overdue on-rent.`,
  );
}

main().catch((err) => {
  console.error(`[rental-seed] ${err.message}`);
  process.exit(1);
});
