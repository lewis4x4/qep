#!/usr/bin/env bun
/**
 * Safely purge known demo/seed data while preserving all parts-related rows.
 *
 * Default mode is a dry run. Apply requires both:
 *   bun run intellidealer:seed:purge -- --apply --confirm-non-parts-seed-purge
 *
 * This intentionally refuses to touch any table whose name is parts-related.
 * Rows that are non-parts but still referenced by protected parts data are
 * reported as deferred so we do not trigger FK cascades into parts history.
 */
import {
  BRANCH_MASTER_IDS,
  DEMO_IDS,
  DEMO_USERS,
  SERVICE_DEMO_IDS,
  DEMO_WORKSPACE_ID,
} from "./demo/seed-ids.mjs";

const APPLY_FLAG = "--apply";
const CONFIRM_FLAG = "--confirm-non-parts-seed-purge";

const args = new Set(process.argv.slice(2));
const shouldApply = args.has(APPLY_FLAG);
const isConfirmed = args.has(CONFIRM_FLAG);

const url =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !serviceRoleKey) {
  throw new Error(
    "Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

if (shouldApply && !isConfirmed) {
  throw new Error(
    `Refusing to apply without ${CONFIRM_FLAG}. Run dry-run first and keep a database backup.`,
  );
}

const restBase = `${url.replace(/\/$/, "")}/rest/v1`;
const authHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
};

function flatten(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (typeof value === "object") return Object.values(value).flatMap(flatten);
  return [String(value)];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inFilter(ids) {
  return `in.(${ids.join(",")})`;
}

function eqFilter(value) {
  return `eq.${value}`;
}

function queryUrl(table, filters, extra = {}) {
  const params = new URLSearchParams(extra);
  for (const [column, value] of Object.entries(filters)) {
    params.set(column, value);
  }
  return `${restBase}/${table}?${params.toString()}`;
}

function isMissingTable(errorBody) {
  return (
    errorBody?.code === "PGRST205" ||
    /Could not find the table|relation .* does not exist/i.test(
      errorBody?.message ?? "",
    )
  );
}

async function requestJson(method, table, filters, extra = {}, prefer = "count=exact") {
  const response = await fetch(queryUrl(table, filters, extra), {
    method,
    headers: {
      ...authHeaders,
      Prefer: prefer,
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }

  if (!response.ok) {
    if (isMissingTable(body)) return { missing: true, count: 0, body: [] };
    throw new Error(`${method} ${table} failed: ${body?.message ?? response.statusText}`);
  }

  const range = response.headers.get("content-range") ?? "";
  const count = Number(range.split("/").at(-1));
  return {
    missing: false,
    count: Number.isFinite(count) ? count : Array.isArray(body) ? body.length : 0,
    body: Array.isArray(body) ? body : [],
  };
}

async function countByIds(table, ids) {
  const cleanIds = unique(ids);
  if (cleanIds.length === 0) return { missing: false, count: 0 };
  return requestJson(
    "GET",
    table,
    { id: inFilter(cleanIds) },
    { select: "id", limit: "1" },
  );
}

async function countStep(step) {
  if (step.filters) {
    return requestJson(
      "GET",
      step.table,
      step.filters,
      { select: "id", limit: "1" },
    );
  }
  return countByIds(step.table, step.ids);
}

async function deleteByIds(table, ids) {
  const cleanIds = unique(ids);
  if (cleanIds.length === 0) return { missing: false, count: 0 };
  return requestJson(
    "DELETE",
    table,
    { id: inFilter(cleanIds) },
    { select: "id" },
    "return=representation,count=exact",
  );
}

function assertNotPartsTable(table) {
  if (
    table.startsWith("parts_") ||
    table.includes("_parts_") ||
    table === "vendor_part_catalog" ||
    table === "customer_parts_intelligence"
  ) {
    throw new Error(`Protected parts table refused: ${table}`);
  }
}

const crmDemoCompanyIds = flatten(DEMO_IDS.companies);
const crmDemoContactIds = flatten(DEMO_IDS.contacts);
const crmDemoDealIds = flatten(DEMO_IDS.deals);
const buPulseRentalContractIds = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `53000000-0000-7000-8000-0000000003${n}`;
});

const purgePlan = [
  {
    table: "crm_hubspot_import_errors",
    ids: flatten(DEMO_IDS.hubspotImportErrors),
  },
  {
    table: "crm_hubspot_import_runs",
    ids: flatten(DEMO_IDS.hubspotImportRuns),
  },
  {
    table: "crm_activity_templates",
    ids: flatten(DEMO_IDS.activityTemplates),
  },
  {
    table: "crm_duplicate_candidates",
    ids: flatten(DEMO_IDS.duplicateCandidates),
  },
  {
    table: "quotes",
    ids: flatten(DEMO_IDS.quotes),
  },
  {
    table: "crm_activities",
    ids: flatten(DEMO_IDS.activities),
  },
  {
    table: "crm_custom_field_values",
    ids: flatten(DEMO_IDS.customFieldValues),
  },
  {
    table: "crm_custom_field_definitions",
    ids: flatten(DEMO_IDS.customFieldDefinitions),
  },
  {
    table: "crm_contact_territories",
    ids: flatten(DEMO_IDS.contactTerritories),
  },
  {
    table: "crm_contact_companies",
    ids: flatten(DEMO_IDS.contactCompanies),
  },
  {
    table: "crm_territories",
    ids: flatten(DEMO_IDS.territories),
  },
  {
    table: "crm_deals",
    ids: crmDemoDealIds,
  },
  {
    table: "crm_contacts",
    ids: crmDemoContactIds,
  },
  {
    table: "customer_deal_history",
    ids: [
      "62000000-0000-4000-8000-000000000001",
      "62000000-0000-4000-8000-000000000002",
    ],
  },
  {
    table: "customer_profiles_extended",
    ids: flatten(DEMO_IDS.customerProfiles),
  },
  {
    table: "rental_contracts",
    ids: buPulseRentalContractIds,
  },
  {
    table: "crm_equipment",
    ids: [
      ...flatten(DEMO_IDS.equipment),
      "e6000000-0000-4000-8000-000000000001",
    ],
  },
  {
    table: "vendor_escalations",
    ids: [SERVICE_DEMO_IDS.vendorEscalation],
  },
  {
    table: "vendor_escalation_policies",
    ids: [SERVICE_DEMO_IDS.vendorEscalationPolicy],
  },
];

const deferredBecausePartsReferenceThem = [
  {
    table: "crm_companies",
    ids: [...crmDemoCompanyIds, "e5000000-0000-4000-8000-000000000001"],
    reason:
      "protected parts_orders, parts_predictive_kits, and customer_parts_intelligence can reference demo companies",
  },
  {
    table: "portal_customers",
    ids: [...flatten(SERVICE_DEMO_IDS.portalCustomers), "a1000000-0000-4000-8000-000000000001"],
    reason: "parts_orders.portal_customer_id is an on-delete-cascade relationship",
  },
  {
    table: "service_jobs",
    ids: [
      ...flatten(SERVICE_DEMO_IDS.jobs),
      SERVICE_DEMO_IDS.scenarioMachineDownJob,
      SERVICE_DEMO_IDS.scenarioTransferJob,
      "d4000000-0000-4000-8000-000000000001",
    ],
    reason: "service_parts_requirements is parts-related and cascades from service_jobs",
  },
  {
    table: "vendor_profiles",
    ids: flatten(SERVICE_DEMO_IDS.vendors),
    reason: "vendor_part_catalog is protected parts data",
  },
  {
    table: "service_branch_config",
    ids: flatten(SERVICE_DEMO_IDS.branchConfig),
    reason: "branch config carries parts-counter operating data",
  },
  {
    table: "branches",
    ids: flatten(BRANCH_MASTER_IDS),
    reason: "parts_inventory branch slugs depend on the seeded branch directory",
  },
  {
    table: "profiles",
    ids: flatten(DEMO_USERS.map((user) => user.id)),
    reason: "protected parts order events and branch config may still reference seeded users",
  },
];

const protectedPartsSnapshot = [
  { table: "parts_inventory", ids: [...SERVICE_DEMO_IDS.partsInventory, ...SERVICE_DEMO_IDS.partsInventoryMainBranch] },
  { table: "parts_catalog", ids: SERVICE_DEMO_IDS.partsCatalog },
  { table: "parts_orders", ids: [...flatten(SERVICE_DEMO_IDS.partsOrders), ...flatten(SERVICE_DEMO_IDS.internalPartsOrders), SERVICE_DEMO_IDS.voiceOrder, "c3000000-0000-4000-8000-000000000001"] },
  { table: "parts_order_lines", ids: [...SERVICE_DEMO_IDS.partsOrderLines, ...SERVICE_DEMO_IDS.voiceOrderLines] },
  { table: "parts_fulfillment_runs", ids: flatten(SERVICE_DEMO_IDS.fulfillmentRuns) },
  { table: "parts_fulfillment_events", ids: SERVICE_DEMO_IDS.fulfillmentEvents },
  { table: "parts_reorder_profiles", ids: SERVICE_DEMO_IDS.reorderProfiles },
  { table: "parts_cross_references", ids: SERVICE_DEMO_IDS.crossReferences },
  { table: "parts_demand_forecasts", ids: SERVICE_DEMO_IDS.demandForecasts },
  { table: "parts_replenishment_rules", ids: [SERVICE_DEMO_IDS.replenishRule] },
  { table: "parts_auto_replenish_queue", ids: SERVICE_DEMO_IDS.replenishQueue },
  { table: "parts_order_events", ids: SERVICE_DEMO_IDS.orderEvents },
  { table: "parts_transfer_recommendations", ids: SERVICE_DEMO_IDS.transferRecs },
  { table: "parts_analytics_snapshots", filters: { workspace_id: eqFilter(DEMO_WORKSPACE_ID) } },
  { table: "parts_predictive_kits", ids: SERVICE_DEMO_IDS.predictiveKits },
  { table: "vendor_part_catalog", ids: SERVICE_DEMO_IDS.vendorPartCatalog },
  { table: "customer_parts_intelligence", ids: SERVICE_DEMO_IDS.customerIntel },
  { table: "service_parts_requirements", ids: SERVICE_DEMO_IDS.requirements },
  { table: "service_parts_inventory_overrides", ids: flatten(SERVICE_DEMO_IDS.inventoryOverrides) },
];

for (const step of purgePlan) assertNotPartsTable(step.table);
for (const step of deferredBecausePartsReferenceThem) assertNotPartsTable(step.table);

console.log(
  `${shouldApply ? "APPLY" : "DRY RUN"} non-parts seed purge for workspace "${DEMO_WORKSPACE_ID}".`,
);
console.log("Protected parts tables are counted only and will not be deleted.");

console.log("\nPurge candidates:");
let purgeTotal = 0;
for (const step of purgePlan) {
  const result = await countStep(step);
  purgeTotal += result.count;
  const suffix = result.missing ? " (table missing; skipped)" : "";
  console.log(`  ${step.table}: ${result.count}${suffix}`);
}

console.log("\nDeferred because protected parts rows can reference/cascade from them:");
for (const step of deferredBecausePartsReferenceThem) {
  const result = await countStep(step);
  const suffix = result.missing ? " (table missing; skipped)" : "";
  console.log(`  ${step.table}: ${result.count}${suffix} - ${step.reason}`);
}

console.log("\nProtected parts snapshot:");
let protectedTotal = 0;
for (const step of protectedPartsSnapshot) {
  const result = await countStep(step);
  protectedTotal += result.count;
  const suffix = result.missing ? " (table missing; skipped)" : "";
  console.log(`  ${step.table}: ${result.count}${suffix}`);
}

if (!shouldApply) {
  console.log(
    `\nDry run complete. ${purgeTotal} known non-parts seed rows are eligible for deletion; ${protectedTotal} known parts rows are protected.`,
  );
  console.log(
    `To apply: bun run intellidealer:seed:purge -- ${APPLY_FLAG} ${CONFIRM_FLAG}`,
  );
  process.exit(0);
}

console.log("\nDeleting eligible non-parts seed rows:");
for (const step of purgePlan) {
  const result = await deleteByIds(step.table, step.ids);
  const suffix = result.missing ? " (table missing; skipped)" : "";
  console.log(`  ${step.table}: ${result.count} deleted${suffix}`);
}

console.log("\nPost-delete protected parts snapshot:");
for (const step of protectedPartsSnapshot) {
  const result = await countStep(step);
  const suffix = result.missing ? " (table missing; skipped)" : "";
  console.log(`  ${step.table}: ${result.count}${suffix}`);
}

console.log("\nPurge complete. Deferred rows require parts remap or explicit follow-up policy before removal.");
