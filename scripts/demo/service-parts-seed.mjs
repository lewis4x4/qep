#!/usr/bin/env bun
/**
 * Service + parts demo seed (depends on CRM demo seed for companies/contacts/equipment/profiles).
 * Idempotent upserts by fixed UUIDs in seed-ids.mjs.
 *
 * Usage:
 *   bun ./scripts/demo/service-parts-seed.mjs [seed|reset|plan] [--scenario=name]
 *
 * Scenarios (optional, additive):
 *   machine-down | multi-branch-transfer | vendor-escalation | portal-order-lifecycle
 */
import { createClient } from "@supabase/supabase-js";
import {
  DEMO_IDS,
  DEMO_USERS,
  DEMO_WORKSPACE_ID,
  SERVICE_DEMO_IDS,
  SEED_BRANCHES,
  SEED_PART_NUMBERS,
  SERVICE_PARTS_SEED_BATCH_ID,
  buildTimestamp,
} from "./seed-ids.mjs";

const J = SERVICE_DEMO_IDS.jobs;
const V = SERVICE_DEMO_IDS.vendors;
const PO = SERVICE_DEMO_IDS.partsOrders;
const FR = SERVICE_DEMO_IDS.fulfillmentRuns;

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
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseScenario(argv) {
  const raw = argv.find((a) => a.startsWith("--scenario="));
  return raw ? raw.slice("--scenario=".length).trim() : null;
}

function inventoryRows() {
  const branches = [SEED_BRANCHES.mainYard, SEED_BRANCHES.lakecity, SEED_BRANCHES.gulfDepot];
  /** qty pattern per branch index x part index */
  const qty = [
    [22, 18, 14, 20, 25, 10, 8, 6],
    [8, 6, 4, 7, 9, 3, 2, 4],
    [0, 2, 1, 0, 3, 0, 1, 0],
  ];
  const bins = ["A-12", "A-14", "B-04", "B-05", "C-01", "C-02", "D-08", "D-09"];
  const rows = [];
  let idx = 0;
  for (let b = 0; b < 3; b += 1) {
    for (let p = 0; p < 8; p += 1) {
      rows.push({
        id: SERVICE_DEMO_IDS.partsInventory[idx],
        workspace_id: DEMO_WORKSPACE_ID,
        branch_id: branches[b],
        part_number: SEED_PART_NUMBERS[p],
        qty_on_hand: qty[b][p],
        bin_location: bins[p],
      });
      idx += 1;
    }
  }
  return rows;
}

function branchConfigRows() {
  const rep = DEMO_USERS.find((u) => u.key === "rep_primary").id;
  const rep2 = DEMO_USERS.find((u) => u.key === "rep_secondary").id;
  const mgr = DEMO_USERS.find((u) => u.key === "manager").id;
  return [
    {
      id: SERVICE_DEMO_IDS.branchConfig.mainYard,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.mainYard,
      default_advisor_pool: [rep],
      default_technician_pool: [rep, rep2],
      parts_team_notify_user_ids: [mgr],
      notes: "Demo primary yard — planner + parts notifications",
    },
    {
      id: SERVICE_DEMO_IDS.branchConfig.lakecity,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.lakecity,
      default_advisor_pool: [rep],
      default_technician_pool: [rep2],
      parts_team_notify_user_ids: [mgr],
      notes: "Lake City branch (Apex) — linked CRM context",
    },
    {
      id: SERVICE_DEMO_IDS.branchConfig.gulfDepot,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.gulfDepot,
      default_advisor_pool: [rep2],
      default_technician_pool: [rep2],
      parts_team_notify_user_ids: [mgr],
      notes: "Low-stock depot — transfer / order scenarios",
    },
  ];
}

function vendorRows() {
  return [
    {
      id: V.hydraulic,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Hydraulic Supply Co (Demo)",
      supplier_type: "aftermarket",
      category_support: ["hydraulics", "filters"],
      avg_lead_time_hours: 6,
      responsiveness_score: 0.92,
      after_hours_contact: "800-555-0101",
      machine_down_escalation_path: "Tier-1 phone → ops manager SMS",
      notes: "Fast path vendor for demo picks",
    },
    {
      id: V.oem,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "OEM Parts Direct (Demo)",
      supplier_type: "oem",
      category_support: ["oem", "warranty"],
      avg_lead_time_hours: 72,
      responsiveness_score: 0.55,
      after_hours_contact: "portal-only",
      machine_down_escalation_path: "Email PO → 24h callback → territory rep",
      notes: "Slow OEM — use for order/escalation demos",
    },
    {
      id: V.consumables,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Consumables Warehouse (Demo)",
      supplier_type: "general",
      category_support: ["fluids", "wear"],
      avg_lead_time_hours: 12,
      responsiveness_score: 0.78,
      notes: "Bulk consumables",
    },
  ];
}

function jobRows() {
  const rep = DEMO_USERS.find((u) => u.key === "rep_primary").id;
  const now = new Date().toISOString();
  return [
    {
      id: J.j1,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.mainYard,
      customer_id: DEMO_IDS.companies.apexHoldings,
      contact_id: DEMO_IDS.contacts.mason,
      machine_id: DEMO_IDS.equipment.apexDozer,
      source_type: "walk_in",
      request_type: "repair",
      priority: "critical",
      current_stage: "parts_pending",
      status_flags: ["machine_down", "customer_pay"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary:
        "Demo: machine down — hydraulic pressure loss; parts queue + pick scenario",
      current_stage_entered_at: now,
    },
    {
      id: J.j2,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.lakecity,
      customer_id: DEMO_IDS.companies.apexLakeCity,
      contact_id: DEMO_IDS.contacts.hannah,
      machine_id: DEMO_IDS.equipment.apexMulcher,
      source_type: "call",
      request_type: "pm_service",
      priority: "normal",
      current_stage: "quote_sent",
      status_flags: ["shop_job"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo: PM service quote — staged parts line",
      current_stage_entered_at: now,
    },
    {
      id: J.j3,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.gulfDepot,
      customer_id: DEMO_IDS.companies.gulfCoast,
      contact_id: DEMO_IDS.contacts.jordan,
      machine_id: null,
      source_type: "field_tech",
      request_type: "repair",
      priority: "urgent",
      current_stage: "triaging",
      status_flags: ["field_job", "waiting_vendor"],
      advisor_id: rep,
      shop_or_field: "field",
      haul_required: false,
      customer_problem_summary: "Demo: field job — vendor order path",
      current_stage_entered_at: now,
    },
    {
      id: J.j4,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.mainYard,
      customer_id: DEMO_IDS.companies.pineRiver,
      contact_id: DEMO_IDS.contacts.elena,
      machine_id: DEMO_IDS.equipment.pineSkidSteer,
      source_type: "sales_handoff",
      request_type: "repair",
      priority: "normal",
      current_stage: "in_progress",
      status_flags: ["field_job"],
      advisor_id: rep,
      shop_or_field: "field",
      haul_required: false,
      customer_problem_summary: "Demo: in-progress field repair",
      current_stage_entered_at: now,
    },
    {
      id: J.j5,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.lakecity,
      customer_id: DEMO_IDS.companies.apexHoldings,
      contact_id: DEMO_IDS.contacts.mason,
      machine_id: DEMO_IDS.equipment.apexDozer,
      source_type: "walk_in",
      request_type: "inspection",
      priority: "normal",
      current_stage: "diagnosis_selected",
      status_flags: ["shop_job"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo: diagnosis — suggested intake lines",
      current_stage_entered_at: now,
    },
    {
      id: J.j6,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.gulfDepot,
      customer_id: DEMO_IDS.companies.gulfCoast,
      contact_id: DEMO_IDS.contacts.jordan,
      machine_id: null,
      source_type: "portal",
      request_type: "repair",
      priority: "normal",
      current_stage: "parts_pending",
      status_flags: ["waiting_transfer"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo: transfer vs order planner scenario",
      current_stage_entered_at: now,
    },
    {
      id: J.j7,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.mainYard,
      customer_id: DEMO_IDS.companies.apexLakeCity,
      contact_id: DEMO_IDS.contacts.hannah,
      machine_id: DEMO_IDS.equipment.apexMulcher,
      source_type: "call",
      request_type: "repair",
      priority: "normal",
      current_stage: "request_received",
      status_flags: ["shop_job"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo: new intake — pending parts lines",
      current_stage_entered_at: now,
    },
    {
      id: J.j8,
      workspace_id: DEMO_WORKSPACE_ID,
      branch_id: SEED_BRANCHES.lakecity,
      customer_id: DEMO_IDS.companies.pineRiver,
      contact_id: DEMO_IDS.contacts.elena,
      machine_id: DEMO_IDS.equipment.pineSkidSteer,
      source_type: "walk_in",
      request_type: "machine_down",
      priority: "critical",
      current_stage: "quote_sent",
      status_flags: ["machine_down"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo: urgent bucket — need_by spread",
      current_stage_entered_at: now,
    },
  ];
}

/** @param {ReturnType<typeof jobRows>} jobs */
function requirementRows(jobs) {
  const R = SERVICE_DEMO_IDS.requirements;
  const t = {
    overdue: buildTimestamp({ days: -2, hours: -3 }),
    today: buildTimestamp({ hours: 2 }),
    future: buildTimestamp({ days: 3, hours: 4 }),
  };
  const rows = [
    {
      id: R[0],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[0].id,
      part_number: "HYD-FILTER-01",
      description: "Primary hydraulic filter",
      quantity: 2,
      unit_cost: 42.5,
      source: "manual",
      status: "pending",
      need_by_date: t.overdue,
      confidence: "high",
      vendor_id: V.hydraulic,
      intake_line_status: "accepted",
    },
    {
      id: R[1],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[0].id,
      part_number: "SEAL-KIT-12",
      description: "Cylinder seal kit",
      quantity: 1,
      source: "job_code_template",
      status: "picking",
      need_by_date: t.today,
      confidence: "medium",
      vendor_id: null,
      intake_line_status: "planned",
    },
    {
      id: R[2],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[1].id,
      part_number: "BLADE-EDGE-60",
      description: "Cutting edge",
      quantity: 1,
      source: "manual",
      status: "staged",
      need_by_date: t.future,
      confidence: "manual",
      intake_line_status: "accepted",
    },
    {
      id: R[3],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[2].id,
      part_number: "HYD-FILTER-01",
      description: "Filter — vendor order (low stock at gulf)",
      quantity: 3,
      source: "ai_suggested",
      status: "ordering",
      need_by_date: t.today,
      confidence: "low",
      vendor_id: V.oem,
      intake_line_status: "accepted",
    },
    {
      id: R[4],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[3].id,
      part_number: "TRACK-PAD-L",
      description: "Left track pad",
      quantity: 4,
      source: "manual",
      status: "received",
      need_by_date: t.future,
      intake_line_status: "accepted",
    },
    {
      id: R[5],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[4].id,
      part_number: "COOLANT-5GAL",
      description: "Coolant",
      quantity: 2,
      source: "ai_suggested",
      status: "pending",
      need_by_date: t.today,
      confidence: "medium",
      intake_line_status: "suggested",
    },
    {
      id: R[6],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[5].id,
      part_number: "BELT-FAN-42",
      description: "Fan belt — transfer candidate",
      quantity: 1,
      source: "manual",
      status: "pending",
      need_by_date: t.overdue,
      intake_line_status: "accepted",
    },
    {
      id: R[7],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[5].id,
      part_number: "BUCKET-TEETH-SET",
      description: "Teeth set",
      quantity: 1,
      source: "manual",
      status: "transferring",
      need_by_date: t.future,
      vendor_id: V.consumables,
      intake_line_status: "planned",
    },
    {
      id: R[8],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[6].id,
      part_number: "SEAL-KIT-12",
      description: "Seals for mulcher",
      quantity: 1,
      source: "manual",
      status: "pending",
      need_by_date: t.today,
      intake_line_status: "accepted",
    },
    {
      id: R[9],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[7].id,
      part_number: "TRACK-PAD-R",
      description: "Right track pad",
      quantity: 2,
      source: "manual",
      status: "picking",
      need_by_date: t.overdue,
      intake_line_status: "accepted",
    },
    {
      id: R[10],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[7].id,
      part_number: "HYD-FILTER-01",
      description: "Extra filter line",
      quantity: 1,
      source: "job_code_template",
      status: "pending",
      need_by_date: t.future,
      intake_line_status: "accepted",
    },
    {
      id: R[11],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[1].id,
      part_number: "COOLANT-5GAL",
      description: "Coolant top-up",
      quantity: 1,
      source: "manual",
      status: "pending",
      need_by_date: t.today,
      vendor_id: V.consumables,
      intake_line_status: "accepted",
    },
    {
      id: R[12],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[3].id,
      part_number: "BLADE-EDGE-60",
      description: "Edge wear parts",
      quantity: 1,
      source: "manual",
      status: "staged",
      need_by_date: t.future,
      intake_line_status: "accepted",
    },
    {
      id: R[13],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[0].id,
      part_number: "BUCKET-TEETH-SET",
      description: "Teeth — override audit demo",
      quantity: 1,
      source: "manual",
      status: "pending",
      need_by_date: t.today,
      intake_line_status: "accepted",
    },
    {
      id: R[14],
      workspace_id: DEMO_WORKSPACE_ID,
      job_id: jobs[2].id,
      part_number: "COOLANT-5GAL",
      description: "Consumables reorder",
      quantity: 3,
      source: "manual",
      status: "ordering",
      need_by_date: t.overdue,
      vendor_id: V.oem,
      intake_line_status: "accepted",
    },
  ];
  return rows;
}

async function seedProfileWorkspaces(admin) {
  const rows = DEMO_USERS.map((u) => ({
    profile_id: u.id,
    workspace_id: DEMO_WORKSPACE_ID,
  }));
  const { error } = await admin.from("profile_workspaces").upsert(rows, {
    onConflict: "profile_id,workspace_id",
  });
  if (error) throw error;
}

async function seedScenarioExtras(admin, scenario, jobs) {
  const mgr = DEMO_USERS.find((u) => u.key === "manager").id;
  const rep = DEMO_USERS.find((u) => u.key === "rep_primary").id;
  if (scenario === "machine-down") {
    const jid = SERVICE_DEMO_IDS.scenarioMachineDownJob;
    const now = new Date().toISOString();
    const { error: ej } = await admin.from("service_jobs").upsert(
      {
        id: jid,
        workspace_id: DEMO_WORKSPACE_ID,
        branch_id: SEED_BRANCHES.mainYard,
        customer_id: DEMO_IDS.companies.apexHoldings,
        contact_id: DEMO_IDS.contacts.mason,
        machine_id: DEMO_IDS.equipment.apexDozer,
        source_type: "call",
        request_type: "machine_down",
        priority: "critical",
        current_stage: "parts_pending",
        status_flags: ["machine_down"],
        shop_or_field: "field",
        haul_required: false,
        customer_problem_summary:
          "Scenario: machine down — stock intentionally insufficient at branch for planner tests",
        current_stage_entered_at: now,
      },
      { onConflict: "id" },
    );
    if (ej) throw ej;
    const { error: er } = await admin.from("service_parts_requirements").upsert(
      {
        id: "f000000e-0000-4000-8000-000000000001",
        workspace_id: DEMO_WORKSPACE_ID,
        job_id: jid,
        part_number: "FAKE-PART-ZZZ",
        description: "No inventory row — forces vendor/order path",
        quantity: 5,
        source: "manual",
        status: "ordering",
        need_by_date: buildTimestamp({ hours: -1 }),
        confidence: "high",
        vendor_id: V.oem,
        intake_line_status: "accepted",
      },
      { onConflict: "id" },
    );
    if (er) throw er;
  }
  if (scenario === "vendor-escalation") {
    const { error: pol } = await admin.from("vendor_escalation_policies").upsert(
      {
        id: SERVICE_DEMO_IDS.vendorEscalationPolicy,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Demo OEM overdue PO",
        steps: [
          { hours: 4, action: "email_vendor" },
          { hours: 12, action: "sms_manager" },
          { hours: 24, action: "escalate_ops" },
        ],
        is_machine_down: true,
      },
      { onConflict: "id" },
    );
    if (pol) throw pol;
    const { error: esc } = await admin.from("vendor_escalations").upsert(
      {
        id: SERVICE_DEMO_IDS.vendorEscalation,
        workspace_id: DEMO_WORKSPACE_ID,
        vendor_id: V.oem,
        job_id: jobs[2].id,
        policy_id: SERVICE_DEMO_IDS.vendorEscalationPolicy,
        po_reference: "DEMO-PO-77821",
        current_step: 2,
        next_action_at: buildTimestamp({ hours: 2 }),
        resolution_notes: null,
      },
      { onConflict: "id" },
    );
    if (esc) throw esc;
  }
  if (scenario === "portal-order-lifecycle") {
    const { error: po } = await admin.from("parts_orders").upsert(
      {
        id: PO.shipped,
        workspace_id: DEMO_WORKSPACE_ID,
        portal_customer_id: SERVICE_DEMO_IDS.portalCustomers.manager,
        status: "shipped",
        line_items: [
          {
            part_number: "HYD-FILTER-01",
            description: "Lifecycle demo",
            quantity: 1,
            unit_price: 42.5,
            is_ai_suggested: false,
          },
        ],
        subtotal: 42.5,
        tax: 0,
        shipping: 0,
        total: 42.5,
        fulfillment_run_id: FR.submitted,
        tracking_number: "DEMO-TRACK-999",
      },
      { onConflict: "id" },
    );
    if (po) throw po;
  }
  if (scenario === "multi-branch-transfer") {
    const tid = SERVICE_DEMO_IDS.scenarioTransferJob;
    const now = new Date().toISOString();
    const { error: tj } = await admin.from("service_jobs").upsert(
      {
        id: tid,
        workspace_id: DEMO_WORKSPACE_ID,
        branch_id: SEED_BRANCHES.gulfDepot,
        customer_id: DEMO_IDS.companies.pineRiver,
        contact_id: DEMO_IDS.contacts.elena,
        machine_id: DEMO_IDS.equipment.pineSkidSteer,
        source_type: "walk_in",
        request_type: "repair",
        priority: "urgent",
        current_stage: "parts_pending",
        status_flags: ["waiting_transfer"],
        shop_or_field: "shop",
        haul_required: false,
        customer_problem_summary:
          "Scenario: stock at main-yard, zero at gulf — open planner for transfer",
        current_stage_entered_at: now,
        advisor_id: rep,
      },
      { onConflict: "id" },
    );
    if (tj) throw tj;
    const { error: tr } = await admin.from("service_parts_requirements").upsert(
      {
        id: "f000000e-0000-4000-8000-000000000002",
        workspace_id: DEMO_WORKSPACE_ID,
        job_id: tid,
        part_number: "TRACK-PAD-L",
        description: "Pads available at main-yard",
        quantity: 2,
        source: "manual",
        status: "pending",
        need_by_date: buildTimestamp({ hours: 4 }),
        intake_line_status: "accepted",
      },
      { onConflict: "id" },
    );
    if (tr) throw tr;
  }
}

export async function seedServicePartsData(admin, options = {}) {
  const scenario = options.scenario ?? null;
  await seedProfileWorkspaces(admin);

  const { error: bcErr } = await admin
    .from("service_branch_config")
    .upsert(branchConfigRows(), { onConflict: "id" });
  if (bcErr) throw bcErr;

  const { error: vErr } = await admin.from("vendor_profiles").upsert(vendorRows(), {
    onConflict: "id",
  });
  if (vErr) throw vErr;

  const inv = inventoryRows();
  const { error: piErr } = await admin.from("parts_inventory").upsert(inv, {
    onConflict: "id",
  });
  if (piErr) throw piErr;

  const jobs = jobRows();
  const { error: jErr } = await admin.from("service_jobs").upsert(jobs, {
    onConflict: "id",
  });
  if (jErr) throw jErr;

  const reqs = requirementRows(jobs);
  const { error: rErr } = await admin.from("service_parts_requirements").upsert(reqs, {
    onConflict: "id",
  });
  if (rErr) throw rErr;

  const { error: frErr } = await admin.from("parts_fulfillment_runs").upsert(
    [
      { id: FR.open, workspace_id: DEMO_WORKSPACE_ID, status: "open" },
      {
        id: FR.submitted,
        workspace_id: DEMO_WORKSPACE_ID,
        status: "submitted",
      },
    ],
    { onConflict: "id" },
  );
  if (frErr) throw frErr;

  const ev = SERVICE_DEMO_IDS.fulfillmentEvents.map((id, i) => ({
    id,
    workspace_id: DEMO_WORKSPACE_ID,
    fulfillment_run_id: i < 3 ? FR.open : FR.submitted,
    event_type: ["pick", "stage", "receive", "pick", "ship_notice", "ordered"][
      i
    ],
    payload: { demoSeedBatchId: SERVICE_PARTS_SEED_BATCH_ID, step: i },
  }));
  const { error: feErr } = await admin.from("parts_fulfillment_events").upsert(ev, {
    onConflict: "id",
  });
  if (feErr) throw feErr;

  const portalRows = [
    {
      id: SERVICE_DEMO_IDS.portalCustomers.manager,
      workspace_id: DEMO_WORKSPACE_ID,
      crm_contact_id: DEMO_IDS.contacts.mason,
      crm_company_id: DEMO_IDS.companies.apexHoldings,
      first_name: "Portal",
      last_name: "ManagerSeed",
      email: `portal.manager.seed@${DEMO_WORKSPACE_ID}.qep.local`,
      portal_role: "manager",
      is_active: true,
      default_branch: SEED_BRANCHES.mainYard,
    },
    {
      id: SERVICE_DEMO_IDS.portalCustomers.viewer,
      workspace_id: DEMO_WORKSPACE_ID,
      crm_contact_id: DEMO_IDS.contacts.hannah,
      crm_company_id: DEMO_IDS.companies.apexLakeCity,
      first_name: "Portal",
      last_name: "ViewerSeed",
      email: `portal.viewer.seed@${DEMO_WORKSPACE_ID}.qep.local`,
      portal_role: "viewer",
      is_active: true,
      default_branch: SEED_BRANCHES.lakecity,
    },
  ];
  const { error: pcErr } = await admin.from("portal_customers").upsert(portalRows, {
    onConflict: "id",
  });
  if (pcErr) throw pcErr;

  const { error: poErr } = await admin.from("parts_orders").upsert(
    [
      {
        id: PO.draft,
        workspace_id: DEMO_WORKSPACE_ID,
        portal_customer_id: SERVICE_DEMO_IDS.portalCustomers.viewer,
        status: "draft",
        line_items: [
          {
            part_number: "SEAL-KIT-12",
            description: "Draft order line",
            quantity: 1,
            unit_price: 120,
            is_ai_suggested: false,
          },
        ],
        subtotal: 120,
        tax: 0,
        shipping: 0,
        total: 120,
        fulfillment_run_id: null,
      },
      {
        id: PO.submitted,
        workspace_id: DEMO_WORKSPACE_ID,
        portal_customer_id: SERVICE_DEMO_IDS.portalCustomers.manager,
        status: "submitted",
        line_items: [
          {
            part_number: "HYD-FILTER-01",
            description: "Submitted line",
            quantity: 2,
            unit_price: 42.5,
            is_ai_suggested: false,
          },
        ],
        subtotal: 85,
        tax: 0,
        shipping: 10,
        total: 95,
        fulfillment_run_id: FR.open,
      },
      {
        id: PO.processing,
        workspace_id: DEMO_WORKSPACE_ID,
        portal_customer_id: SERVICE_DEMO_IDS.portalCustomers.manager,
        status: "processing",
        line_items: [
          {
            part_number: "BELT-FAN-42",
            description: "Processing line",
            quantity: 1,
            unit_price: 89,
            is_ai_suggested: false,
          },
        ],
        subtotal: 89,
        tax: 0,
        shipping: 0,
        total: 89,
        fulfillment_run_id: FR.submitted,
      },
    ],
    { onConflict: "id" },
  );
  if (poErr) throw poErr;

  const mgr = DEMO_USERS.find((u) => u.key === "manager").id;
  const { error: ovErr } = await admin
    .from("service_parts_inventory_overrides")
    .upsert(
      [
        {
          id: SERVICE_DEMO_IDS.inventoryOverrides.o1,
          workspace_id: DEMO_WORKSPACE_ID,
          requirement_id: reqs[13].id,
          job_id: jobs[0].id,
          part_number: "BUCKET-TEETH-SET",
          quantity_requested: 1,
          qty_on_hand_after: 9,
          insufficient: false,
          reason: "Demo override — physical pick matched floor count",
          actor_id: mgr,
        },
        {
          id: SERVICE_DEMO_IDS.inventoryOverrides.o2,
          workspace_id: DEMO_WORKSPACE_ID,
          requirement_id: reqs[0].id,
          job_id: jobs[0].id,
          part_number: "HYD-FILTER-01",
          quantity_requested: 2,
          qty_on_hand_after: 20,
          insufficient: false,
          reason: "Demo audit — manager approved non-strict pick",
          actor_id: mgr,
        },
      ],
      { onConflict: "id" },
    );
  if (ovErr) throw ovErr;

  const { error: billErr } = await admin
    .from("service_internal_billing_line_staging")
    .upsert(
      [
        {
          id: SERVICE_DEMO_IDS.billingStaging.b1,
          workspace_id: DEMO_WORKSPACE_ID,
          service_job_id: jobs[3].id,
          requirement_id: reqs[4].id,
          line_type: "parts_consume",
          part_number: "TRACK-PAD-L",
          description: "Consumed pads — draft invoice bridge",
          quantity: 4,
          unit_cost: 55,
          status: "draft",
        },
        {
          id: SERVICE_DEMO_IDS.billingStaging.b2,
          workspace_id: DEMO_WORKSPACE_ID,
          service_job_id: jobs[1].id,
          requirement_id: reqs[2].id,
          line_type: "parts_consume",
          part_number: "BLADE-EDGE-60",
          description: "Staged blade — draft billing",
          quantity: 1,
          unit_cost: 210,
          status: "draft",
        },
      ],
      { onConflict: "id" },
    );
  if (billErr) throw billErr;

  await seedScenarioExtras(admin, scenario, jobs);

  console.log(
    `Seeded service/parts batch "${SERVICE_PARTS_SEED_BATCH_ID}" in workspace "${DEMO_WORKSPACE_ID}".`,
  );
  if (scenario) console.log(`  scenario: ${scenario}`);
}

export async function resetServicePartsData(admin) {
  const ids = {
    jobs: Object.values(J),
    reqs: SERVICE_DEMO_IDS.requirements,
    inv: SERVICE_DEMO_IDS.partsInventory,
    vendors: Object.values(V),
    branches: Object.values(SERVICE_DEMO_IDS.branchConfig),
    runs: Object.values(FR),
    events: SERVICE_DEMO_IDS.fulfillmentEvents,
    portal: Object.values(SERVICE_DEMO_IDS.portalCustomers),
    orders: Object.values(PO),
    overrides: Object.values(SERVICE_DEMO_IDS.inventoryOverrides),
    billing: Object.values(SERVICE_DEMO_IDS.billingStaging),
  };

  await admin.from("service_internal_billing_line_staging").delete().in("id", ids.billing);
  await admin.from("service_parts_inventory_overrides").delete().in("id", ids.overrides);
  await admin.from("parts_fulfillment_events").delete().in("id", ids.events);
  await admin.from("parts_orders").delete().in("id", ids.orders);
  await admin.from("service_parts_requirements").delete().in("id", ids.reqs);
  await admin.from("service_jobs").delete().in("id", ids.jobs);
  await admin
    .from("service_jobs")
    .delete()
    .in("id", [
      SERVICE_DEMO_IDS.scenarioMachineDownJob,
      SERVICE_DEMO_IDS.scenarioTransferJob,
    ]);
  await admin.from("vendor_escalations").delete().eq("id", SERVICE_DEMO_IDS.vendorEscalation);
  await admin
    .from("vendor_escalation_policies")
    .delete()
    .eq("id", SERVICE_DEMO_IDS.vendorEscalationPolicy);
  await admin.from("parts_inventory").delete().in("id", ids.inv);
  await admin.from("vendor_profiles").delete().in("id", ids.vendors);
  await admin.from("parts_fulfillment_runs").delete().in("id", ids.runs);
  await admin.from("portal_customers").delete().in("id", ids.portal);
  await admin.from("service_branch_config").delete().in("id", ids.branches);
  await admin
    .from("service_parts_requirements")
    .delete()
    .in("id", ["f000000e-0000-4000-8000-000000000001", "f000000e-0000-4000-8000-000000000002"]);
  console.log("Removed service/parts demo rows (fixed ids).");
}

function printPlan() {
  console.log(`Service / parts demo seed

Workspace: ${DEMO_WORKSPACE_ID} (must match JWT get_my_workspace())

Prerequisites:
  Run CRM demo seed first so companies, contacts, equipment, and demo profiles exist.

Tables:
  profile_workspaces, service_branch_config, vendor_profiles, parts_inventory,
  service_jobs, service_parts_requirements, parts_fulfillment_runs,
  parts_fulfillment_events, portal_customers, parts_orders,
  service_parts_inventory_overrides, service_internal_billing_line_staging

Branches: ${SEED_BRANCHES.mainYard}, ${SEED_BRANCHES.lakecity}, ${SEED_BRANCHES.gulfDepot}

Parts: ${SEED_PART_NUMBERS.join(", ")}

Optional scenarios:
  --scenario=machine-down
  --scenario=multi-branch-transfer
  --scenario=vendor-escalation
  --scenario=portal-order-lifecycle
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "seed";
  const scenario = parseScenario(argv);

  if (cmd === "plan") {
    printPlan();
    return;
  }

  const admin = createAdmin();

  if (cmd === "reset") {
    await resetServicePartsData(admin);
    return;
  }

  if (cmd === "seed") {
    await seedServicePartsData(admin, { scenario });
    return;
  }

  console.error("Usage: seed | reset | plan   [--scenario=name]");
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
