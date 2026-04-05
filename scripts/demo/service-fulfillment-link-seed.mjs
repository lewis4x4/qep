#!/usr/bin/env bun
/**
 * Seed minimal data to validate: Service job drawer → search portal parts orders → link fulfillment run.
 * Uses service role (same as migrations / ops). Safe to re-run (upserts by fixed UUIDs).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun ./scripts/demo/service-fulfillment-link-seed.mjs seed
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun ./scripts/demo/service-fulfillment-link-seed.mjs reset
 *   bun ./scripts/demo/service-fulfillment-link-seed.mjs print   # show IDs (no DB)
 *
 * Workspace defaults to QEP_DEMO_WORKSPACE_ID or "default" (must match staff JWT get_my_workspace()).
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

function loadEnv() {
  const cwd = process.cwd();
  for (const f of [".env.demo.local", ".env.local", ".env"]) {
    const p = `${cwd}/${f}`;
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

loadEnv();

const WORKSPACE = process.env.QEP_DEMO_WORKSPACE_ID ?? "default";

/** Fixed IDs so seed is idempotent and docs can reference them. */
const DEMO_IDS = {
  portalCustomer: "a1000000-0000-4000-8000-000000000001",
  fulfillmentRun: "b2000000-0000-4000-8000-000000000001",
  partsOrder: "c3000000-0000-4000-8000-000000000001",
  serviceJob: "d4000000-0000-4000-8000-000000000001",
};

const SEED_EMAIL = `fulfillment-link-seed@${WORKSPACE}.qep.local`;

function client() {
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
  return createClient(url, key);
}

async function reset(supabase) {
  await supabase.from("service_jobs").delete().eq("id", DEMO_IDS.serviceJob);
  await supabase.from("parts_orders").delete().eq("id", DEMO_IDS.partsOrder);
  await supabase
    .from("parts_fulfillment_runs")
    .delete()
    .eq("id", DEMO_IDS.fulfillmentRun);
  await supabase
    .from("portal_customers")
    .delete()
    .eq("id", DEMO_IDS.portalCustomer);
  console.log("reset: removed fulfillment-link demo rows (if present)");
}

async function seed(supabase) {
  const { error: e1 } = await supabase.from("portal_customers").upsert(
    {
      id: DEMO_IDS.portalCustomer,
      workspace_id: WORKSPACE,
      first_name: "Seed",
      last_name: "PortalCustomer",
      email: SEED_EMAIL,
      is_active: true,
      portal_role: "viewer",
    },
    { onConflict: "id" },
  );
  if (e1) throw new Error(`portal_customers: ${e1.message}`);

  const { error: e2 } = await supabase.from("parts_fulfillment_runs").upsert(
    {
      id: DEMO_IDS.fulfillmentRun,
      workspace_id: WORKSPACE,
      status: "submitted",
    },
    { onConflict: "id" },
  );
  if (e2) throw new Error(`parts_fulfillment_runs: ${e2.message}`);

  const { error: e3 } = await supabase.from("parts_orders").upsert(
    {
      id: DEMO_IDS.partsOrder,
      workspace_id: WORKSPACE,
      portal_customer_id: DEMO_IDS.portalCustomer,
      fulfillment_run_id: DEMO_IDS.fulfillmentRun,
      status: "submitted",
      line_items: [
        {
          part_number: "DEMO-FILTER",
          description: "Demo line for fulfillment link seed",
          quantity: 1,
          unit_price: 0,
          is_ai_suggested: false,
        },
      ],
      subtotal: 0,
      tax: 0,
      shipping: 0,
      total: 0,
    },
    { onConflict: "id" },
  );
  if (e3) throw new Error(`parts_orders: ${e3.message}`);

  const { error: e4 } = await supabase.from("service_jobs").upsert(
    {
      id: DEMO_IDS.serviceJob,
      workspace_id: WORKSPACE,
      source_type: "walk_in",
      request_type: "repair",
      priority: "normal",
      current_stage: "request_received",
      status_flags: ["shop_job"],
      shop_or_field: "shop",
      haul_required: false,
      fulfillment_run_id: null,
      customer_problem_summary: "Demo job for fulfillment run link UX",
    },
    { onConflict: "id" },
  );
  if (e4) throw new Error(`service_jobs: ${e4.message}`);

  console.log("seed: OK");
  console.log(`  workspace_id: ${WORKSPACE}`);
  console.log(`  service_job_id (open job — link from drawer): ${DEMO_IDS.serviceJob}`);
  console.log(`  parts_order_id: ${DEMO_IDS.partsOrder}`);
  console.log(`  fulfillment_run_id (on order — use search / link): ${DEMO_IDS.fulfillmentRun}`);
  console.log(`  portal customer email (search in drawer): ${SEED_EMAIL}`);
}

async function main() {
  const cmd = process.argv[2] ?? "seed";
  if (cmd === "print") {
    console.log(JSON.stringify({ workspace: WORKSPACE, ...DEMO_IDS, email: SEED_EMAIL }, null, 2));
    return;
  }
  if (cmd === "reset") {
    await reset(client());
    return;
  }
  if (cmd === "seed") {
    const supabase = client();
    await seed(supabase);
    return;
  }
  console.error("Usage: seed | reset | print");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
