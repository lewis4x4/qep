#!/usr/bin/env bun
/**
 * Post-seed checks: row counts + FK integrity for demo UUIDs.
 * QB-14 verification requires an anon-authenticated demo user so Quote Builder
 * customer/equipment/catalog visibility is proven through the app/RLS path.
 * Optional parts RLS smoke remains best effort.
 */
import { createClient } from "@supabase/supabase-js";
import {
  DEMO_WORKSPACE_ID,
  SERVICE_DEMO_IDS,
  DEMO_USERS,
  QB14_REALISTIC_DEMO_BATCH_ID,
  QB14_REALISTIC_EXPECTED_COUNTS,
  QB14_REALISTIC_WORKSPACE_ID,
} from "./seed-ids.mjs";

function resolveSupabaseUrl() {
  return (
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
}

function resolveAnonKey() {
  return process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
}

function admin() {
  const url = resolveSupabaseUrl();
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

  const qb14Ws = QB14_REALISTIC_WORKSPACE_ID;

  const countQb14Rows = async (table, { activeDeals = false } = {}) => {
    let query = supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", qb14Ws)
      .contains("metadata", { seedBatchId: QB14_REALISTIC_DEMO_BATCH_ID });
    if (activeDeals) {
      query = query.is("closed_at", null).is("deleted_at", null);
    }
    const { count, error } = await query;
    if (error) throw new Error(`QB-14 ${table} count failed: ${error.message}`);
    return count ?? 0;
  };

  const fetchQb14Rows = async (table, select) => {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq("workspace_id", qb14Ws)
      .contains("metadata", { seedBatchId: QB14_REALISTIC_DEMO_BATCH_ID });
    if (error) throw new Error(`QB-14 ${table} fetch failed: ${error.message}`);
    return data ?? [];
  };

  // ── QB-14 realistic demo seed checks ───────────────────────────────────────
  {
    const expected = QB14_REALISTIC_EXPECTED_COUNTS;
    const baseCounts = {
      companies: await countQb14Rows("qrm_companies"),
      contacts: await countQb14Rows("qrm_contacts"),
      equipment: await countQb14Rows("qrm_equipment"),
      activeDeals: await countQb14Rows("qrm_deals", { activeDeals: true }),
      activities: await countQb14Rows("qrm_activities"),
    };
    check("QB-14 qrm_companies rows (60)", baseCounts.companies === expected.companies, `got ${baseCounts.companies}`);
    check("QB-14 qrm_contacts rows (200)", baseCounts.contacts === expected.contacts, `got ${baseCounts.contacts}`);
    check("QB-14 qrm_equipment rows (100)", baseCounts.equipment === expected.equipment, `got ${baseCounts.equipment}`);
    check("QB-14 active qrm_deals rows (20)", baseCounts.activeDeals === expected.activeDeals, `got ${baseCounts.activeDeals}`);
    check("QB-14 qrm_activities rows (>=80)", baseCounts.activities >= expected.activities, `got ${baseCounts.activities}`);

    const compatCounts = {
      companies: await countQb14Rows("crm_companies"),
      contacts: await countQb14Rows("crm_contacts"),
      equipment: await countQb14Rows("crm_equipment"),
      activeDeals: await countQb14Rows("crm_deals", { activeDeals: true }),
      activities: await countQb14Rows("crm_activities"),
    };
    check("QB-14 crm_companies compat rows (60)", compatCounts.companies === expected.companies, `got ${compatCounts.companies}`);
    check("QB-14 crm_contacts compat rows (200)", compatCounts.contacts === expected.contacts, `got ${compatCounts.contacts}`);
    check("QB-14 crm_equipment compat rows (100)", compatCounts.equipment === expected.equipment, `got ${compatCounts.equipment}`);
    check("QB-14 active crm_deals compat rows (20)", compatCounts.activeDeals === expected.activeDeals, `got ${compatCounts.activeDeals}`);
    check("QB-14 crm_activities compat rows (>=80)", compatCounts.activities >= expected.activities, `got ${compatCounts.activities}`);

    const companies = await fetchQb14Rows("qrm_companies", "id, name");
    const contacts = await fetchQb14Rows("qrm_contacts", "id, primary_company_id");
    const equipment = await fetchQb14Rows("qrm_equipment", "id, company_id, primary_contact_id, make, model");
    const deals = await fetchQb14Rows("qrm_deals", "id, company_id, primary_contact_id, stage_id, closed_at, deleted_at");
    const activities = await fetchQb14Rows("qrm_activities", "id, contact_id, deal_id, company_id");

    const companyIds = new Set(companies.map((row) => row.id));
    const contactIds = new Set(contacts.map((row) => row.id));
    const dealIds = new Set(deals.map((row) => row.id));

    check(
      "QB-14 contact primary companies exist",
      contacts.every((row) => companyIds.has(row.primary_company_id)),
    );

    const { data: associations, error: assocErr } = await supabase
      .from("qrm_contact_companies")
      .select("contact_id, company_id, is_primary")
      .eq("workspace_id", qb14Ws)
      .in("contact_id", contacts.map((row) => row.id));
    if (assocErr) throw new Error(`QB-14 contact-company association fetch failed: ${assocErr.message}`);
    const primaryAssociationKeys = new Set(
      (associations ?? [])
        .filter((row) => row.is_primary)
        .map((row) => `${row.contact_id}|${row.company_id}`),
    );
    check(
      "QB-14 contacts have primary contact-company associations",
      contacts.every((row) => primaryAssociationKeys.has(`${row.id}|${row.primary_company_id}`)),
    );

    check(
      "QB-14 equipment company/contact FKs exist",
      equipment.every((row) => companyIds.has(row.company_id) && contactIds.has(row.primary_contact_id)),
    );

    const uniqueStageIds = [...new Set(deals.map((row) => row.stage_id).filter(Boolean))];
    const { data: stages, error: stageErr } = await supabase
      .from("qrm_deal_stages")
      .select("id")
      .eq("workspace_id", qb14Ws)
      .in("id", uniqueStageIds);
    if (stageErr) throw new Error(`QB-14 deal-stage fetch failed: ${stageErr.message}`);
    const stageIds = new Set((stages ?? []).map((row) => row.id));
    check(
      "QB-14 deal company/contact/stage FKs exist",
      deals.every((row) =>
        companyIds.has(row.company_id) &&
        contactIds.has(row.primary_contact_id) &&
        stageIds.has(row.stage_id) &&
        row.closed_at == null &&
        row.deleted_at == null,
      ),
    );

    check(
      "QB-14 activities have exactly one subject FK",
      activities.every((row) =>
        [row.contact_id, row.deal_id, row.company_id].filter(Boolean).length === 1 &&
        (row.deal_id == null || dealIds.has(row.deal_id)) &&
        (row.company_id == null || companyIds.has(row.company_id)) &&
        (row.contact_id == null || contactIds.has(row.contact_id)),
      ),
    );

    for (const query of ["Big Oak", "Precision", "DREC", "1001"]) {
      const { data, error } = await supabase.rpc("search_customer_picker_ranked", {
        p_query: query,
        p_workspace_id: qb14Ws,
        p_limit: 8,
      });
      check(
        `QB-14 customer picker RPC finds ${query}`,
        !error && (data?.length ?? 0) > 0,
        error?.message ?? `rows=${data?.length ?? 0}`,
      );
    }

    for (const companyName of ["Big Oak Underbrushing", "Precision Land Services", "DREC"]) {
      const { data: companyRows, error: companyErr } = await supabase
        .from("crm_companies")
        .select("id")
        .eq("workspace_id", qb14Ws)
        .eq("name", companyName)
        .limit(1);
      if (companyErr) throw new Error(`QB-14 anchor company lookup failed: ${companyErr.message}`);
      const companyId = companyRows?.[0]?.id;
      if (!companyId) {
        check(`QB-14 Quote Builder signals for ${companyName}`, false, "missing company");
        continue;
      }
      const { count: dealCount, error: dealErr } = await supabase
        .from("crm_deals")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", qb14Ws)
        .eq("company_id", companyId)
        .is("closed_at", null)
        .is("deleted_at", null);
      if (dealErr) throw new Error(`QB-14 anchor deal lookup failed: ${dealErr.message}`);
      const { count: activityCount, error: activityErr } = await supabase
        .from("crm_activities")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", qb14Ws)
        .eq("company_id", companyId)
        .contains("metadata", { seedBatchId: QB14_REALISTIC_DEMO_BATCH_ID });
      if (activityErr) throw new Error(`QB-14 anchor activity lookup failed: ${activityErr.message}`);
      check(
        `QB-14 Quote Builder signals for ${companyName}`,
        Boolean(companyId) && (dealCount ?? 0) > 0 && (activityCount ?? 0) > 0,
        `dealCount=${dealCount ?? 0}, activityCount=${activityCount ?? 0}`,
      );
    }

    const catalogBrands = ["BANDIT", "DEVELON", "YANMAR", "ASV"];
    const { data: brands, error: brandErr } = await supabase
      .from("qb_brands")
      .select("id, code")
      .eq("workspace_id", qb14Ws)
      .in("code", catalogBrands);
    if (brandErr) throw new Error(`QB-14 catalog brand lookup failed: ${brandErr.message}`);
    const brandByCode = new Map((brands ?? []).map((row) => [row.code, row.id]));
    for (const code of catalogBrands) {
      const brandId = brandByCode.get(code);
      if (!brandId) {
        check(`QB-14 catalog brand exists for ${code}`, false, "missing qb_brands row");
        continue;
      }
      const { count: catalogCount, error: catalogErr } = await supabase
        .from("qb_equipment_models")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", qb14Ws)
        .eq("brand_id", brandId)
        .eq("active", true);
      if (catalogErr) throw new Error(`QB-14 ${code} catalog lookup failed: ${catalogErr.message}`);
      const make = { BANDIT: "Bandit", DEVELON: "Develon", YANMAR: "Yanmar", ASV: "ASV" }[code];
      const { count: fleetCount, error: fleetErr } = await supabase
        .from("crm_equipment")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", qb14Ws)
        .eq("make", make)
        .contains("metadata", { seedBatchId: QB14_REALISTIC_DEMO_BATCH_ID });
      if (fleetErr) throw new Error(`QB-14 ${make} fleet lookup failed: ${fleetErr.message}`);
      check(
        `QB-14 catalog and CRM equipment visible for ${code}`,
        Boolean(brandId) && (catalogCount ?? 0) > 0 && (fleetCount ?? 0) > 0,
        `catalog=${catalogCount ?? 0}, fleet=${fleetCount ?? 0}`,
      );
    }

    const qb14Anon = resolveAnonKey();
    const qb14Url = resolveSupabaseUrl();
    const qb14UserKey = process.env.QEP_QB14_VERIFY_USER_KEY ?? "manager";
    const qb14User = DEMO_USERS.find((user) => user.key === qb14UserKey);
    const qb14Password = process.env.QEP_QB14_VERIFY_PASSWORD ?? process.env.QEP_DEMO_PASSWORD ?? "QepDemo!2026";

    if (!qb14Url || !qb14Anon || !qb14User) {
      check(
        "QB-14 authenticated app/RLS verification config",
        false,
        "set SUPABASE_URL, SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY, and QEP_QB14_VERIFY_USER_KEY to one of owner/admin/manager/rep_primary/rep_secondary with QEP_QB14_VERIFY_PASSWORD or QEP_DEMO_PASSWORD",
      );
    } else {
      const appClient = createClient(qb14Url, qb14Anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signErr } = await appClient.auth.signInWithPassword({
        email: qb14User.email,
        password: qb14Password,
      });

      if (signErr) {
        check(
          `QB-14 authenticated app/RLS login (${qb14User.key})`,
          false,
          `${signErr.message}; configure seeded demo auth or set QEP_QB14_VERIFY_USER_KEY/QEP_QB14_VERIFY_PASSWORD`,
        );
      } else {
        check(`QB-14 authenticated app/RLS login (${qb14User.key})`, true);

        for (const query of ["Big Oak", "Precision", "DREC"]) {
          const { data, error } = await appClient.rpc("search_customer_picker_ranked", {
            p_query: query,
            p_workspace_id: qb14Ws,
            p_limit: 8,
          });
          check(
            `QB-14 authenticated customer picker finds ${query}`,
            !error && (data?.length ?? 0) > 0,
            error?.message ?? `rows=${data?.length ?? 0}`,
          );
        }

        for (const make of ["Bandit", "Develon", "Yanmar", "ASV"]) {
          const { count, error } = await appClient
            .from("crm_equipment")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", qb14Ws)
            .eq("make", make)
            .contains("metadata", { seedBatchId: QB14_REALISTIC_DEMO_BATCH_ID });
          check(
            `QB-14 authenticated CRM equipment visible for ${make}`,
            !error && (count ?? 0) > 0,
            error?.message ?? `count=${count ?? 0}`,
          );
        }

        const { data: appBrands, error: appBrandErr } = await appClient
          .from("qb_brands")
          .select("id, code")
          .eq("workspace_id", qb14Ws)
          .in("code", catalogBrands);
        if (appBrandErr) {
          check("QB-14 authenticated catalog brands visible", false, appBrandErr.message);
        } else {
          const appBrandByCode = new Map((appBrands ?? []).map((row) => [row.code, row.id]));
          for (const code of catalogBrands) {
            const brandId = appBrandByCode.get(code);
            if (!brandId) {
              check(`QB-14 authenticated catalog brand exists for ${code}`, false, "missing visible qb_brands row");
              continue;
            }
            const { count, error } = await appClient
              .from("qb_equipment_models")
              .select("*", { count: "exact", head: true })
              .eq("workspace_id", qb14Ws)
              .eq("brand_id", brandId)
              .eq("active", true);
            check(
              `QB-14 authenticated catalog models visible for ${code}`,
              !error && (count ?? 0) > 0,
              error?.message ?? `count=${count ?? 0}`,
            );
          }
        }

        await appClient.auth.signOut();
      }
    }
  }

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
