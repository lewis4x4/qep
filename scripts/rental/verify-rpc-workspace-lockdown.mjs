#!/usr/bin/env bun
/**
 * L8 build gate: cross-workspace leak probe for the rental RPC surface
 * (blueprint §10 — "cross-workspace leak probe on every new RPC/view").
 *
 * Migration 779 fronts every workspace-scoped SECURITY DEFINER RPC with a
 * rental_assert_workspace() guard and strips caller EXECUTE from internal
 * trigger/cron functions. This script proves the guard holds against a real
 * authenticated JWT — not just service-role introspection:
 *
 *   1. anon is denied every guarded RPC (42501),
 *   2. an authenticated rep reads its OWN workspace,
 *   3. the same rep is denied a FOREIGN p_workspace_id (workspace_denied),
 *   4. internal functions (scans, invoice numbering) are not caller API,
 *   5. pure rate math stays available to authenticated callers.
 *
 * Requires a demo rep login (seed DEMO_USERS). Set QEP_DEMO_PASSWORD if the
 * seed password was overridden.
 *
 * Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... bun scripts/rental/verify-rpc-workspace-lockdown.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error(
    "verify-rpc-workspace-lockdown: set SUPABASE_URL and SUPABASE_ANON_KEY",
  );
  process.exit(1);
}

const REP_EMAIL = process.env.QEP_DEMO_REP_EMAIL ?? "demo.rep@qep-demo.local";
const REP_PASSWORD = process.env.QEP_DEMO_PASSWORD ?? "QepDemo!2026";

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const anon = createClient(url, anonKey, { auth: { persistSession: false } });
for (const [fn, args] of [
  ["rental_disposal_signals", { p_workspace_id: "default" }],
  ["rental_yield_suggestions", { p_workspace_id: "default", p_write: true }],
  ["rental_compute_utilization", { p_workspace_id: "default" }],
  ["rental_intelligence_scan", {}],
  ["rental_forecast_demand", {}],
]) {
  const { error } = await anon.rpc(fn, args);
  check(`anon denied: ${fn}`, Boolean(error), error?.code ?? "NO ERROR — LEAK");
}

const rep = createClient(url, anonKey, { auth: { persistSession: false } });
const { data: session, error: signInErr } = await rep.auth.signInWithPassword({
  email: REP_EMAIL,
  password: REP_PASSWORD,
});
if (signInErr) {
  console.error(
    `verify-rpc-workspace-lockdown: could not sign in ${REP_EMAIL} — ${signInErr.message}`,
  );
  process.exit(1);
}
check("rep signed in", Boolean(session.session));

const own = await rep.rpc("rental_disposal_signals", { p_workspace_id: "default" });
check("rep own-workspace disposal_signals", !own.error && Array.isArray(own.data), own.error?.message);
const ownUtil = await rep.rpc("rental_compute_utilization", { p_workspace_id: "default" });
check("rep own-workspace compute_utilization", !ownUtil.error && ownUtil.data?.fleet_count != null, ownUtil.error?.message);

for (const [fn, args] of [
  ["rental_disposal_signals", { p_workspace_id: "ws_intruder" }],
  ["rental_yield_suggestions", { p_workspace_id: "ws_intruder", p_write: true }],
  ["rental_compute_utilization", { p_workspace_id: "ws_intruder" }],
  ["rental_check_availability", { p_workspace_id: "ws_intruder", p_start: "2026-07-10", p_end: "2026-07-20" }],
  ["rental_resolve_rates", { p_workspace_id: "ws_intruder" }],
  ["rental_availability_calendar", { p_workspace_id: "ws_intruder", p_from: "2026-07-10", p_to: "2026-07-20" }],
]) {
  const { error } = await rep.rpc(fn, args);
  check(
    `rep foreign-workspace denied: ${fn}`,
    error?.message?.includes("workspace_denied") ?? false,
    error?.message ?? "NO ERROR — LEAK",
  );
}

const { data: contract } = await rep
  .from("rental_contracts")
  .select("id")
  .limit(1)
  .maybeSingle();
if (contract?.id) {
  const ctx = await rep.rpc("rental_resolve_context", { p_contract_id: contract.id });
  check("rep resolve_context own contract", !ctx.error && ctx.data?.contract != null, ctx.error?.message);
  const anonCtx = await anon.rpc("rental_resolve_context", { p_contract_id: contract.id });
  check("anon denied: rental_resolve_context", Boolean(anonCtx.error), anonCtx.error?.code ?? "NO ERROR — LEAK");
} else {
  check("resolve_context probe", false, "no contract visible to rep — check seed/RLS");
}

const scan = await rep.rpc("rental_intelligence_scan", {});
check("rep denied: rental_intelligence_scan", Boolean(scan.error), scan.error?.code ?? "NO ERROR — LEAK");
const inv = await rep.rpc("next_rental_invoice_number", { p_workspace_id: "default" });
check("rep denied: next_rental_invoice_number", Boolean(inv.error), inv.error?.code ?? "NO ERROR — LEAK");

const math = await rep.rpc("rental_optimize_charge", { p_billable_days: 10, p_rate_book: { day: 25000 } });
check("rep allowed: rental_optimize_charge (pure math)", !math.error && math.data?.total != null, math.error?.message ?? `total=${math.data?.total}`);

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? "\nALL_PROBES_PASS"
    : `\n${failed.length} PROBE(S) FAILED`,
);
process.exit(failed.length === 0 ? 0 : 1);
