#!/usr/bin/env bun
/**
 * L1 build gate: verify the SQL rate-engine mirror against the shared vector
 * file (blueprint §2.2). The TS implementation is canonical; this script
 * regenerates one assertion query from shared/rental-rate-math.vectors.json
 * and runs it against the database — any diverging case id is a failure.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/rental/verify-rate-sql-mirror.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("verify-rate-sql-mirror: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const vectors = JSON.parse(
  readFileSync(join(import.meta.dir, "../../shared/rental-rate-math.vectors.json"), "utf8"),
);

const lit = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const expectedOptimize = (c) => lit({
  total: c.expected.total,
  segments: c.expected.segments,
  fired: c.expected.fired,
  beaten_alternative: c.expected.beaten_alternative,
});

const rows = [];
for (const c of vectors.optimize_cases) {
  rows.push(
    `('${c.id}', public.rental_optimize_charge(${c.billable_days}, ${lit(c.rate_book)}) = ${expectedOptimize(c)})`,
  );
}
for (const c of vectors.reconcile_cases) {
  const call = `public.rental_reconcile_final_invoice(${c.entire_billable_days}, ${lit(c.rate_book)}, ${c.already_invoiced})`;
  rows.push(
    `('${c.id}', (${call}->>'final_invoice')::bigint = ${c.expected.final_invoice}` +
    ` AND (${call}->'entire'->>'total')::bigint = ${c.expected.entire_optimum}` +
    ` AND ${call}->'entire'->'segments' = ${lit(c.expected.entire_segments)})`,
  );
}
for (const c of vectors.exchange_cases) {
  const checks = c.segments.map((s) =>
    `public.rental_optimize_charge(${s.billable_days}, ${lit(s.rate_book)}) = ${expectedOptimize(s)}`
  );
  const totalExpr = c.segments
    .map((s) => `(public.rental_optimize_charge(${s.billable_days}, ${lit(s.rate_book)})->>'total')::bigint`)
    .join(" + ");
  rows.push(`('${c.id}', ${checks.join(" AND ")} AND (${totalExpr}) = ${c.expected_contract_total})`);
}

const sql =
  "SELECT COALESCE(string_agg(id, ', ') FILTER (WHERE NOT ok), 'ALL_VECTORS_PASS') AS verdict, count(*) AS cases FROM (VALUES\n" +
  rows.join(",\n") +
  "\n) AS t(id, ok);";

// exec_sql-style RPC is not exposed; run through PostgREST via a one-off RPC is
// unavailable, so use the SQL-over-HTTP path only when present. Standard path:
// the `pg_meta` query endpoint isn't public — use supabase-js rpc to a thin
// wrapper if it exists, else fall back to querying via the REST /rpc of
// rental_optimize_charge per case.
async function main() {
  // Per-case fallback path (no generic SQL endpoint from client): call the
  // functions directly through PostgREST rpc for each case.
  const failures = [];
  let cases = 0;

  for (const c of vectors.optimize_cases) {
    cases++;
    const { data, error } = await admin.rpc("rental_optimize_charge", {
      p_billable_days: c.billable_days,
      p_rate_book: c.rate_book,
    });
    const expected = {
      total: c.expected.total,
      segments: c.expected.segments,
      fired: c.expected.fired,
      beaten_alternative: c.expected.beaten_alternative,
    };
    if (error || JSON.stringify(data) !== JSON.stringify(expected)) failures.push(c.id);
  }
  for (const c of vectors.reconcile_cases) {
    cases++;
    const { data, error } = await admin.rpc("rental_reconcile_final_invoice", {
      p_entire_billable_days: c.entire_billable_days,
      p_rate_book: c.rate_book,
      p_already_invoiced: c.already_invoiced,
    });
    if (
      error ||
      data?.final_invoice !== c.expected.final_invoice ||
      data?.entire?.total !== c.expected.entire_optimum ||
      JSON.stringify(data?.entire?.segments) !== JSON.stringify(c.expected.entire_segments)
    ) failures.push(c.id);
  }
  for (const c of vectors.exchange_cases) {
    cases++;
    let total = 0;
    let ok = true;
    for (const s of c.segments) {
      const { data, error } = await admin.rpc("rental_optimize_charge", {
        p_billable_days: s.billable_days,
        p_rate_book: s.rate_book,
      });
      const expected = {
        total: s.expected.total,
        segments: s.expected.segments,
        fired: s.expected.fired,
        beaten_alternative: s.expected.beaten_alternative,
      };
      if (error || JSON.stringify(data) !== JSON.stringify(expected)) ok = false;
      total += data?.total ?? 0;
    }
    if (!ok || total !== c.expected_contract_total) failures.push(c.id);
  }

  if (failures.length > 0) {
    console.error(`SQL mirror DIVERGES from vectors on: ${failures.join(", ")} (${cases} cases)`);
    console.error("Regenerated assertion SQL (for psql debugging):\n" + sql.slice(0, 2000));
    process.exit(1);
  }
  console.log(`ALL_VECTORS_PASS: SQL mirror agrees with the canonical TS on ${cases} cases.`);
}

main().catch((err) => {
  console.error(`verify-rate-sql-mirror: ${err.message}`);
  process.exit(1);
});
