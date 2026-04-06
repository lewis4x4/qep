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
const IPO = SERVICE_DEMO_IDS.internalPartsOrders;
const CAT = SERVICE_DEMO_IDS.partsCatalog;

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
        catalog_id: CAT[p],
      });
      idx += 1;
    }
  }
  return rows;
}

/** Branch id `main` — matches common manual smoke tests / screenshots. */
function mainBranchInventoryRows() {
  const partIdx = [0, 1, 7];
  const qty = [14, 6, 11];
  const bins = ["A1-B2", "C-09", "D-01"];
  return partIdx.map((p, i) => ({
    id: SERVICE_DEMO_IDS.partsInventoryMainBranch[i],
    workspace_id: DEMO_WORKSPACE_ID,
    branch_id: "main",
    part_number: SEED_PART_NUMBERS[p],
    qty_on_hand: qty[i],
    bin_location: bins[i],
    catalog_id: CAT[p],
  }));
}

function catalogRows() {
  const descriptions = [
    "Primary hydraulic filter element",
    "Cylinder seal kit",
    "Left track pad",
    "Right track pad",
    "Cutting edge 60 in",
    "Bucket teeth set (4)",
    "Engine coolant — 5 gal",
    "Serpentine fan belt 42 in",
  ];
  const categories = [
    "Hydraulics",
    "Hydraulics",
    "Undercarriage",
    "Undercarriage",
    "Ground engaging",
    "Ground engaging",
    "Fluids",
    "Belts & drives",
  ];
  const manufacturers = ["Hydac", "Parker", "CAT", "CAT", "Hensley", "Hensley", "Peak", "Gates"];
  const list = [89.99, 210, 120, 120, 450, 380, 42, 45];
  const cost = [52, 125, 72, 72, 260, 220, 22, 24];
  return SEED_PART_NUMBERS.map((pn, i) => ({
    id: CAT[i],
    workspace_id: DEMO_WORKSPACE_ID,
    part_number: pn,
    description: descriptions[i],
    category: categories[i],
    manufacturer: manufacturers[i],
    list_price: list[i],
    cost_price: cost[i],
    is_active: true,
  }));
}

function internalPartsOrderRows() {
  const rep = DEMO_USERS.find((u) => u.key === "rep_primary").id;
  return [
    {
      id: IPO.draft,
      workspace_id: DEMO_WORKSPACE_ID,
      portal_customer_id: null,
      crm_company_id: DEMO_IDS.companies.apexHoldings,
      order_source: "counter",
      status: "draft",
      created_by: rep,
      notes: "Demo seed: walk-in — customer reviewing quote",
      line_items: [
        {
          part_number: "HYD-FILTER-01",
          description: "Hydraulic filter",
          quantity: 2,
          unit_price: 42.5,
          is_ai_suggested: false,
        },
        {
          part_number: "COOLANT-5GAL",
          description: "Coolant pail",
          quantity: 1,
          unit_price: 42,
          is_ai_suggested: false,
        },
      ],
      subtotal: 127,
      tax: 0,
      shipping: 0,
      total: 127,
      fulfillment_run_id: null,
    },
    {
      id: IPO.submitted,
      workspace_id: DEMO_WORKSPACE_ID,
      portal_customer_id: null,
      crm_company_id: DEMO_IDS.companies.gulfCoast,
      order_source: "phone",
      status: "submitted",
      created_by: rep,
      notes: "Demo seed: phone order — will-call at Gulf depot",
      line_items: [
        {
          part_number: "TRACK-PAD-L",
          description: "Left track pad",
          quantity: 2,
          unit_price: 155,
          is_ai_suggested: false,
        },
        {
          part_number: "SEAL-KIT-12",
          description: "Cylinder seal kit",
          quantity: 1,
          unit_price: 210,
          is_ai_suggested: false,
        },
      ],
      subtotal: 520,
      tax: 0,
      shipping: 0,
      total: 520,
      fulfillment_run_id: FR.picking,
    },
    {
      id: IPO.confirmed,
      workspace_id: DEMO_WORKSPACE_ID,
      portal_customer_id: null,
      crm_company_id: DEMO_IDS.companies.pineRiver,
      order_source: "counter",
      status: "confirmed",
      created_by: rep,
      notes: "Demo seed: counter sale — ready for warehouse pick",
      line_items: [
        {
          part_number: "BELT-FAN-42",
          description: "Fan belt",
          quantity: 3,
          unit_price: 45,
          is_ai_suggested: false,
        },
      ],
      subtotal: 135,
      tax: 0,
      shipping: 0,
      total: 135,
      fulfillment_run_id: FR.ordered,
    },
  ];
}

function internalOrderLineRows() {
  const POL = SERVICE_DEMO_IDS.partsOrderLines;
  return [
    {
      id: POL[0],
      parts_order_id: IPO.draft,
      catalog_item_id: CAT[0],
      part_number: "HYD-FILTER-01",
      description: "Hydraulic filter",
      quantity: 2,
      unit_price: 42.5,
      line_total: 85,
      sort_order: 0,
    },
    {
      id: POL[1],
      parts_order_id: IPO.draft,
      catalog_item_id: CAT[6],
      part_number: "COOLANT-5GAL",
      description: "Coolant pail",
      quantity: 1,
      unit_price: 42,
      line_total: 42,
      sort_order: 1,
    },
    {
      id: POL[2],
      parts_order_id: IPO.submitted,
      catalog_item_id: CAT[2],
      part_number: "TRACK-PAD-L",
      description: "Left track pad",
      quantity: 2,
      unit_price: 155,
      line_total: 310,
      sort_order: 0,
    },
    {
      id: POL[3],
      parts_order_id: IPO.submitted,
      catalog_item_id: CAT[1],
      part_number: "SEAL-KIT-12",
      description: "Cylinder seal kit",
      quantity: 1,
      unit_price: 210,
      line_total: 210,
      sort_order: 1,
    },
    {
      id: POL[4],
      parts_order_id: IPO.confirmed,
      catalog_item_id: CAT[7],
      part_number: "BELT-FAN-42",
      description: "Fan belt",
      quantity: 3,
      unit_price: 45,
      line_total: 135,
      sort_order: 0,
    },
  ];
}

function crossReferenceRows() {
  const XR = SERVICE_DEMO_IDS.crossReferences;
  return [
    {
      id: XR[0],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number_a: "TRACK-PAD-L",
      part_number_b: "TRACK-PAD-R",
      relationship: "interchangeable",
      confidence: 0.85,
      source: "field_verified",
      fitment_notes: "Left/right pads are mirror images; interchangeable on symmetric undercarriages",
      price_delta: 0,
    },
    {
      id: XR[1],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number_a: "HYD-FILTER-01",
      part_number_b: "HYD-FILTER-01A",
      relationship: "aftermarket_equivalent",
      confidence: 0.92,
      source: "vendor_catalog",
      fitment_notes: "Aftermarket equivalent; 5μ vs 7μ filtration — acceptable for standard duty",
      price_delta: -12.50,
      lead_time_delta_days: -3,
    },
    {
      id: XR[2],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number_a: "SEAL-KIT-12",
      part_number_b: "SEAL-KIT-12B",
      relationship: "supersedes",
      confidence: 0.98,
      source: "oem_bulletin",
      fitment_notes: "OEM supersession bulletin Q3-2025; improved gasket material for high-temp operation",
      price_delta: 15.00,
    },
    {
      id: XR[3],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number_a: "BLADE-EDGE-60",
      part_number_b: "BLADE-EDGE-60-HD",
      relationship: "oem_equivalent",
      confidence: 0.90,
      source: "manual",
      fitment_notes: "Heavy-duty variant; same mounting pattern, thicker steel — recommended for rocky terrain",
      price_delta: 35.00,
      lead_time_delta_days: 5,
    },
    {
      id: XR[4],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number_a: "COOLANT-5GAL",
      part_number_b: "COOLANT-1GAL",
      relationship: "kit_parent",
      confidence: 0.99,
      source: "manual",
      fitment_notes: "5-gallon pail = 5× 1-gallon jugs; break down for partial fills",
      price_delta: -85.00,
    },
    {
      id: XR[5],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number_a: "BELT-FAN-42",
      part_number_b: "BELT-FAN-42X",
      relationship: "aftermarket_equivalent",
      confidence: 0.88,
      source: "vendor_catalog",
      fitment_notes: "Extended-life aftermarket belt; kevlar-reinforced — 2x rated service hours",
      price_delta: 8.00,
      lead_time_delta_days: -1,
    },
    {
      id: XR[6],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number_a: "BUCKET-TEETH-SET",
      part_number_b: "BUCKET-TEETH-SINGLE",
      relationship: "kit_parent",
      confidence: 0.99,
      source: "manual",
      fitment_notes: "Set contains 5 individual teeth; buy singles for partial replacement",
      price_delta: -95.00,
    },
    {
      id: XR[7],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number_a: "HYD-FILTER-01",
      part_number_b: "SEAL-KIT-12",
      relationship: "kit_component",
      confidence: 0.75,
      source: "ai_extracted",
      fitment_notes: "Commonly ordered together for hydraulic system PM; filter + seal kit combo",
      price_delta: 167.50,
    },
  ];
}

function demandForecastRows() {
  const DF = SERVICE_DEMO_IDS.demandForecasts;
  const branches = [SEED_BRANCHES.mainYard, SEED_BRANCHES.lakecity, SEED_BRANCHES.gulfDepot];
  const baseQty = [14, 4, 8, 7, 2, 1, 25, 5];
  const seasonalFactors = [1.0, 1.15, 1.3]; // month 1, 2, 3
  const now = new Date();
  const rows = [];
  let idx = 0;
  for (let m = 0; m < 3; m++) {
    const forecastDate = new Date(now.getFullYear(), now.getMonth() + 1 + m, 1);
    const monthStr = forecastDate.toISOString().slice(0, 10);
    for (let b = 0; b < branches.length; b++) {
      const branchFactor = [1.0, 0.4, 0.15][b];
      for (let p = 0; p < SEED_PART_NUMBERS.length; p++) {
        if (idx >= DF.length) break;
        const predicted = Math.round(baseQty[p] * branchFactor * seasonalFactors[m] * 100) / 100;
        const sd = Math.round(predicted * 0.3 * 100) / 100;
        const confLow = Math.max(0, Math.round((predicted - sd) * 100) / 100);
        const confHigh = Math.round((predicted + sd) * 100) / 100;
        const onHand = [22, 18, 14, 20, 25, 10, 8, 6][p] * [1, 0.4, 0.15][b];
        const risk =
          onHand <= 0 ? "critical" :
          onHand < predicted * 0.5 ? "critical" :
          onHand < predicted ? "high" :
          onHand < predicted * 1.5 ? "medium" : "low";
        rows.push({
          id: DF[idx],
          workspace_id: DEMO_WORKSPACE_ID,
          part_number: SEED_PART_NUMBERS[p],
          branch_id: branches[b],
          forecast_month: monthStr,
          predicted_qty: predicted,
          confidence_low: confLow,
          confidence_high: confHigh,
          qty_on_hand_at_forecast: Math.round(onHand),
          reorder_point_at_forecast: null,
          stockout_risk: risk,
          drivers: {
            order_history: Math.ceil(Math.random() * 8) + 1,
            base_velocity_per_month: predicted,
            seasonal_factor: seasonalFactors[m],
            fleet_uplift_factor: p < 2 ? 1.15 : 1.0,
            monthly_std_dev: sd,
          },
          model_version: "v1_weighted_avg",
          computation_batch_id: "demo-seed",
          computed_at: new Date().toISOString(),
        });
        idx++;
      }
    }
  }
  return rows;
}

function reorderProfileRows() {
  const RP = SERVICE_DEMO_IDS.reorderProfiles;
  const branches = [SEED_BRANCHES.mainYard, SEED_BRANCHES.lakecity, SEED_BRANCHES.gulfDepot];
  const velocities = [1.2, 0.3, 0.8, 0.7, 0.15, 0.1, 2.5, 0.4];
  const leadTimes = [5, 7, 10, 10, 14, 3, 2, 5];
  const rows = [];
  let idx = 0;
  for (let b = 0; b < branches.length; b++) {
    const branchFactor = [1.0, 0.4, 0.15][b];
    for (let p = 0; p < SEED_PART_NUMBERS.length; p++) {
      if (idx >= RP.length) break;
      const vel = Math.round(velocities[p] * branchFactor * 10000) / 10000;
      const lt = leadTimes[p];
      const demandDuringLead = vel * lt;
      const safetyStock = Math.ceil(1.65 * Math.sqrt(lt * Math.pow(vel * 0.3, 2) + Math.pow(vel, 2) * 4));
      const rop = Math.ceil(demandDuringLead + safetyStock);
      const annualDemand = vel * 365;
      const unitCost = [42.5, 210, 155, 155, 85, 120, 28, 45][p];
      const eoq = Math.max(1, Math.round(Math.sqrt((2 * annualDemand * 25) / (unitCost * 0.25))));
      const consumed = Math.round(vel * 90);
      rows.push({
        id: RP[idx],
        workspace_id: DEMO_WORKSPACE_ID,
        branch_id: branches[b],
        part_number: SEED_PART_NUMBERS[p],
        consumption_velocity: vel,
        velocity_window_days: 90,
        total_consumed: consumed,
        avg_lead_time_days: lt,
        lead_time_std_dev: 2,
        safety_stock: safetyStock,
        reorder_point: rop,
        economic_order_qty: eoq,
        safety_factor: 1.65,
        last_computed_at: new Date().toISOString(),
        next_compute_at: new Date(Date.now() + 86_400_000).toISOString(),
        computation_source: "cron_compute",
      });
      idx++;
    }
  }
  return rows;
}

// ── Wave 3: Field Intelligence seed data ─────────────────────────────────────

function predictiveKitRows() {
  const PK = SERVICE_DEMO_IDS.predictiveKits;
  return [
    {
      id: PK[0],
      workspace_id: DEMO_WORKSPACE_ID,
      fleet_id: null,
      crm_company_id: DEMO_IDS.companies.apexHoldings,
      equipment_make: "Caterpillar",
      equipment_model: "320 Excavator",
      equipment_serial: "CAT320-001",
      current_hours: 4800,
      service_interval_hours: 5000,
      predicted_service_window: "~25d (~200h remaining)",
      predicted_failure_type: "undercarriage_overhaul",
      confidence: 0.85,
      kit_parts: [
        { part_number: "TRACK-PAD-L", description: "Left track pad", quantity: 2, unit_cost: 155, in_stock: true, branch_id: SEED_BRANCHES.mainYard, qty_available: 8 },
        { part_number: "TRACK-PAD-R", description: "Right track pad", quantity: 2, unit_cost: 155, in_stock: true, branch_id: SEED_BRANCHES.mainYard, qty_available: 6 },
        { part_number: "SEAL-KIT-12", description: "Track adjuster seal kit", quantity: 1, unit_cost: 210, in_stock: true, branch_id: SEED_BRANCHES.mainYard, qty_available: 3 },
      ],
      kit_value: 830,
      kit_part_count: 3,
      nearest_branch_id: SEED_BRANCHES.mainYard,
      stock_status: "all_in_stock",
      parts_in_stock: 3,
      parts_total: 3,
      status: "suggested",
      expires_at: buildTimestamp({ days: 30 }),
      model_version: "v1",
      computation_batch_id: "demo-seed",
      drivers: { fleet_hours: 4800, service_interval: 5000, failure_type: "undercarriage_overhaul" },
    },
    {
      id: PK[1],
      workspace_id: DEMO_WORKSPACE_ID,
      fleet_id: null,
      crm_company_id: DEMO_IDS.companies.apexLakeCity,
      equipment_make: "Komatsu",
      equipment_model: "PC200 Excavator",
      equipment_serial: "KOM-PC200-042",
      current_hours: 2900,
      service_interval_hours: 3000,
      predicted_service_window: "~12d (~100h remaining)",
      predicted_failure_type: "hydraulic_service",
      confidence: 0.78,
      kit_parts: [
        { part_number: "HYD-FILTER-01", description: "Hydraulic filter", quantity: 3, unit_cost: 42.5, in_stock: true, branch_id: SEED_BRANCHES.lakecity, qty_available: 5 },
        { part_number: "SEAL-KIT-12", description: "Hydraulic cylinder seal kit", quantity: 2, unit_cost: 210, in_stock: false, branch_id: null, qty_available: 0 },
      ],
      kit_value: 547.5,
      kit_part_count: 2,
      nearest_branch_id: SEED_BRANCHES.lakecity,
      stock_status: "partial",
      parts_in_stock: 1,
      parts_total: 2,
      status: "suggested",
      expires_at: buildTimestamp({ days: 30 }),
      model_version: "v1",
      computation_batch_id: "demo-seed",
      drivers: { fleet_hours: 2900, service_interval: 3000, failure_type: "hydraulic_service" },
    },
    {
      id: PK[2],
      workspace_id: DEMO_WORKSPACE_ID,
      fleet_id: null,
      crm_company_id: DEMO_IDS.companies.apexHoldings,
      equipment_make: "Caterpillar",
      equipment_model: "D6 Dozer",
      equipment_serial: "CAT-D6-118",
      current_hours: 3200,
      service_interval_hours: 3500,
      predicted_service_window: "~37d (~300h remaining)",
      predicted_failure_type: "blade_edge_replacement",
      confidence: 0.72,
      kit_parts: [
        { part_number: "BLADE-EDGE-60", description: "Blade edge 60cm", quantity: 4, unit_cost: 85, in_stock: true, branch_id: SEED_BRANCHES.mainYard, qty_available: 3 },
        { part_number: "BUCKET-TEETH-SET", description: "End bit teeth", quantity: 1, unit_cost: 120, in_stock: true, branch_id: SEED_BRANCHES.mainYard, qty_available: 2 },
      ],
      kit_value: 460,
      kit_part_count: 2,
      nearest_branch_id: SEED_BRANCHES.mainYard,
      stock_status: "all_in_stock",
      parts_in_stock: 2,
      parts_total: 2,
      status: "suggested",
      expires_at: buildTimestamp({ days: 30 }),
      model_version: "v1",
      computation_batch_id: "demo-seed",
      drivers: { fleet_hours: 3200, service_interval: 3500, failure_type: "blade_edge_replacement" },
    },
    {
      id: PK[3],
      workspace_id: DEMO_WORKSPACE_ID,
      fleet_id: null,
      crm_company_id: DEMO_IDS.companies.apexLakeCity,
      equipment_make: "Yanmar",
      equipment_model: "ViO55",
      equipment_serial: "YAN-V55-007",
      current_hours: 1050,
      service_interval_hours: 1000,
      predicted_service_window: "Overdue (50h past interval)",
      predicted_failure_type: "preventive_maintenance",
      confidence: 0.92,
      kit_parts: [
        { part_number: "HYD-FILTER-01", description: "Hydraulic filter", quantity: 1, unit_cost: 42.5, in_stock: true, branch_id: SEED_BRANCHES.lakecity, qty_available: 5 },
        { part_number: "BELT-FAN-42", description: "Fan belt 42\"", quantity: 1, unit_cost: 45, in_stock: true, branch_id: SEED_BRANCHES.lakecity, qty_available: 3 },
        { part_number: "COOLANT-5GAL", description: "Coolant 5 gallon", quantity: 1, unit_cost: 28, in_stock: true, branch_id: SEED_BRANCHES.lakecity, qty_available: 10 },
      ],
      kit_value: 115.5,
      kit_part_count: 3,
      nearest_branch_id: SEED_BRANCHES.lakecity,
      stock_status: "all_in_stock",
      parts_in_stock: 3,
      parts_total: 3,
      status: "suggested",
      expires_at: buildTimestamp({ days: 30 }),
      model_version: "v1",
      computation_batch_id: "demo-seed",
      drivers: { fleet_hours: 1050, service_interval: 1000, failure_type: "preventive_maintenance" },
    },
  ];
}

function voiceOrderSeedRows() {
  const rep = DEMO_USERS.find((u) => u.key === "rep_primary").id;
  const VO = SERVICE_DEMO_IDS.voiceOrder;
  const VOL = SERVICE_DEMO_IDS.voiceOrderLines;
  return {
    order: {
      id: VO,
      workspace_id: DEMO_WORKSPACE_ID,
      crm_company_id: DEMO_IDS.companies.apexHoldings,
      order_source: "voice",
      status: "submitted",
      created_by: rep,
      is_machine_down: true,
      voice_transcript: "I need two left track pads for the Cat 320 at the Henderson site, machine is down. Also need a seal kit.",
      voice_extraction: {
        parts: [
          { description: "left track pads", part_number_guess: "TRACK-PAD-L", quantity: 2, urgency: "machine_down" },
          { description: "seal kit", part_number_guess: "SEAL-KIT-12", quantity: 1, urgency: "machine_down" },
        ],
        equipment_context: { make: "Caterpillar", model: "320", serial: null, location: "Henderson site" },
        is_machine_down: true,
        customer_name: null,
        notes: "Machine down at Henderson site, needs track pads and seal kit urgently.",
      },
      line_items: [
        { part_number: "TRACK-PAD-L", description: "Left track pad", quantity: 2, unit_price: 155, is_ai_suggested: true },
        { part_number: "SEAL-KIT-12", description: "Seal kit", quantity: 1, unit_price: 210, is_ai_suggested: true },
      ],
      notes: "Machine down at Henderson site, needs track pads and seal kit urgently.",
      subtotal: 520,
      tax: 0,
      shipping: 0,
      total: 520,
    },
    lines: [
      { id: VOL[0], parts_order_id: VO, part_number: "TRACK-PAD-L", description: "Left track pad", quantity: 2, unit_price: 155, line_total: 310, sort_order: 0 },
      { id: VOL[1], parts_order_id: VO, part_number: "SEAL-KIT-12", description: "Seal kit", quantity: 1, unit_price: 210, line_total: 210, sort_order: 1 },
    ],
  };
}

// ── Wave 4: Network Optimization + Analytics seed data ───────────────────────

function transferRecRows() {
  const TR = SERVICE_DEMO_IDS.transferRecs;
  return [
    {
      id: TR[0],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "HYD-FILTER-01",
      from_branch_id: SEED_BRANCHES.mainYard,
      to_branch_id: SEED_BRANCHES.lakecity,
      recommended_qty: 8,
      from_qty_on_hand: 15,
      to_qty_on_hand: 1,
      to_reorder_point: 5,
      to_forecast_demand: 12,
      estimated_transfer_cost: 40,
      estimated_stockout_cost_avoided: 960,
      net_savings: 920,
      priority: "critical",
      confidence: 0.92,
      reason: "Surplus of 10 at main-yard, deficit of -11 at lake-city. Net savings: $920",
      status: "pending",
      computation_batch_id: "demo-seed",
      model_version: "v1",
      drivers: { from_surplus: 10, to_deficit: -11, to_demand: 12, to_reorder_point: 5 },
    },
    {
      id: TR[1],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "SEAL-KIT-12",
      from_branch_id: SEED_BRANCHES.lakecity,
      to_branch_id: SEED_BRANCHES.mainYard,
      recommended_qty: 3,
      from_qty_on_hand: 6,
      to_qty_on_hand: 0,
      to_reorder_point: 2,
      to_forecast_demand: 4,
      estimated_transfer_cost: 15,
      estimated_stockout_cost_avoided: 420,
      net_savings: 405,
      priority: "high",
      confidence: 0.85,
      reason: "Surplus of 4 at lake-city, deficit of -4 at main-yard. Net savings: $405",
      status: "pending",
      computation_batch_id: "demo-seed",
      model_version: "v1",
      drivers: { from_surplus: 4, to_deficit: -4, to_demand: 4, to_reorder_point: 2 },
    },
    {
      id: TR[2],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "TRACK-PAD-L",
      from_branch_id: SEED_BRANCHES.mainYard,
      to_branch_id: SEED_BRANCHES.lakecity,
      recommended_qty: 4,
      from_qty_on_hand: 8,
      to_qty_on_hand: 2,
      to_reorder_point: 3,
      to_forecast_demand: 6,
      estimated_transfer_cost: 20,
      estimated_stockout_cost_avoided: 620,
      net_savings: 600,
      priority: "normal",
      confidence: 0.78,
      reason: "Surplus of 5 at main-yard, deficit of -4 at lake-city. Net savings: $600",
      status: "pending",
      computation_batch_id: "demo-seed",
      model_version: "v1",
      drivers: { from_surplus: 5, to_deficit: -4, to_demand: 6, to_reorder_point: 3 },
    },
  ];
}

function customerIntelRows() {
  const CI = SERVICE_DEMO_IDS.customerIntel;
  return [
    {
      id: CI[0],
      workspace_id: DEMO_WORKSPACE_ID,
      crm_company_id: DEMO_IDS.companies.apexHoldings,
      total_spend_12m: 24500,
      total_spend_prior_12m: 18200,
      spend_trend: "growing",
      monthly_spend: [
        { month: "2025-07", revenue: 1800 },
        { month: "2025-08", revenue: 2100 },
        { month: "2025-09", revenue: 1950 },
        { month: "2025-10", revenue: 2400 },
        { month: "2025-11", revenue: 2200 },
        { month: "2025-12", revenue: 1900 },
        { month: "2026-01", revenue: 2600 },
        { month: "2026-02", revenue: 2350 },
        { month: "2026-03", revenue: 2800 },
        { month: "2026-04", revenue: 1200 },
      ],
      order_count_12m: 18,
      avg_order_value: 1361,
      last_order_date: "2026-04-02",
      days_since_last_order: 4,
      fleet_count: 5,
      machines_approaching_service: 2,
      predicted_next_quarter_spend: 7200,
      top_categories: [
        { category: "Undercarriage", revenue: 9800, pct: 40 },
        { category: "Hydraulics", revenue: 7350, pct: 30 },
        { category: "Filters", revenue: 4900, pct: 20 },
      ],
      churn_risk: "none",
      recommended_outreach: "2 machines approaching service interval. Predicted parts need: $7,200 next quarter.",
      opportunity_value: 7200,
      computed_at: new Date().toISOString(),
      computation_batch_id: "demo-seed",
    },
    {
      id: CI[1],
      workspace_id: DEMO_WORKSPACE_ID,
      crm_company_id: DEMO_IDS.companies.apexLakeCity,
      total_spend_12m: 8600,
      total_spend_prior_12m: 12400,
      spend_trend: "declining",
      monthly_spend: [
        { month: "2025-07", revenue: 1200 },
        { month: "2025-08", revenue: 900 },
        { month: "2025-09", revenue: 800 },
        { month: "2025-10", revenue: 700 },
        { month: "2025-11", revenue: 850 },
        { month: "2025-12", revenue: 600 },
        { month: "2026-01", revenue: 750 },
        { month: "2026-02", revenue: 650 },
        { month: "2026-03", revenue: 500 },
      ],
      order_count_12m: 8,
      avg_order_value: 1075,
      last_order_date: "2026-03-15",
      days_since_last_order: 22,
      fleet_count: 3,
      machines_approaching_service: 1,
      predicted_next_quarter_spend: 3200,
      top_categories: [
        { category: "Hydraulics", revenue: 4300, pct: 50 },
        { category: "Filters", revenue: 2580, pct: 30 },
      ],
      churn_risk: "medium",
      recommended_outreach: "Spend declining 31% YoY. 1 machine approaching service. Consider proactive outreach with a bundled kit offer.",
      opportunity_value: 3200,
      computed_at: new Date().toISOString(),
      computation_batch_id: "demo-seed",
    },
  ];
}

function analyticsSnapshotRow() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    workspace_id: DEMO_WORKSPACE_ID,
    snapshot_date: today,
    total_revenue: 33100,
    total_cost: 21515,
    total_margin: 11585,
    order_count: 26,
    line_count: 64,
    revenue_by_category: [
      { category: "Undercarriage", revenue: 12400, cost: 8060, margin: 4340, line_count: 18 },
      { category: "Hydraulics", revenue: 9930, cost: 6455, margin: 3475, line_count: 22 },
      { category: "Filters", revenue: 5290, cost: 3439, margin: 1851, line_count: 14 },
      { category: "Electrical", revenue: 3480, cost: 2262, margin: 1218, line_count: 6 },
      { category: "Blades & Edges", revenue: 2000, cost: 1300, margin: 700, line_count: 4 },
    ],
    revenue_by_branch: [],
    revenue_by_source: [
      { order_source: "counter", revenue: 14200, order_count: 12 },
      { order_source: "portal", revenue: 8900, order_count: 8 },
      { order_source: "phone", revenue: 5500, order_count: 4 },
      { order_source: "voice", revenue: 4500, order_count: 2 },
    ],
    top_customers: [
      { company_id: DEMO_IDS.companies.apexHoldings, company_name: "Apex Holdings", revenue: 24500, order_count: 18 },
      { company_id: DEMO_IDS.companies.apexLakeCity, company_name: "Apex Lake City", revenue: 8600, order_count: 8 },
    ],
    fastest_moving: [
      { part_number: "HYD-FILTER-01", description: "Hydraulic filter", total_qty: 42, total_revenue: 1785 },
      { part_number: "TRACK-PAD-L", description: "Left track pad", total_qty: 18, total_revenue: 2790 },
      { part_number: "SEAL-KIT-12", description: "Seal kit", total_qty: 14, total_revenue: 2940 },
    ],
    slowest_moving: [],
    total_inventory_value: 45200,
    dead_stock_value: 3800,
    dead_stock_count: 12,
    computation_batch_id: "demo-seed",
  };
}

// ── Wave 2: Autonomous Operations seed data ─────────────────────────────────

function replenishRuleRow() {
  const mgr = DEMO_USERS.find((u) => u.key === "manager").id;
  return {
    id: SERVICE_DEMO_IDS.replenishRule,
    workspace_id: DEMO_WORKSPACE_ID,
    is_enabled: true,
    auto_approve_max_dollars: 500,
    daily_budget_cap: 5000,
    approval_user_ids: [mgr],
    vendor_overrides: { "HYD-FILTER-01": V.hydraulic },
    excluded_part_numbers: [],
    cooldown_days: 3,
  };
}

function replenishQueueRows() {
  const RQ = SERVICE_DEMO_IDS.replenishQueue;
  const V_ = SERVICE_DEMO_IDS.vendors;
  return [
    {
      id: RQ[0],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "HYD-FILTER-01",
      branch_id: SEED_BRANCHES.mainYard,
      qty_on_hand: 2,
      reorder_point: 10,
      recommended_qty: 15,
      economic_order_qty: 18,
      selected_vendor_id: V_.hydraulic,
      vendor_score: 0.82,
      vendor_selection_reason: "workspace_vendor_override",
      estimated_unit_cost: 42.5,
      estimated_total: 637.5,
      status: "pending",
      computation_batch_id: "demo-seed",
    },
    {
      id: RQ[1],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "SEAL-KIT-12",
      branch_id: SEED_BRANCHES.lakecity,
      qty_on_hand: 0,
      reorder_point: 4,
      recommended_qty: 6,
      economic_order_qty: 8,
      selected_vendor_id: V_.oem,
      vendor_score: 0.75,
      vendor_selection_reason: "fast_delivery, high_fill_rate",
      estimated_unit_cost: 210,
      estimated_total: 1260,
      status: "pending",
      computation_batch_id: "demo-seed",
    },
    {
      id: RQ[2],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "COOLANT-5GAL",
      branch_id: SEED_BRANCHES.mainYard,
      qty_on_hand: 3,
      reorder_point: 20,
      recommended_qty: 30,
      economic_order_qty: 35,
      selected_vendor_id: V_.consumables,
      vendor_score: 0.68,
      vendor_selection_reason: "competitive_price, responsive",
      estimated_unit_cost: 28,
      estimated_total: 840,
      status: "auto_approved",
      approved_at: buildTimestamp({ days: 0, hours: -2 }),
      computation_batch_id: "demo-seed",
    },
    {
      id: RQ[3],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "BLADE-EDGE-60",
      branch_id: SEED_BRANCHES.gulfDepot,
      qty_on_hand: 1,
      reorder_point: 3,
      recommended_qty: 4,
      economic_order_qty: 5,
      selected_vendor_id: V_.oem,
      vendor_score: 0.71,
      vendor_selection_reason: "preferred, responsive",
      estimated_unit_cost: 85,
      estimated_total: 340,
      status: "auto_approved",
      approved_at: buildTimestamp({ days: 0, hours: -1 }),
      computation_batch_id: "demo-seed",
    },
    {
      id: RQ[4],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "TRACK-PAD-L",
      branch_id: SEED_BRANCHES.mainYard,
      qty_on_hand: 4,
      reorder_point: 8,
      recommended_qty: 10,
      economic_order_qty: 12,
      selected_vendor_id: V_.oem,
      vendor_score: 0.77,
      vendor_selection_reason: "fast_delivery, high_fill_rate",
      estimated_unit_cost: 155,
      estimated_total: 1550,
      status: "pending",
      computation_batch_id: "demo-seed",
    },
    {
      id: RQ[5],
      workspace_id: DEMO_WORKSPACE_ID,
      part_number: "BELT-FAN-42",
      branch_id: SEED_BRANCHES.lakecity,
      qty_on_hand: 1,
      reorder_point: 3,
      recommended_qty: 5,
      economic_order_qty: 6,
      selected_vendor_id: V_.consumables,
      vendor_score: 0.64,
      vendor_selection_reason: "competitive_price",
      estimated_unit_cost: 45,
      estimated_total: 225,
      status: "auto_approved",
      approved_at: buildTimestamp({ days: -1 }),
      computation_batch_id: "demo-seed",
    },
  ];
}

function vendorPartCatalogRows() {
  const VPC = SERVICE_DEMO_IDS.vendorPartCatalog;
  const V_ = SERVICE_DEMO_IDS.vendors;
  return [
    { id: VPC[0], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.hydraulic, part_number: "HYD-FILTER-01", vendor_sku: "HF-001-QEP", unit_cost: 40, lead_time_days: 3, is_preferred: true },
    { id: VPC[1], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.oem, part_number: "HYD-FILTER-01", vendor_sku: "CAT-7W-2326", unit_cost: 52, lead_time_days: 5, is_preferred: false },
    { id: VPC[2], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.oem, part_number: "SEAL-KIT-12", vendor_sku: "CAT-SK-12A", unit_cost: 205, lead_time_days: 7, is_preferred: true },
    { id: VPC[3], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.oem, part_number: "TRACK-PAD-L", vendor_sku: "TP-600L", unit_cost: 150, lead_time_days: 10, is_preferred: true },
    { id: VPC[4], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.oem, part_number: "TRACK-PAD-R", vendor_sku: "TP-600R", unit_cost: 150, lead_time_days: 10, is_preferred: true },
    { id: VPC[5], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.oem, part_number: "BLADE-EDGE-60", vendor_sku: "BE-60CM", unit_cost: 82, lead_time_days: 14, is_preferred: false },
    { id: VPC[6], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.consumables, part_number: "BLADE-EDGE-60", vendor_sku: "BLADE-60-AFM", unit_cost: 65, lead_time_days: 7, is_preferred: true },
    { id: VPC[7], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.oem, part_number: "BUCKET-TEETH-SET", vendor_sku: "BTS-5PC", unit_cost: 118, lead_time_days: 10, is_preferred: true },
    { id: VPC[8], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.consumables, part_number: "COOLANT-5GAL", vendor_sku: "COOL-5G-PEAK", unit_cost: 26, lead_time_days: 2, is_preferred: true },
    { id: VPC[9], workspace_id: DEMO_WORKSPACE_ID, vendor_id: V_.consumables, part_number: "BELT-FAN-42", vendor_sku: "BF-42-GATES", unit_cost: 42, lead_time_days: 3, is_preferred: true },
  ];
}

function orderEventRows() {
  const OE = SERVICE_DEMO_IDS.orderEvents;
  const mgr = DEMO_USERS.find((u) => u.key === "manager").id;
  const rep = DEMO_USERS.find((u) => u.key === "rep_primary").id;
  return [
    { id: OE[0], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: IPO.draft, event_type: "created", source: "manual", actor_id: rep, to_status: "draft", metadata: { order_source: "counter" } },
    { id: OE[1], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: IPO.submitted, event_type: "created", source: "manual", actor_id: rep, to_status: "draft", metadata: { order_source: "phone" } },
    { id: OE[2], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: IPO.submitted, event_type: "submitted", source: "manual", actor_id: rep, from_status: "draft", to_status: "submitted", metadata: {} },
    { id: OE[3], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: IPO.confirmed, event_type: "created", source: "manual", actor_id: mgr, to_status: "draft", metadata: { order_source: "counter" } },
    { id: OE[4], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: IPO.confirmed, event_type: "submitted", source: "manual", actor_id: mgr, from_status: "draft", to_status: "submitted", metadata: {} },
    { id: OE[5], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: IPO.confirmed, event_type: "confirmed", source: "manual", actor_id: mgr, from_status: "submitted", to_status: "confirmed", metadata: {} },
    { id: OE[6], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: PO.submitted, event_type: "created", source: "system", to_status: "draft", metadata: { order_source: "portal" } },
    { id: OE[7], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: PO.submitted, event_type: "submitted", source: "system", from_status: "draft", to_status: "submitted", metadata: {} },
    { id: OE[8], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: PO.shipped, event_type: "shipped", source: "manual", actor_id: mgr, from_status: "processing", to_status: "shipped", metadata: { tracking_number: "DEMO-TRK-001" } },
    { id: OE[9], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: PO.shipped, event_type: "notification_sent", source: "system", metadata: { channel: "email" } },
    { id: OE[10], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: IPO.confirmed, event_type: "pick_completed", source: "manual", actor_id: rep, metadata: { part_number: "HYD-FILTER-01", quantity: 2, branch_id: SEED_BRANCHES.mainYard } },
    { id: OE[11], workspace_id: DEMO_WORKSPACE_ID, parts_order_id: IPO.confirmed, event_type: "delivered", source: "manual", actor_id: mgr, from_status: "shipped", to_status: "delivered", metadata: { delivery_scanned: true } },
  ];
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
      confidence: "manual",
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
      confidence: "medium",
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
      confidence: "medium",
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
      confidence: "medium",
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
      confidence: "high",
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
      confidence: "medium",
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
      confidence: "medium",
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
      confidence: "manual",
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
      confidence: "high",
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
      confidence: "low",
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
        order_source: "portal",
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
        confidence: "high",
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

  const { error: catErr } = await admin.from("parts_catalog").upsert(catalogRows(), {
    onConflict: "id",
  });
  if (catErr) throw catErr;

  const { error: vErr } = await admin.from("vendor_profiles").upsert(vendorRows(), {
    onConflict: "id",
  });
  if (vErr) throw vErr;

  const inv = [...inventoryRows(), ...mainBranchInventoryRows()];
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
      { id: FR.picking, workspace_id: DEMO_WORKSPACE_ID, status: "picking" },
      { id: FR.ordered, workspace_id: DEMO_WORKSPACE_ID, status: "ordered" },
      { id: FR.shipped, workspace_id: DEMO_WORKSPACE_ID, status: "shipped" },
      { id: FR.closed, workspace_id: DEMO_WORKSPACE_ID, status: "closed" },
      { id: FR.cancelled, workspace_id: DEMO_WORKSPACE_ID, status: "cancelled" },
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
        order_source: "portal",
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
        order_source: "portal",
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
        order_source: "portal",
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
      ...internalPartsOrderRows(),
    ],
    { onConflict: "id" },
  );
  if (poErr) throw poErr;

  const { error: linesErr } = await admin
    .from("parts_order_lines")
    .upsert(internalOrderLineRows(), { onConflict: "id" });
  if (linesErr) throw linesErr;

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

  // ── Reorder intelligence profiles (Wave 1A moonshot) ──────────────────
  const reorderRows = reorderProfileRows();
  const { error: rpErr } = await admin
    .from("parts_reorder_profiles")
    .upsert(reorderRows, { onConflict: "workspace_id,branch_id,part_number" });
  if (rpErr) {
    console.warn("parts_reorder_profiles upsert skipped (migration 136 may not be applied):", rpErr.message);
  }

  // ── Cross-references / interchangeability graph (Wave 1C moonshot) ─────
  const xrefRows = crossReferenceRows();
  const { error: xrErr } = await admin
    .from("parts_cross_references")
    .upsert(xrefRows, { onConflict: "id" });
  if (xrErr) {
    console.warn("parts_cross_references upsert skipped (migration 138 may not be applied):", xrErr.message);
  }

  // ── Demand forecasts (Wave 1B moonshot) ───────────────────────────────
  const fcRows = demandForecastRows();
  const { error: dfErr } = await admin
    .from("parts_demand_forecasts")
    .upsert(fcRows, { onConflict: "workspace_id,part_number,branch_id,forecast_month" });
  if (dfErr) {
    console.warn("parts_demand_forecasts upsert skipped (migration 137 may not be applied):", dfErr.message);
  }

  // ── Vendor scoring columns (Wave 2B) ──────────────────────────────────
  const vendorScoreUpdates = [
    { id: V.hydraulic, fill_rate: 0.92, price_competitiveness: 0.78, machine_down_priority: true, composite_score: 0.82, score_computed_at: new Date().toISOString() },
    { id: V.oem, fill_rate: 0.88, price_competitiveness: 0.45, machine_down_priority: true, composite_score: 0.71, score_computed_at: new Date().toISOString() },
    { id: V.consumables, fill_rate: 0.95, price_competitiveness: 0.85, machine_down_priority: false, composite_score: 0.76, score_computed_at: new Date().toISOString() },
  ];
  for (const vu of vendorScoreUpdates) {
    const { error: vuErr } = await admin.from("vendor_profiles").update(vu).eq("id", vu.id);
    if (vuErr) {
      console.warn("vendor_profiles scoring update skipped (migration 139 may not be applied):", vuErr.message);
      break;
    }
  }

  // ── Vendor-part catalog (Wave 2B) ─────────────────────────────────────
  const { error: vpcErr } = await admin
    .from("vendor_part_catalog")
    .upsert(vendorPartCatalogRows(), { onConflict: "id" });
  if (vpcErr) {
    console.warn("vendor_part_catalog upsert skipped (migration 139 may not be applied):", vpcErr.message);
  }

  // ── Replenishment rules (Wave 2A) ─────────────────────────────────────
  const { error: rrErr } = await admin
    .from("parts_replenishment_rules")
    .upsert([replenishRuleRow()], { onConflict: "workspace_id" });
  if (rrErr) {
    console.warn("parts_replenishment_rules upsert skipped (migration 139 may not be applied):", rrErr.message);
  }

  // ── Replenishment queue (Wave 2A) ─────────────────────────────────────
  const { error: rqErr } = await admin
    .from("parts_auto_replenish_queue")
    .upsert(replenishQueueRows(), { onConflict: "id" });
  if (rqErr) {
    console.warn("parts_auto_replenish_queue upsert skipped (migration 139 may not be applied):", rqErr.message);
  }

  // ── Order events audit trail (Wave 2C) ────────────────────────────────
  const { error: oeErr } = await admin
    .from("parts_order_events")
    .upsert(orderEventRows(), { onConflict: "id" });
  if (oeErr) {
    console.warn("parts_order_events upsert skipped (migration 139 may not be applied):", oeErr.message);
  }

  // ── Transfer recommendations (Wave 4A) ─────────────────────────────────
  const { error: trErr } = await admin
    .from("parts_transfer_recommendations")
    .upsert(transferRecRows(), { onConflict: "id" });
  if (trErr) {
    console.warn("parts_transfer_recommendations upsert skipped (migration 141 may not be applied):", trErr.message);
  }

  // ── Analytics snapshot (Wave 4B) ──────────────────────────────────────
  const { error: asErr } = await admin
    .from("parts_analytics_snapshots")
    .upsert([analyticsSnapshotRow()], { onConflict: "workspace_id,snapshot_date" });
  if (asErr) {
    console.warn("parts_analytics_snapshots upsert skipped (migration 141 may not be applied):", asErr.message);
  }

  // ── Customer parts intelligence (Wave 4C) ─────────────────────────────
  const { error: ciErr } = await admin
    .from("customer_parts_intelligence")
    .upsert(customerIntelRows(), { onConflict: "workspace_id,crm_company_id" });
  if (ciErr) {
    console.warn("customer_parts_intelligence upsert skipped (migration 141 may not be applied):", ciErr.message);
  }

  // ── Predictive kits (Wave 3C) ─────────────────────────────────────────
  const { error: pkErr } = await admin
    .from("parts_predictive_kits")
    .upsert(predictiveKitRows(), { onConflict: "id" });
  if (pkErr) {
    console.warn("parts_predictive_kits upsert skipped (migration 140 may not be applied):", pkErr.message);
  }

  // ── Voice order demo (Wave 3A) ────────────────────────────────────────
  const voiceSeed = voiceOrderSeedRows();
  const { error: voErr } = await admin
    .from("parts_orders")
    .upsert([voiceSeed.order], { onConflict: "id" });
  if (voErr) {
    console.warn("voice order upsert skipped (migration 140 may not be applied):", voErr.message);
  } else {
    const { error: volErr } = await admin
      .from("parts_order_lines")
      .upsert(voiceSeed.lines, { onConflict: "id" });
    if (volErr) {
      console.warn("voice order lines upsert skipped:", volErr.message);
    }
  }

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
    inv: [...SERVICE_DEMO_IDS.partsInventory, ...SERVICE_DEMO_IDS.partsInventoryMainBranch],
    vendors: Object.values(V),
    branches: Object.values(SERVICE_DEMO_IDS.branchConfig),
    runs: Object.values(FR),
    events: SERVICE_DEMO_IDS.fulfillmentEvents,
    portal: Object.values(SERVICE_DEMO_IDS.portalCustomers),
    orders: [...Object.values(PO), ...Object.values(IPO)],
    overrides: Object.values(SERVICE_DEMO_IDS.inventoryOverrides),
    billing: Object.values(SERVICE_DEMO_IDS.billingStaging),
  };

  await admin.from("service_internal_billing_line_staging").delete().in("id", ids.billing);
  await admin.from("service_parts_inventory_overrides").delete().in("id", ids.overrides);
  await admin.from("parts_fulfillment_events").delete().in("id", ids.events);
  await admin.from("parts_order_lines").delete().in("id", SERVICE_DEMO_IDS.partsOrderLines);
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
  await admin.from("customer_parts_intelligence").delete().in("id", SERVICE_DEMO_IDS.customerIntel).catch(() => {});
  await admin.from("parts_transfer_recommendations").delete().in("id", SERVICE_DEMO_IDS.transferRecs).catch(() => {});
  await admin.from("parts_analytics_snapshots").delete().eq("workspace_id", DEMO_WORKSPACE_ID).catch(() => {});
  await admin.from("parts_predictive_kits").delete().in("id", SERVICE_DEMO_IDS.predictiveKits).catch(() => {});
  await admin.from("parts_order_lines").delete().in("id", SERVICE_DEMO_IDS.voiceOrderLines).catch(() => {});
  await admin.from("parts_orders").delete().eq("id", SERVICE_DEMO_IDS.voiceOrder).catch(() => {});
  await admin.from("parts_order_events").delete().in("id", SERVICE_DEMO_IDS.orderEvents).catch(() => {});
  await admin.from("parts_auto_replenish_queue").delete().in("id", SERVICE_DEMO_IDS.replenishQueue).catch(() => {});
  await admin.from("parts_replenishment_rules").delete().eq("id", SERVICE_DEMO_IDS.replenishRule).catch(() => {});
  await admin.from("vendor_part_catalog").delete().in("id", SERVICE_DEMO_IDS.vendorPartCatalog).catch(() => {});
  await admin.from("parts_cross_references").delete().in("id", SERVICE_DEMO_IDS.crossReferences).catch(() => {});
  await admin.from("parts_demand_forecasts").delete().in("id", SERVICE_DEMO_IDS.demandForecasts).catch(() => {});
  await admin.from("parts_reorder_profiles").delete().in("id", SERVICE_DEMO_IDS.reorderProfiles).catch(() => {});
  await admin.from("parts_inventory").delete().in("id", ids.inv);
  await admin.from("parts_catalog").delete().in("id", SERVICE_DEMO_IDS.partsCatalog);
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
  profile_workspaces, service_branch_config, parts_catalog, vendor_profiles, parts_inventory,
  service_jobs, service_parts_requirements, parts_fulfillment_runs,
  parts_fulfillment_events, portal_customers, parts_orders, parts_order_lines,
  service_parts_inventory_overrides, service_internal_billing_line_staging,
  parts_reorder_profiles (Wave 1A — dynamic reorder intelligence),
  parts_demand_forecasts (Wave 1B — 90-day demand forecasts),
  parts_cross_references (Wave 1C — interchangeability graph),
  parts_replenishment_rules (Wave 2A — auto-replenish config),
  parts_auto_replenish_queue (Wave 2A — pending replenishment orders),
  vendor_part_catalog (Wave 2B — vendor-to-part mapping),
  parts_order_events (Wave 2C — order audit trail),
  parts_predictive_kits (Wave 3C — predictive failure kits),
  parts_transfer_recommendations (Wave 4A — branch transfers),
  parts_analytics_snapshots (Wave 4B — P&L analytics),
  customer_parts_intelligence (Wave 4C — customer lifecycle intel)

Branches: ${SEED_BRANCHES.mainYard}, ${SEED_BRANCHES.lakecity}, ${SEED_BRANCHES.gulfDepot}, main (extra smoke rows)

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
