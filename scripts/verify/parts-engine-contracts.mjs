#!/usr/bin/env bun
/**
 * A1: Static checks that the internal billing RPC and shared-run link contract
 * remain present in-repo (no DB credentials required).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function mustContain(fileRel, needle, label) {
  const path = join(root, fileRel);
  const text = readFileSync(path, "utf8");
  if (!text.includes(needle)) {
    console.error(`FAIL: ${label} — missing "${needle}" in ${fileRel}`);
    process.exit(1);
  }
  console.log(`OK: ${label}`);
}

mustContain(
  "supabase/migrations/124_service_post_internal_billing_to_invoice.sql",
  "service_post_internal_billing_to_invoice",
  "Migration 124 defines service_post_internal_billing_to_invoice",
);
mustContain(
  "supabase/functions/service-billing-post/index.ts",
  "service_post_internal_billing_to_invoice",
  "service-billing-post invokes RPC",
);
mustContain(
  "supabase/functions/service-job-router/index.ts",
  "acknowledge_shared_fulfillment_run",
  "service-job-router supports shared-run acknowledgment",
);
mustContain(
  "supabase/functions/service-job-router/index.ts",
  "shared_fulfillment_run",
  "service-job-router returns shared_fulfillment_run conflict",
);
mustContain(
  "supabase/functions/service-parts-planner/index.ts",
  "finiteRuleHours",
  "service-parts-planner sanitizes planner_rules hours",
);
mustContain(
  "apps/web/src/features/service/hooks/usePartsQueue.ts",
  "intake_line_status",
  "parts queue excludes suggested intake lines (planner alignment)",
);
mustContain(
  "supabase/functions/_shared/service-parts-from-job-code.ts",
  "populatePartsFromJobCode",
  "shared module for job-code → parts lines",
);
mustContain(
  "supabase/functions/service-intake/index.ts",
  "seed_parts_for_job",
  "service-intake can seed parts for an existing job",
);
mustContain(
  "supabase/functions/_shared/parts-fulfillment-mirror.ts",
  "audit_channel",
  "fulfillment mirror tags audit_channel for UI",
);
mustContain(
  "supabase/migrations/129_parts_fulfillment_events_portal_audit_channel.sql",
  "audit_channel",
  "portal order status trigger tags audit_channel",
);
mustContain(
  "supabase/functions/portal-api/index.ts",
  "audit_channel",
  "portal_submitted event includes audit_channel",
);
mustContain(
  "supabase/migrations/130_backfill_parts_fulfillment_audit_channel.sql",
  "audit_channel",
  "migration 130 backfills audit_channel on legacy fulfillment events",
);
mustContain(
  "supabase/migrations/131_parts_fulfillment_events_idempotency_key.sql",
  "idempotency_key",
  "migration 131 adds idempotency_key for fulfillment event dedupe",
);
mustContain(
  "supabase/functions/_shared/parts-fulfillment-mirror.ts",
  "idempotencyKey",
  "fulfillment mirror supports idempotencyKey for vendor retries",
);
mustContain(
  "supabase/functions/_shared/vendor-inbound-contract.ts",
  "parseVendorInboundContract",
  "vendor inbound optional EDI/API contract parser",
);
mustContain(
  "supabase/functions/service-vendor-inbound/index.ts",
  "parseVendorInboundContract",
  "service-vendor-inbound applies vendor contract to metadata and mirror",
);

console.log("parts-engine-contracts: all static checks passed.");
