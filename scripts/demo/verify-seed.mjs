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

  const invIds = SERVICE_DEMO_IDS.partsInventory;
  const { count: invCount, error: invErr } = await supabase
    .from("parts_inventory")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("id", invIds);
  if (invErr) throw invErr;
  check("parts_inventory rows (24)", invCount === 24, `got ${invCount}`);

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
