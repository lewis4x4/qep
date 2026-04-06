#!/usr/bin/env bun
/**
 * Post-seed checks: row counts + FK integrity for demo UUIDs.
 * Optional RLS smoke: set SUPABASE_ANON_KEY + uses demo login (best effort).
 */
import { createClient } from "@supabase/supabase-js";
import {
  DEMO_WORKSPACE_ID,
  SERVICE_DEMO_IDS,
  DEMO_USERS,
} from "./seed-ids.mjs";

function admin() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const supabase = admin();
  const ws = DEMO_WORKSPACE_ID;
  let failed = false;

  const check = (name, ok, detail = "") => {
    if (!ok) {
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
      failed = true;
    } else {
      console.log(`OK: ${name}`);
    }
  };

  const invIds = [
    ...SERVICE_DEMO_IDS.partsInventory,
    ...SERVICE_DEMO_IDS.partsInventoryMainBranch,
  ];
  const { count: invCount, error: invErr } = await supabase
    .from("parts_inventory")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("id", invIds);
  if (invErr) throw invErr;
  check("parts_inventory rows (27)", invCount === 27, `got ${invCount}`);

  const { data: invLinked, error: invLinkErr } = await supabase
    .from("parts_inventory")
    .select("catalog_id")
    .eq("workspace_id", ws)
    .in("id", invIds);
  if (invLinkErr) throw invLinkErr;
  const catalogLinked = (invLinked ?? []).filter((r) => r.catalog_id != null).length;
  check(
    "parts_inventory catalog_id populated",
    catalogLinked === 27,
    `got ${catalogLinked}`,
  );

  const catIds = SERVICE_DEMO_IDS.partsCatalog;
  const { count: catCount, error: catErr } = await supabase
    .from("parts_catalog")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("id", catIds);
  if (catErr) throw catErr;
  check("parts_catalog seed rows (8)", catCount === 8, `got ${catCount}`);

  const lineIds = SERVICE_DEMO_IDS.partsOrderLines;
  const { count: lineCount, error: lineErr } = await supabase
    .from("parts_order_lines")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("id", lineIds);
  if (lineErr) throw lineErr;
  check("parts_order_lines seed rows (5)", lineCount === 5, `got ${lineCount}`);

  const internalOrderIds = Object.values(SERVICE_DEMO_IDS.internalPartsOrders);
  const { count: internalPoCount, error: ipoErr } = await supabase
    .from("parts_orders")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("id", internalOrderIds);
  if (ipoErr) throw ipoErr;
  check("internal parts_orders (3)", internalPoCount === 3, `got ${internalPoCount}`);

  const jobIds = Object.values(SERVICE_DEMO_IDS.jobs);
  const { count: jobCount, error: jobErr } = await supabase
    .from("service_jobs")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("id", jobIds);
  if (jobErr) throw jobErr;
  check("service_jobs seed rows (8)", jobCount === 8, `got ${jobCount}`);

  const reqIds = SERVICE_DEMO_IDS.requirements;
  const { data: reqs, error: reqErr } = await supabase
    .from("service_parts_requirements")
    .select("id, job_id, part_number")
    .eq("workspace_id", ws)
    .in("id", reqIds);
  if (reqErr) throw reqErr;
  check("service_parts_requirements (15)", (reqs?.length ?? 0) === 15);

  const jobIdSet = new Set(jobIds);
  for (const r of reqs ?? []) {
    check(
      `requirement ${r.id} FK job`,
      jobIdSet.has(r.job_id),
      `job_id=${r.job_id}`,
    );
  }

  const { data: invParts, error: ipErr } = await supabase
    .from("parts_inventory")
    .select("branch_id, part_number")
    .eq("workspace_id", ws)
    .in("id", invIds);
  if (ipErr) throw ipErr;
  const invKey = new Set(
    (invParts ?? []).map((r) => `${r.branch_id}|${r.part_number}`),
  );

  const { data: jobRows, error: jrErr } = await supabase
    .from("service_jobs")
    .select("id, branch_id")
    .in("id", jobIds);
  if (jrErr) throw jrErr;
  const branchByJob = Object.fromEntries(
    (jobRows ?? []).map((j) => [j.id, j.branch_id]),
  );

  for (const row of reqs ?? []) {
    const b = branchByJob[row.job_id];
    const k = `${b}|${row.part_number}`;
    if (row.part_number === "FAKE-PART-ZZZ") continue;
    check(
      `inventory coverage ${row.part_number} @ ${b}`,
      invKey.has(k),
      "add matching parts_inventory row for branch",
    );
  }

  // ── Reorder profiles (Wave 1A, non-blocking if migration 136 not applied) ──
  const rpIds = SERVICE_DEMO_IDS.reorderProfiles ?? [];
  if (rpIds.length > 0) {
    const { count: rpCount, error: rpErr } = await supabase
      .from("parts_reorder_profiles")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", rpIds);
    if (rpErr) {
      console.log("SKIP: parts_reorder_profiles (migration 136 not applied yet)");
    } else {
      check("parts_reorder_profiles seed rows (24)", rpCount >= 24, `got ${rpCount}`);
    }
  }

  // ── Cross-references (Wave 1C, non-blocking if migration 138 not applied) ──
  const xrIds = SERVICE_DEMO_IDS.crossReferences ?? [];
  if (xrIds.length > 0) {
    const { count: xrCount, error: xrErr } = await supabase
      .from("parts_cross_references")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", xrIds);
    if (xrErr) {
      console.log("SKIP: parts_cross_references (migration 138 not applied yet)");
    } else {
      check("parts_cross_references seed rows (8)", xrCount === 8, `got ${xrCount}`);
    }
  }

  // ── Demand forecasts (Wave 1B, non-blocking if migration 137 not applied) ──
  const dfIds = SERVICE_DEMO_IDS.demandForecasts ?? [];
  if (dfIds.length > 0) {
    const { count: dfCount, error: dfErr } = await supabase
      .from("parts_demand_forecasts")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", dfIds);
    if (dfErr) {
      console.log("SKIP: parts_demand_forecasts (migration 137 not applied yet)");
    } else {
      check("parts_demand_forecasts seed rows (>=24)", dfCount >= 24, `got ${dfCount}`);
    }
  }

  // ── Replenishment rules (Wave 2A, non-blocking if migration 139 not applied) ──
  {
    const { count: rrCount, error: rrErr } = await supabase
      .from("parts_replenishment_rules")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws);
    if (rrErr) {
      console.log("SKIP: parts_replenishment_rules (migration 139 not applied yet)");
    } else {
      check("parts_replenishment_rules seed rows (1)", rrCount >= 1, `got ${rrCount}`);
    }
  }

  // ── Auto-replenish queue (Wave 2A, non-blocking) ──────────────────────────
  {
    const rqIds = SERVICE_DEMO_IDS.replenishQueue ?? [];
    const { count: rqCount, error: rqErr } = await supabase
      .from("parts_auto_replenish_queue")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", rqIds);
    if (rqErr) {
      console.log("SKIP: parts_auto_replenish_queue (migration 139 not applied yet)");
    } else {
      check("parts_auto_replenish_queue seed rows (6)", rqCount >= 6, `got ${rqCount}`);
    }
  }

  // ── Vendor part catalog (Wave 2B, non-blocking) ────────────────────────────
  {
    const vpcIds = SERVICE_DEMO_IDS.vendorPartCatalog ?? [];
    const { count: vpcCount, error: vpcErr } = await supabase
      .from("vendor_part_catalog")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", vpcIds);
    if (vpcErr) {
      console.log("SKIP: vendor_part_catalog (migration 139 not applied yet)");
    } else {
      check("vendor_part_catalog seed rows (10)", vpcCount >= 10, `got ${vpcCount}`);
    }
  }

  // ── Order events (Wave 2C, non-blocking) ──────────────────────────────────
  {
    const oeIds = SERVICE_DEMO_IDS.orderEvents ?? [];
    const { count: oeCount, error: oeErr } = await supabase
      .from("parts_order_events")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", oeIds);
    if (oeErr) {
      console.log("SKIP: parts_order_events (migration 139 not applied yet)");
    } else {
      check("parts_order_events seed rows (12)", oeCount >= 12, `got ${oeCount}`);
    }
  }

  // ── Transfer recommendations (Wave 4A, non-blocking if migration 141 not applied) ──
  {
    const { count: trCount, error: trErr } = await supabase
      .from("parts_transfer_recommendations")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", SERVICE_DEMO_IDS.transferRecs ?? []);
    if (trErr) {
      console.log("SKIP: parts_transfer_recommendations (migration 141 not applied yet)");
    } else {
      check("parts_transfer_recommendations seed rows (3)", trCount >= 3, `got ${trCount}`);
    }
  }

  // ── Customer parts intelligence (Wave 4C, non-blocking) ──────────────────
  {
    const { count: ciCount, error: ciErr } = await supabase
      .from("customer_parts_intelligence")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", SERVICE_DEMO_IDS.customerIntel ?? []);
    if (ciErr) {
      console.log("SKIP: customer_parts_intelligence (migration 141 not applied yet)");
    } else {
      check("customer_parts_intelligence seed rows (2)", ciCount >= 2, `got ${ciCount}`);
    }
  }

  // ── Analytics snapshot (Wave 4B, non-blocking) ────────────────────────────
  {
    const { count: asCount, error: asErr } = await supabase
      .from("parts_analytics_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws);
    if (asErr) {
      console.log("SKIP: parts_analytics_snapshots (migration 141 not applied yet)");
    } else {
      check("parts_analytics_snapshots seed rows (>=1)", asCount >= 1, `got ${asCount}`);
    }
  }

  // ── Predictive kits (Wave 3C, non-blocking if migration 140 not applied) ────
  {
    const pkIds = SERVICE_DEMO_IDS.predictiveKits ?? [];
    const { count: pkCount, error: pkErr } = await supabase
      .from("parts_predictive_kits")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws)
      .in("id", pkIds);
    if (pkErr) {
      console.log("SKIP: parts_predictive_kits (migration 140 not applied yet)");
    } else {
      check("parts_predictive_kits seed rows (4)", pkCount >= 4, `got ${pkCount}`);
    }
  }

  // ── Voice order (Wave 3A, non-blocking) ───────────────────────────────────
  {
    const { count: voCount, error: voErr } = await supabase
      .from("parts_orders")
      .select("*", { count: "exact", head: true })
      .eq("id", SERVICE_DEMO_IDS.voiceOrder);
    if (voErr) {
      console.log("SKIP: voice order (migration 140 may not be applied)");
    } else {
      check("voice order seed row (1)", voCount >= 1, `got ${voCount}`);
    }
  }

  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const demoPw = process.env.QEP_DEMO_PASSWORD ?? "QepDemo!2026";
  if (anon) {
    const userClient = createClient(
      process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
      anon,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const rep = DEMO_USERS.find((u) => u.key === "rep_primary");
    const { data: signData, error: signErr } =
      await userClient.auth.signInWithPassword({
        email: rep.email,
        password: demoPw,
      });
    if (signErr) {
      check(
        "RLS smoke login (rep)",
        false,
        signErr.message,
      );
    } else {
      const { count: piVis, error: visErr } = await userClient
        .from("parts_inventory")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", ws);
      if (visErr) {
        check("RLS parts_inventory visible to rep", false, visErr.message);
      } else {
        check(
          "RLS parts_inventory visible to rep (count > 0)",
          (piVis ?? 0) > 0,
          `count=${piVis}`,
        );
      }
      await userClient.auth.signOut();
    }
  } else {
    console.log("Skip RLS smoke (no SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY)");
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log("\nAll verify checks passed.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
