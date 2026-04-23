/**
 * Service/parts demo seed — keep aligned with scripts/demo/service-parts-seed.mjs + scripts/demo/seed-ids.mjs
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const WS = "default";
const BATCH = "service-parts-seed-2026-04-05";

const BR = {
  mainYard: "main-yard",
  lakecity: "lakecity-branch",
  gulfDepot: "gulf-depot",
};

const PARTS = [
  "HYD-FILTER-01",
  "SEAL-KIT-12",
  "TRACK-PAD-L",
  "TRACK-PAD-R",
  "BLADE-EDGE-60",
  "BUCKET-TEETH-SET",
  "COOLANT-5GAL",
  "BELT-FAN-42",
];

const SP = {
  branchConfig: {
    mainYard: "f0000001-0000-4000-8000-000000000001",
    lakecity: "f0000001-0000-4000-8000-000000000002",
    gulfDepot: "f0000001-0000-4000-8000-000000000003",
  },
  vendors: {
    hydraulic: "f0000002-0000-4000-8000-000000000001",
    oem: "f0000002-0000-4000-8000-000000000002",
    consumables: "f0000002-0000-4000-8000-000000000003",
  },
  partsInventory: Array.from({ length: 24 }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    return `f0000003-0000-4000-8000-000000000${n}`;
  }),
  jobs: {
    j1: "f0000004-0000-4000-8000-000000000001",
    j2: "f0000004-0000-4000-8000-000000000002",
    j3: "f0000004-0000-4000-8000-000000000003",
    j4: "f0000004-0000-4000-8000-000000000004",
    j5: "f0000004-0000-4000-8000-000000000005",
    j6: "f0000004-0000-4000-8000-000000000006",
    j7: "f0000004-0000-4000-8000-000000000007",
    j8: "f0000004-0000-4000-8000-000000000008",
  },
  requirements: Array.from({ length: 15 }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    return `f0000005-0000-4000-8000-000000000${n}`;
  }),
  fulfillmentRuns: {
    open: "f0000006-0000-4000-8000-000000000001",
    submitted: "f0000006-0000-4000-8000-000000000002",
  },
  fulfillmentEvents: [
    "f0000007-0000-4000-8000-000000000001",
    "f0000007-0000-4000-8000-000000000002",
    "f0000007-0000-4000-8000-000000000003",
    "f0000007-0000-4000-8000-000000000004",
    "f0000007-0000-4000-8000-000000000005",
    "f0000007-0000-4000-8000-000000000006",
  ],
  portalCustomers: {
    manager: "f0000008-0000-4000-8000-000000000001",
    viewer: "f0000008-0000-4000-8000-000000000002",
  },
  partsOrders: {
    draft: "f0000009-0000-4000-8000-000000000001",
    submitted: "f0000009-0000-4000-8000-000000000002",
    processing: "f0000009-0000-4000-8000-000000000003",
  },
  inventoryOverrides: {
    o1: "f000000a-0000-4000-8000-000000000001",
    o2: "f000000a-0000-4000-8000-000000000002",
  },
  billingStaging: {
    b1: "f000000b-0000-4000-8000-000000000001",
    b2: "f000000b-0000-4000-8000-000000000002",
  },
};

type CoreIds = {
  companies: {
    apexHoldings: string;
    apexLakeCity: string;
    gulfCoast: string;
    pineRiver: string;
  };
  contacts: {
    mason: string;
    hannah: string;
    jordan: string;
    elena: string;
  };
  equipment: {
    apexDozer: string;
    apexMulcher: string;
    pineSkidSteer: string;
  };
};

type Assignees = { repPrimary: string; repSecondary: string; manager: string };

function ts(offset: { days?: number; hours?: number; minutes?: number }) {
  const value = new Date();
  value.setSeconds(0, 0);
  value.setDate(value.getDate() + (offset.days ?? 0));
  value.setHours(
    value.getHours() + (offset.hours ?? 0),
    value.getMinutes() + (offset.minutes ?? 0),
    0,
    0,
  );
  return value.toISOString();
}

export async function resetServicePartsDemoData(
  admin: SupabaseClient,
  deleteByIds: (table: string, ids: string[]) => Promise<void>,
) {
  await deleteByIds("service_internal_billing_line_staging", Object.values(SP.billingStaging));
  await deleteByIds("service_parts_inventory_overrides", Object.values(SP.inventoryOverrides));
  await deleteByIds("parts_fulfillment_events", SP.fulfillmentEvents);
  await deleteByIds("parts_orders", Object.values(SP.partsOrders));
  await deleteByIds("service_parts_requirements", SP.requirements);
  await deleteByIds("service_jobs", Object.values(SP.jobs));
  await deleteByIds("parts_inventory", SP.partsInventory);
  await deleteByIds("vendor_profiles", Object.values(SP.vendors));
  await deleteByIds("parts_fulfillment_runs", Object.values(SP.fulfillmentRuns));
  await deleteByIds("portal_customers", Object.values(SP.portalCustomers));
  await deleteByIds("service_branch_config", Object.values(SP.branchConfig));
}

export async function seedServicePartsDemoData(
  admin: SupabaseClient,
  ids: CoreIds,
  assignees: Assignees,
): Promise<{ partsInventory: number; serviceJobs: number; requirements: number }> {
  const rep = assignees.repPrimary;
  const rep2 = assignees.repSecondary;
  const mgr = assignees.manager;
  const now = new Date().toISOString();
  const J = SP.jobs;
  const R = SP.requirements;
  const V = SP.vendors;

  const profileRows = [rep, rep2, mgr].map((profile_id) => ({
    profile_id,
    workspace_id: WS,
  }));
  const { error: pwErr } = await admin.from("profile_workspaces").upsert(profileRows, {
    onConflict: "profile_id,workspace_id",
  });
  if (pwErr) throw pwErr;

  // Upsert canonical branches first — parts_demand_forecasts and
  // parts_reorder_profiles both have composite FKs to branches(workspace_id, slug),
  // so inventory seeded against these slugs only survives if the branches exist.
  const canonicalBranches = [
    { workspace_id: WS, slug: BR.mainYard, display_name: "Main Yard", notes: "Demo primary yard" },
    { workspace_id: WS, slug: BR.lakecity, display_name: "Lake City", notes: "Lake City demo branch" },
    { workspace_id: WS, slug: BR.gulfDepot, display_name: "Gulf Depot", notes: "Gulf Coast demo depot" },
  ];
  const { error: brErr } = await admin.from("branches").upsert(canonicalBranches, { onConflict: "workspace_id,slug" });
  if (brErr) throw brErr;

  const branchRows = [
    {
      id: SP.branchConfig.mainYard,
      workspace_id: WS,
      branch_id: BR.mainYard,
      default_advisor_pool: [rep],
      default_technician_pool: [rep, rep2],
      parts_team_notify_user_ids: [mgr],
      notes: "Demo primary yard",
    },
    {
      id: SP.branchConfig.lakecity,
      workspace_id: WS,
      branch_id: BR.lakecity,
      default_advisor_pool: [rep],
      default_technician_pool: [rep2],
      parts_team_notify_user_ids: [mgr],
      notes: "Lake City branch",
    },
    {
      id: SP.branchConfig.gulfDepot,
      workspace_id: WS,
      branch_id: BR.gulfDepot,
      default_advisor_pool: [rep2],
      default_technician_pool: [rep2],
      parts_team_notify_user_ids: [mgr],
      notes: "Gulf depot",
    },
  ];
  const { error: bcErr } = await admin.from("service_branch_config").upsert(branchRows, { onConflict: "id" });
  if (bcErr) throw bcErr;

  const vendors = [
    {
      id: V.hydraulic,
      workspace_id: WS,
      name: "Hydraulic Supply Co (Demo)",
      supplier_type: "aftermarket",
      category_support: ["hydraulics"],
      avg_lead_time_hours: 6,
      responsiveness_score: 0.92,
      machine_down_escalation_path: "Tier-1 phone",
      notes: BATCH,
    },
    {
      id: V.oem,
      workspace_id: WS,
      name: "OEM Parts Direct (Demo)",
      supplier_type: "oem",
      category_support: ["oem"],
      avg_lead_time_hours: 72,
      responsiveness_score: 0.55,
      machine_down_escalation_path: "Email PO",
      notes: BATCH,
    },
    {
      id: V.consumables,
      workspace_id: WS,
      name: "Consumables Warehouse (Demo)",
      supplier_type: "general",
      category_support: ["fluids"],
      avg_lead_time_hours: 12,
      responsiveness_score: 0.78,
      notes: BATCH,
    },
  ];
  const { error: vErr } = await admin.from("vendor_profiles").upsert(vendors, { onConflict: "id" });
  if (vErr) throw vErr;

  const branches = [BR.mainYard, BR.lakecity, BR.gulfDepot];
  const qty = [
    [22, 18, 14, 20, 25, 10, 8, 6],
    [8, 6, 4, 7, 9, 3, 2, 4],
    [0, 2, 1, 0, 3, 0, 1, 0],
  ];
  const bins = ["A-12", "A-14", "B-04", "B-05", "C-01", "C-02", "D-08", "D-09"];
  const inv: Record<string, unknown>[] = [];
  let idx = 0;
  for (let b = 0; b < 3; b++) {
    for (let p = 0; p < 8; p++) {
      inv.push({
        id: SP.partsInventory[idx],
        workspace_id: WS,
        branch_id: branches[b],
        part_number: PARTS[p],
        qty_on_hand: qty[b][p],
        bin_location: bins[p],
      });
      idx++;
    }
  }
  const { error: piErr } = await admin.from("parts_inventory").upsert(inv, { onConflict: "id" });
  if (piErr) throw piErr;

  const jobs = [
    {
      id: J.j1,
      workspace_id: WS,
      branch_id: BR.mainYard,
      customer_id: ids.companies.apexHoldings,
      contact_id: ids.contacts.mason,
      machine_id: ids.equipment.apexDozer,
      source_type: "walk_in",
      request_type: "repair",
      priority: "critical",
      current_stage: "parts_pending",
      status_flags: ["machine_down", "customer_pay"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo job — parts queue",
      current_stage_entered_at: now,
    },
    {
      id: J.j2,
      workspace_id: WS,
      branch_id: BR.lakecity,
      customer_id: ids.companies.apexLakeCity,
      contact_id: ids.contacts.hannah,
      machine_id: ids.equipment.apexMulcher,
      source_type: "call",
      request_type: "pm_service",
      priority: "normal",
      current_stage: "quote_sent",
      status_flags: ["shop_job"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo PM quote",
      current_stage_entered_at: now,
    },
    {
      id: J.j3,
      workspace_id: WS,
      branch_id: BR.gulfDepot,
      customer_id: ids.companies.gulfCoast,
      contact_id: ids.contacts.jordan,
      machine_id: null,
      source_type: "field_tech",
      request_type: "repair",
      priority: "urgent",
      current_stage: "triaging",
      status_flags: ["field_job", "waiting_vendor"],
      advisor_id: rep,
      shop_or_field: "field",
      haul_required: false,
      customer_problem_summary: "Demo field vendor path",
      current_stage_entered_at: now,
    },
    {
      id: J.j4,
      workspace_id: WS,
      branch_id: BR.mainYard,
      customer_id: ids.companies.pineRiver,
      contact_id: ids.contacts.elena,
      machine_id: ids.equipment.pineSkidSteer,
      source_type: "sales_handoff",
      request_type: "repair",
      priority: "normal",
      current_stage: "in_progress",
      status_flags: ["field_job"],
      advisor_id: rep,
      shop_or_field: "field",
      haul_required: false,
      customer_problem_summary: "Demo in progress",
      current_stage_entered_at: now,
    },
    {
      id: J.j5,
      workspace_id: WS,
      branch_id: BR.lakecity,
      customer_id: ids.companies.apexHoldings,
      contact_id: ids.contacts.mason,
      machine_id: ids.equipment.apexDozer,
      source_type: "walk_in",
      request_type: "inspection",
      priority: "normal",
      current_stage: "diagnosis_selected",
      status_flags: ["shop_job"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo diagnosis",
      current_stage_entered_at: now,
    },
    {
      id: J.j6,
      workspace_id: WS,
      branch_id: BR.gulfDepot,
      customer_id: ids.companies.gulfCoast,
      contact_id: ids.contacts.jordan,
      machine_id: null,
      source_type: "portal",
      request_type: "repair",
      priority: "normal",
      current_stage: "parts_pending",
      status_flags: ["waiting_transfer"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo transfer",
      current_stage_entered_at: now,
    },
    {
      id: J.j7,
      workspace_id: WS,
      branch_id: BR.mainYard,
      customer_id: ids.companies.apexLakeCity,
      contact_id: ids.contacts.hannah,
      machine_id: ids.equipment.apexMulcher,
      source_type: "call",
      request_type: "repair",
      priority: "normal",
      current_stage: "request_received",
      status_flags: ["shop_job"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo intake",
      current_stage_entered_at: now,
    },
    {
      id: J.j8,
      workspace_id: WS,
      branch_id: BR.lakecity,
      customer_id: ids.companies.pineRiver,
      contact_id: ids.contacts.elena,
      machine_id: ids.equipment.pineSkidSteer,
      source_type: "walk_in",
      request_type: "machine_down",
      priority: "critical",
      current_stage: "quote_sent",
      status_flags: ["machine_down"],
      advisor_id: rep,
      shop_or_field: "shop",
      haul_required: false,
      customer_problem_summary: "Demo urgent",
      current_stage_entered_at: now,
    },
  ];
  const { error: jErr } = await admin.from("service_jobs").upsert(jobs, { onConflict: "id" });
  if (jErr) throw jErr;

  const t = {
    overdue: ts({ days: -2, hours: -3 }),
    today: ts({ hours: 2 }),
    future: ts({ days: 3, hours: 4 }),
  };

  const requirements = [
    { id: R[0], job_id: J.j1, part_number: "HYD-FILTER-01", description: "Filter", quantity: 2, unit_cost: 42.5, source: "manual", status: "pending", need_by_date: t.overdue, confidence: "high", vendor_id: V.hydraulic, intake_line_status: "accepted" },
    { id: R[1], job_id: J.j1, part_number: "SEAL-KIT-12", description: "Seals", quantity: 1, source: "job_code_template", status: "picking", need_by_date: t.today, confidence: "medium", vendor_id: null, intake_line_status: "planned" },
    { id: R[2], job_id: J.j2, part_number: "BLADE-EDGE-60", description: "Edge", quantity: 1, source: "manual", status: "staged", need_by_date: t.future, confidence: "manual", vendor_id: null, intake_line_status: "accepted" },
    { id: R[3], job_id: J.j3, part_number: "HYD-FILTER-01", description: "Filter order", quantity: 3, source: "ai_suggested", status: "ordering", need_by_date: t.today, confidence: "low", vendor_id: V.oem, intake_line_status: "accepted" },
    { id: R[4], job_id: J.j4, part_number: "TRACK-PAD-L", description: "Pads", quantity: 4, source: "manual", status: "received", need_by_date: t.future, confidence: "manual", vendor_id: null, intake_line_status: "accepted" },
    { id: R[5], job_id: J.j5, part_number: "COOLANT-5GAL", description: "Coolant", quantity: 2, source: "ai_suggested", status: "pending", need_by_date: t.today, confidence: "medium", vendor_id: null, intake_line_status: "suggested" },
    { id: R[6], job_id: J.j6, part_number: "BELT-FAN-42", description: "Belt", quantity: 1, source: "manual", status: "pending", need_by_date: t.overdue, confidence: "manual", vendor_id: null, intake_line_status: "accepted" },
    { id: R[7], job_id: J.j6, part_number: "BUCKET-TEETH-SET", description: "Teeth", quantity: 1, source: "manual", status: "transferring", need_by_date: t.future, confidence: "manual", vendor_id: V.consumables, intake_line_status: "planned" },
    { id: R[8], job_id: J.j7, part_number: "SEAL-KIT-12", description: "Seals", quantity: 1, source: "manual", status: "pending", need_by_date: t.today, confidence: "manual", vendor_id: null, intake_line_status: "accepted" },
    { id: R[9], job_id: J.j8, part_number: "TRACK-PAD-R", description: "Pad R", quantity: 2, source: "manual", status: "picking", need_by_date: t.overdue, confidence: "manual", vendor_id: null, intake_line_status: "accepted" },
    { id: R[10], job_id: J.j8, part_number: "HYD-FILTER-01", description: "Filter 2", quantity: 1, source: "job_code_template", status: "pending", need_by_date: t.future, confidence: "manual", vendor_id: null, intake_line_status: "accepted" },
    { id: R[11], job_id: J.j2, part_number: "COOLANT-5GAL", description: "Coolant", quantity: 1, source: "manual", status: "pending", need_by_date: t.today, confidence: "manual", vendor_id: V.consumables, intake_line_status: "accepted" },
    { id: R[12], job_id: J.j4, part_number: "BLADE-EDGE-60", description: "Edge", quantity: 1, source: "manual", status: "staged", need_by_date: t.future, confidence: "manual", vendor_id: null, intake_line_status: "accepted" },
    { id: R[13], job_id: J.j1, part_number: "BUCKET-TEETH-SET", description: "Teeth", quantity: 1, source: "manual", status: "pending", need_by_date: t.today, confidence: "manual", vendor_id: null, intake_line_status: "accepted" },
    { id: R[14], job_id: J.j3, part_number: "COOLANT-5GAL", description: "Coolant", quantity: 3, source: "manual", status: "ordering", need_by_date: t.overdue, confidence: "manual", vendor_id: V.oem, intake_line_status: "accepted" },
  ].map((r) => ({ workspace_id: WS, ...r }));

  const { error: rErr } = await admin.from("service_parts_requirements").upsert(requirements, { onConflict: "id" });
  if (rErr) throw rErr;

  const { error: frErr } = await admin.from("parts_fulfillment_runs").upsert(
    [
      { id: SP.fulfillmentRuns.open, workspace_id: WS, status: "open" },
      { id: SP.fulfillmentRuns.submitted, workspace_id: WS, status: "submitted" },
    ],
    { onConflict: "id" },
  );
  if (frErr) throw frErr;

  const events = SP.fulfillmentEvents.map((id, i) => ({
    id,
    workspace_id: WS,
    fulfillment_run_id: i < 3 ? SP.fulfillmentRuns.open : SP.fulfillmentRuns.submitted,
    event_type: ["pick", "stage", "receive", "pick", "ship_notice", "ordered"][i],
    payload: { batch: BATCH, step: i },
  }));
  const { error: feErr } = await admin.from("parts_fulfillment_events").upsert(events, { onConflict: "id" });
  if (feErr) throw feErr;

  const portalRows = [
    {
      id: SP.portalCustomers.manager,
      workspace_id: WS,
      crm_contact_id: ids.contacts.mason,
      crm_company_id: ids.companies.apexHoldings,
      first_name: "Portal",
      last_name: "ManagerSeed",
      email: `portal.manager.seed@${WS}.qep.local`,
      portal_role: "manager",
      is_active: true,
      default_branch: BR.mainYard,
    },
    {
      id: SP.portalCustomers.viewer,
      workspace_id: WS,
      crm_contact_id: ids.contacts.hannah,
      crm_company_id: ids.companies.apexLakeCity,
      first_name: "Portal",
      last_name: "ViewerSeed",
      email: `portal.viewer.seed@${WS}.qep.local`,
      portal_role: "viewer",
      is_active: true,
      default_branch: BR.lakecity,
    },
  ];
  const { error: pcErr } = await admin.from("portal_customers").upsert(portalRows, { onConflict: "id" });
  if (pcErr) throw pcErr;

  const { error: poErr } = await admin.from("parts_orders").upsert(
    [
      {
        id: SP.partsOrders.draft,
        workspace_id: WS,
        portal_customer_id: SP.portalCustomers.viewer,
        status: "draft",
        line_items: [{ part_number: "SEAL-KIT-12", description: "Draft", quantity: 1, unit_price: 120, is_ai_suggested: false }],
        subtotal: 120,
        tax: 0,
        shipping: 0,
        total: 120,
        fulfillment_run_id: null,
      },
      {
        id: SP.partsOrders.submitted,
        workspace_id: WS,
        portal_customer_id: SP.portalCustomers.manager,
        status: "submitted",
        line_items: [{ part_number: "HYD-FILTER-01", description: "Sub", quantity: 2, unit_price: 42.5, is_ai_suggested: false }],
        subtotal: 85,
        tax: 0,
        shipping: 10,
        total: 95,
        fulfillment_run_id: SP.fulfillmentRuns.open,
      },
      {
        id: SP.partsOrders.processing,
        workspace_id: WS,
        portal_customer_id: SP.portalCustomers.manager,
        status: "processing",
        line_items: [{ part_number: "BELT-FAN-42", description: "Proc", quantity: 1, unit_price: 89, is_ai_suggested: false }],
        subtotal: 89,
        tax: 0,
        shipping: 0,
        total: 89,
        fulfillment_run_id: SP.fulfillmentRuns.submitted,
      },
    ],
    { onConflict: "id" },
  );
  if (poErr) throw poErr;

  const { error: ovErr } = await admin.from("service_parts_inventory_overrides").upsert(
    [
      {
        id: SP.inventoryOverrides.o1,
        workspace_id: WS,
        requirement_id: R[13],
        job_id: J.j1,
        part_number: "BUCKET-TEETH-SET",
        quantity_requested: 1,
        qty_on_hand_after: 9,
        insufficient: false,
        reason: "Demo override",
        actor_id: mgr,
      },
      {
        id: SP.inventoryOverrides.o2,
        workspace_id: WS,
        requirement_id: R[0],
        job_id: J.j1,
        part_number: "HYD-FILTER-01",
        quantity_requested: 2,
        qty_on_hand_after: 20,
        insufficient: false,
        reason: "Demo audit",
        actor_id: mgr,
      },
    ],
    { onConflict: "id" },
  );
  if (ovErr) throw ovErr;

  const { error: billErr } = await admin.from("service_internal_billing_line_staging").upsert(
    [
      {
        id: SP.billingStaging.b1,
        workspace_id: WS,
        service_job_id: J.j4,
        requirement_id: R[4],
        line_type: "parts_consume",
        part_number: "TRACK-PAD-L",
        description: "Consumed pads",
        quantity: 4,
        unit_cost: 55,
        status: "draft",
      },
      {
        id: SP.billingStaging.b2,
        workspace_id: WS,
        service_job_id: J.j2,
        requirement_id: R[2],
        line_type: "parts_consume",
        part_number: "BLADE-EDGE-60",
        description: "Staged blade",
        quantity: 1,
        unit_cost: 210,
        status: "draft",
      },
    ],
    { onConflict: "id" },
  );
  if (billErr) throw billErr;

  return { partsInventory: 24, serviceJobs: 8, requirements: 15 };
}
