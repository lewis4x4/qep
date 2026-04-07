#!/usr/bin/env bun
/**
 * Parts unified model pressure checks (docs + repo guards; optional live Supabase).
 *
 * Always: doc paths, migrations:check, grep-based invariants.
 * Optional: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — light metadata queries.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

let failed = false;

function fail(msg) {
  console.error(msg);
  failed = true;
}

function ok(msg) {
  console.log(msg);
}

function read(path) {
  return readFileSync(path, "utf8");
}

const docs = [
  "docs/architecture/parts-service-unified-spec.md",
  "docs/architecture/parts-service-schema-api.md",
  "docs/testing/parts-service-pressure-matrix.md",
];

for (const rel of docs) {
  const p = join(root, rel);
  if (!existsSync(p)) fail(`MISSING: ${rel}`);
  else ok(`doc: ${rel}`);
}

const m = spawnSync("bun", ["run", "migrations:check"], {
  cwd: root,
  encoding: "utf8",
});
if (m.status !== 0) {
  fail(`migrations:check failed:\n${m.stdout ?? ""}${m.stderr ?? ""}`);
} else ok("migrations:check OK");

function mustContain(fileRel, needle, label) {
  const p = join(root, fileRel);
  if (!existsSync(p)) {
    fail(`${label}: file missing ${fileRel}`);
    return;
  }
  const txt = read(p);
  if (!txt.includes(needle)) {
    fail(`${label}: expected "${needle}" in ${fileRel}`);
  } else ok(`${label}: OK`);
}

mustContain(
  "supabase/functions/portal-api/index.ts",
  "workspaceStaffRecipientIds",
  "portal-api workspace routing",
);
mustContain(
  "supabase/functions/service-parts-manager/index.ts",
  "parts-fulfillment-mirror",
  "manager imports mirror",
);
mustContain(
  "supabase/functions/service-parts-planner/index.ts",
  "parts-fulfillment-mirror",
  "planner imports mirror",
);
mustContain(
  "supabase/functions/service-parts-manager/index.ts",
  "shop_parts_action",
  "manager event type",
);
mustContain(
  "supabase/functions/service-parts-planner/index.ts",
  "shop_parts_plan_batch",
  "planner batch event type",
);

const planner = read(join(root, "supabase/functions/service-parts-planner/index.ts"));
if (!planner.includes("is_machine_down") || !planner.includes("fulfillment_run_id")) {
  fail("planner: expected is_machine_down + fulfillment_run_id in select/wiring");
} else ok("planner: machine-down + run link present");

// §15 vendor ETA / escalation — static wiring (planner uses vendor_profiles.avg_lead_time_hours; escalator seeds from late/missing PO)
if (!planner.includes("avg_lead_time_hours")) {
  fail("planner: expected avg_lead_time_hours for vendor lead / ETA heuristic");
} else ok("planner: vendor ETA (avg_lead_time_hours) present");

mustContain(
  "supabase/functions/service-vendor-escalator/index.ts",
  "seedEscalationsFromLateOrders",
  "escalator seeds late/missing PO",
);
mustContain(
  "supabase/functions/service-vendor-escalator/index.ts",
  "expected_date",
  "escalator uses expected_date for late detection",
);
mustContain(
  "supabase/functions/service-vendor-escalator/index.ts",
  "shop_vendor_escalation_step",
  "escalator fulfillment mirror event",
);
mustContain(
  "supabase/functions/service-vendor-inbound/index.ts",
  "shop_vendor_inbound",
  "vendor inbound fulfillment mirror event",
);
mustContain(
  "supabase/functions/service-vendor-inbound/index.ts",
  "parseVendorInboundContract",
  "vendor inbound structured contract",
);
mustContain(
  "supabase/functions/_shared/parts-fulfillment-mirror.ts",
  "idempotencyKey",
  "fulfillment mirror idempotency",
);
mustContain(
  "supabase/functions/service-vendor-escalator/index.ts",
  "logServiceCronRun",
  "escalator cron observability",
);
mustContain(
  "supabase/functions/_shared/vendor-escalation-resend.ts",
  "RESEND_API_KEY",
  "vendor escalation email uses Resend when configured",
);
mustContain(
  "supabase/functions/_shared/vendor-escalation-resend.ts",
  "api.resend.com",
  "vendor escalation email targets Resend API",
);
mustContain(
  "supabase/functions/service-vendor-escalator/index.ts",
  "vendor-escalation-resend",
  "escalator delegates Resend to shared helper",
);
mustContain(
  "apps/web/src/features/service/hooks/usePartsQueue.ts",
  "fulfillment_run_id",
  "parts queue query embeds fulfillment_run_id",
);
mustContain(
  "apps/web/src/features/service/components/PartsQueueBucket.tsx",
  "/service/fulfillment/",
  "parts queue UI links to fulfillment audit",
);
mustContain(
  "apps/web/src/features/parts/components/PartsSubNav.tsx",
  "/parts/catalog",
  "parts module sub-nav includes catalog",
);
mustContain(
  "supabase/functions/parts-order-manager/index.ts",
  "create_internal_order",
  "parts-order-manager supports internal/counter orders",
);
mustContain(
  "supabase/functions/parts-order-manager/index.ts",
  "advance_status",
  "parts-order-manager supports status transitions",
);
mustContain(
  "supabase/functions/parts-order-manager/index.ts",
  "pick_order_line",
  "parts-order-manager supports inventory pick",
);
mustContain(
  "apps/web/src/features/parts/components/CatalogSearchBar.tsx",
  "onQueryChange",
  "CatalogSearchBar extracted component",
);
mustContain(
  "apps/web/src/features/parts/components/CounterSaleForm.tsx",
  "invokeCreateInternalOrder",
  "CounterSaleForm extracted component",
);
mustContain(
  "apps/web/src/features/parts/components/VendorMetricsCard.tsx",
  "vendor-metrics-summary",
  "VendorMetricsCard on command center",
);
mustContain(
  "apps/web/src/features/service/components/ServicePartsHubStrip.tsx",
  "/parts",
  "ServicePartsHubStrip cross-links to parts module",
);

mustContain(
  "supabase/functions/parts-reorder-compute/index.ts",
  "consumption_velocity",
  "reorder compute calculates consumption velocity",
);
mustContain(
  "supabase/functions/parts-reorder-compute/index.ts",
  "logServiceCronRun",
  "reorder compute cron observability",
);
mustContain(
  "supabase/migrations/136_parts_reorder_profiles.sql",
  "parts_reorder_profiles",
  "reorder profiles migration table",
);
mustContain(
  "supabase/migrations/136_parts_reorder_profiles.sql",
  "parts_inventory_reorder_status",
  "reorder status view in migration",
);
mustContain(
  "apps/web/src/features/parts/hooks/useInventoryHealth.ts",
  "parts_inventory_reorder_status",
  "inventory health uses intelligent view",
);
mustContain(
  "apps/web/src/features/parts/components/InventoryHealthCard.tsx",
  "days_until_stockout",
  "inventory health card shows days to stockout",
);

mustContain(
  "supabase/functions/parts-demand-forecast/index.ts",
  "v1_weighted_avg",
  "demand forecast engine model version",
);
mustContain(
  "supabase/functions/parts-demand-forecast/index.ts",
  "logServiceCronRun",
  "demand forecast cron observability",
);
mustContain(
  "supabase/functions/parts-demand-forecast/index.ts",
  "customer_fleet",
  "demand forecast uses fleet hours signal",
);
mustContain(
  "supabase/migrations/137_parts_demand_forecasts.sql",
  "parts_demand_forecasts",
  "demand forecasts migration table",
);
mustContain(
  "supabase/migrations/137_parts_demand_forecasts.sql",
  "parts_forecast_risk_summary",
  "forecast risk summary view",
);
mustContain(
  "apps/web/src/features/parts/hooks/useDemandForecast.ts",
  "parts_forecast_risk_summary",
  "forecast hook uses risk summary view",
);
mustContain(
  "apps/web/src/features/parts/components/DemandForecastCard.tsx",
  "stockout_risk",
  "forecast card displays stockout risk",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsForecastPage.tsx",
  "parts_forecast_risk_summary",
  "forecast page uses risk summary view",
);
mustContain(
  "apps/web/src/features/parts/components/PartsSubNav.tsx",
  "/parts/forecast",
  "sub-nav includes forecast link",
);

mustContain(
  "supabase/migrations/138_parts_cross_references.sql",
  "parts_cross_references",
  "cross-references migration table",
);
mustContain(
  "supabase/migrations/138_parts_cross_references.sql",
  "find_part_substitutes",
  "cross-references RPC function",
);
mustContain(
  "apps/web/src/features/parts/hooks/useCrossReferences.ts",
  "find_part_substitutes",
  "cross-references hook calls RPC",
);
mustContain(
  "apps/web/src/features/parts/components/PartCrossRefPanel.tsx",
  "useCrossReferences",
  "cross-ref panel uses hook",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsCatalogPage.tsx",
  "PartCrossRefPanel",
  "catalog page shows cross-ref panel",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsOrderDetailPage.tsx",
  "PartCrossRefPanel",
  "order detail shows cross-ref panel",
);
mustContain(
  "apps/web/src/features/parts/components/InventoryHealthCard.tsx",
  "PartCrossRefPanel",
  "inventory health card shows substitutes for stockouts",
);

// ── Wave 2: Autonomous Operations ──────────────────────────────────────────

// 2A: Auto-replenishment schema + engine
mustContain(
  "supabase/migrations/139_parts_autonomous_operations.sql",
  "parts_replenishment_rules",
  "migration 139 creates replenishment rules table",
);
mustContain(
  "supabase/migrations/139_parts_autonomous_operations.sql",
  "parts_auto_replenish_queue",
  "migration 139 creates auto-replenish queue table",
);
mustContain(
  "supabase/migrations/139_parts_autonomous_operations.sql",
  "parts_order_events",
  "migration 139 creates order events audit trail",
);
mustContain(
  "supabase/migrations/139_parts_autonomous_operations.sql",
  "vendor_part_catalog",
  "migration 139 creates vendor-part catalog table",
);
mustContain(
  "supabase/migrations/139_parts_autonomous_operations.sql",
  "fill_rate",
  "migration 139 adds vendor scoring columns",
);
mustContain(
  "supabase/functions/parts-auto-replenish/index.ts",
  "parts-auto-replenish",
  "auto-replenish edge function exists",
);
mustContain(
  "supabase/functions/parts-auto-replenish/index.ts",
  "computeVendorScore",
  "auto-replenish includes vendor scoring logic",
);
mustContain(
  "supabase/functions/parts-auto-replenish/index.ts",
  "parts_auto_replenish_queue",
  "auto-replenish writes to queue table",
);

// 2B: Vendor scoring in UI
mustContain(
  "apps/web/src/features/parts/components/VendorMetricsCard.tsx",
  "composite_score",
  "vendor metrics card shows composite score",
);
mustContain(
  "apps/web/src/features/parts/components/VendorMetricsCard.tsx",
  "fill_rate",
  "vendor metrics card shows fill rate",
);
mustContain(
  "apps/web/src/features/parts/components/VendorMetricsCard.tsx",
  "machine_down_priority",
  "vendor metrics card shows machine-down priority",
);

// 2C: Order events audit trail
mustContain(
  "supabase/functions/parts-order-manager/index.ts",
  "emitOrderEvent",
  "parts-order-manager emits order events",
);
mustContain(
  "supabase/functions/parts-order-manager/index.ts",
  "parts_order_events",
  "parts-order-manager writes to order events table",
);
mustContain(
  "apps/web/src/features/parts/hooks/useOrderEvents.ts",
  "parts_order_events",
  "useOrderEvents hook queries order events",
);
mustContain(
  "apps/web/src/features/parts/components/OrderTimelineCard.tsx",
  "useOrderEvents",
  "order timeline card uses events hook",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsOrderDetailPage.tsx",
  "OrderTimelineCard",
  "order detail page shows timeline",
);

// 2A: Replenishment approval UI
mustContain(
  "apps/web/src/features/parts/hooks/useReplenishQueue.ts",
  "parts_auto_replenish_queue",
  "replenish queue hook queries queue table",
);
mustContain(
  "apps/web/src/features/parts/components/ReplenishmentApprovalCard.tsx",
  "useReplenishQueue",
  "replenishment card uses queue hook",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsCommandCenterPage.tsx",
  "ReplenishmentApprovalCard",
  "command center shows replenishment approval card",
);

// ── Wave 3: Field Intelligence ─────────────────────────────────────────────

// 3A: Voice-to-parts-order
mustContain(
  "supabase/migrations/140_parts_field_intelligence.sql",
  "parts_predictive_kits",
  "migration 140 creates predictive kits table",
);
mustContain(
  "supabase/migrations/140_parts_field_intelligence.sql",
  "is_machine_down",
  "migration 140 adds machine-down column",
);
mustContain(
  "supabase/migrations/140_parts_field_intelligence.sql",
  "voice_transcript",
  "migration 140 adds voice transcript column",
);
mustContain(
  "supabase/functions/voice-to-parts-order/index.ts",
  "voice-to-parts-order",
  "voice-to-parts-order edge function exists",
);
mustContain(
  "supabase/functions/voice-to-parts-order/index.ts",
  "fuzzyMatchCatalog",
  "voice function includes catalog matching",
);
mustContain(
  "supabase/functions/voice-to-parts-order/index.ts",
  "is_machine_down",
  "voice function handles machine-down urgency",
);

// 3B: Photo-to-part identification
mustContain(
  "supabase/functions/parts-identify-photo/index.ts",
  "parts-identify-photo",
  "photo identification edge function exists",
);
mustContain(
  "supabase/functions/parts-identify-photo/index.ts",
  "matchAgainstCatalog",
  "photo function includes catalog matching",
);
mustContain(
  "supabase/functions/parts-identify-photo/index.ts",
  "parts_cross_references",
  "photo function checks cross-references",
);

// 3C: Predictive failure kitting
mustContain(
  "supabase/functions/parts-predictive-kitter/index.ts",
  "parts-predictive-kitter",
  "predictive kitter edge function exists",
);
mustContain(
  "supabase/functions/parts-predictive-kitter/index.ts",
  "customer_fleet",
  "predictive kitter reads fleet data",
);
mustContain(
  "supabase/functions/parts-predictive-kitter/index.ts",
  "parts_predictive_kits",
  "predictive kitter writes to kits table",
);

// Wave 3 UI
mustContain(
  "apps/web/src/features/parts/components/VoicePartsOrderButton.tsx",
  "voice-to-parts-order",
  "voice button invokes edge function",
);
mustContain(
  "apps/web/src/features/parts/components/VoicePartsOrderButton.tsx",
  "VoiceOrderBadge",
  "voice order badge component exists",
);
mustContain(
  "apps/web/src/features/parts/components/VoicePartsOrderButton.tsx",
  "MachineDownBadge",
  "machine-down badge component exists",
);
mustContain(
  "apps/web/src/features/parts/components/PhotoPartIdentifier.tsx",
  "parts-identify-photo",
  "photo identifier invokes edge function",
);
mustContain(
  "apps/web/src/features/parts/hooks/usePredictiveKits.ts",
  "parts_predictive_kits",
  "predictive kits hook queries kits table",
);
mustContain(
  "apps/web/src/features/parts/components/PredictiveKitsCard.tsx",
  "PredictiveKitsSummary",
  "predictive kits card uses summary type",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsCommandCenterPage.tsx",
  "PredictiveKitsCard",
  "command center shows predictive kits card",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsCommandCenterPage.tsx",
  "VoicePartsOrderButton",
  "command center has voice order button",
);
mustContain(
  "apps/web/src/features/parts/pages/NewPartsOrderPage.tsx",
  "VoicePartsOrderButton",
  "new order page has voice order button",
);
mustContain(
  "apps/web/src/features/parts/pages/NewPartsOrderPage.tsx",
  "PhotoPartIdentifier",
  "new order page has photo identifier",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsOrderDetailPage.tsx",
  "VoiceOrderBadge",
  "order detail shows voice order badge",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsOrderDetailPage.tsx",
  "MachineDownBadge",
  "order detail shows machine-down badge",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsOrderDetailPage.tsx",
  "PhotoPartIdentifier",
  "order detail has photo identifier",
);

// ── Wave 4: Network Optimization + Analytics ───────────────────────────────

// 4A: Branch Network Optimizer
mustContain(
  "supabase/migrations/141_parts_network_analytics.sql",
  "parts_transfer_recommendations",
  "migration 141 creates transfer recommendations table",
);
mustContain(
  "supabase/migrations/141_parts_network_analytics.sql",
  "parts_analytics_snapshots",
  "migration 141 creates analytics snapshots table",
);
mustContain(
  "supabase/migrations/141_parts_network_analytics.sql",
  "customer_parts_intelligence",
  "migration 141 creates customer parts intelligence table",
);
mustContain(
  "supabase/functions/parts-network-optimizer/index.ts",
  "parts-network-optimizer",
  "network optimizer edge function exists",
);
mustContain(
  "supabase/functions/parts-network-optimizer/index.ts",
  "parts_transfer_recommendations",
  "network optimizer writes transfer recommendations",
);
mustContain(
  "supabase/functions/parts-network-optimizer/index.ts",
  "parts_analytics_snapshots",
  "network optimizer writes analytics snapshots",
);
mustContain(
  "supabase/functions/parts-network-optimizer/index.ts",
  "customer_parts_intelligence",
  "network optimizer computes customer intel",
);

// 4A: Transfer UI
mustContain(
  "apps/web/src/features/parts/hooks/useTransferRecommendations.ts",
  "parts_transfer_recommendations",
  "transfer recommendations hook queries table",
);
mustContain(
  "apps/web/src/features/parts/components/TransferRecommendationsCard.tsx",
  "TransferSummary",
  "transfer card uses summary type",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsCommandCenterPage.tsx",
  "TransferRecommendationsCard",
  "command center shows transfer recommendations",
);

// 4B: Analytics
mustContain(
  "apps/web/src/features/parts/hooks/usePartsAnalytics.ts",
  "parts_analytics_snapshots",
  "analytics hook queries snapshots table",
);
mustContain(
  "apps/web/src/features/parts/hooks/usePartsAnalytics.ts",
  "useVendorTrends",
  "vendor trends hook exists",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsAnalyticsPage.tsx",
  "PartsAnalyticsPage",
  "analytics page component exists",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsAnalyticsPage.tsx",
  "usePartsAnalytics",
  "analytics page uses analytics hook",
);
mustContain(
  "apps/web/src/features/parts/pages/PartsAnalyticsPage.tsx",
  "useVendorTrends",
  "analytics page uses vendor trends hook",
);
mustContain(
  "apps/web/src/features/parts/components/PartsSubNav.tsx",
  "analytics",
  "sub-nav includes analytics link",
);
mustContain(
  "apps/web/src/App.tsx",
  "PartsAnalyticsPage",
  "analytics page registered in router",
);

// 4C: Customer Lifecycle Parts Intelligence
mustContain(
  "apps/web/src/features/parts/hooks/useCustomerPartsIntel.ts",
  "customer_parts_intelligence",
  "customer intel hook queries table",
);
mustContain(
  "apps/web/src/features/parts/components/CustomerPartsIntelCard.tsx",
  "useCustomerPartsIntel",
  "customer intel card uses hook",
);
mustContain(
  "apps/web/src/features/parts/components/CustomerPartsIntelCard.tsx",
  "recommended_outreach",
  "customer intel card shows outreach recommendation",
);
mustContain(
  "apps/web/src/features/parts/components/CustomerPartsIntelCard.tsx",
  "churn_risk",
  "customer intel card shows churn risk",
);
mustContain(
  "apps/web/src/features/qrm/pages/QrmCompanyDetailPage.tsx",
  "CustomerPartsIntelCard",
  "CRM company detail shows parts intelligence card",
);

const base = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

if (!base || !serviceKey) {
  console.log(
    "SKIP optional live Supabase checks (set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL or VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL)",
  );
} else {
  try {
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    };
    const res = await fetch(
      `${base}/rest/v1/parts_fulfillment_events?select=id&limit=1`,
      { headers },
    );
    if (res.ok) {
      ok("live: parts_fulfillment_events reachable");
    } else if (res.status === 404) {
      const probe = await fetch(`${base}/rest/v1/profiles?select=id&limit=1`, {
        headers,
      });
      if (probe.ok) {
        ok(
          "live: Supabase REST OK (profiles); parts_fulfillment_events 404 — push migrations to this project for full fulfillment audit table",
        );
      } else {
        fail(`live: parts_fulfillment_events HTTP 404; profiles probe HTTP ${probe.status}`);
      }
    } else {
      fail(`live: parts_fulfillment_events select HTTP ${res.status}`);
    }

    const vp = await fetch(
      `${base}/rest/v1/vendor_profiles?select=id,avg_lead_time_hours&limit=1`,
      { headers },
    );
    if (vp.ok) {
      ok("live: vendor_profiles reachable (planner ETA source)");
    } else if (vp.status === 404) {
      ok(
        "live: vendor_profiles 404 on remote — migration 095+ not applied; planner ETA column may be missing",
      );
    } else {
      fail(`live: vendor_profiles probe HTTP ${vp.status}`);
    }
  } catch (e) {
    fail(`live fetch error: ${e?.message ?? e}`);
  }
}

process.exit(failed ? 2 : 0);
