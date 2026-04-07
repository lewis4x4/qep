/**
 * QEP Moonshot Command Center — analytics-snapshot-runner edge function (Slice 2)
 *
 * Runs the metric registry and writes immutable snapshots into
 * `analytics_kpi_snapshots`.
 *
 * Responsibilities:
 *   1. REFRESH the exec materialized views (mv_exec_*) via the helper RPC.
 *   2. For each enabled metric_definitions row, compute its current value
 *      using one of:
 *        a) hard-coded computation block keyed by metric_key
 *        b) the row's `formula_sql` text (executed via execSql RPC)
 *   3. Insert a new snapshot row with refresh_state='fresh'.
 *   4. Mark any prior 'fresh' row for the same (metric_key, period, scope)
 *      as 'recalculated' and set the new row's supersedes_id pointer.
 *
 * Auth:
 *   - Cron callers pass `x-internal-service-secret` (matches existing pattern)
 *   - Manual triggers: JWT must belong to a profile with role='owner'
 *
 * Idempotency:
 *   - Safe to run multiple times in the same window. Each run computes
 *     fresh values; the supersedes_id chain preserves history.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { captureEdgeException } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET") ?? "";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

interface MetricDefinitionRow {
  metric_key: string;
  label: string;
  display_category: string;
  owner_role: string;
  formula_sql: string | null;
  refresh_cadence: string;
  threshold_config: Record<string, unknown>;
  synthetic_weights: Record<string, number> | null;
  enabled: boolean;
}

interface SnapshotInsert {
  workspace_id: string;
  metric_key: string;
  metric_value: number | null;
  comparison_value: number | null;
  target_value: number | null;
  confidence_score: number | null;
  data_quality_score: number;
  period_start: string;
  period_end: string;
  refresh_state: "fresh" | "partial";
  metadata: Record<string, unknown>;
}

function startOfMonth(d = new Date()): Date {
  const x = new Date(d);
  x.setUTCDate(1);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ─── Computation registry ────────────────────────────────────────────── */

type Computer = (admin: SupabaseClient, workspaceId: string, def: MetricDefinitionRow) => Promise<{ value: number | null; metadata: Record<string, unknown>; quality: number }>;

const COMPUTERS: Record<string, Computer> = {
  revenue_mtd: async (admin, ws) => {
    const start = startOfMonth();
    const end = new Date();
    const { data, error } = await admin
      .from("mv_exec_revenue_daily")
      .select("revenue, margin_dollars, day")
      .eq("workspace_id", ws)
      .gte("day", isoDate(start))
      .lte("day", isoDate(end));
    if (error) throw new Error(`revenue_mtd: ${error.message}`);
    const revenue = (data ?? []).reduce((acc: number, r: { revenue: number }) => acc + Number(r.revenue ?? 0), 0);
    return { value: revenue, metadata: { period: "mtd", row_count: data?.length ?? 0 }, quality: 1.0 };
  },

  gross_margin_dollars_mtd: async (admin, ws) => {
    const start = startOfMonth();
    const { data, error } = await admin
      .from("mv_exec_revenue_daily")
      .select("margin_dollars")
      .eq("workspace_id", ws)
      .gte("day", isoDate(start));
    if (error) throw new Error(`gmd_mtd: ${error.message}`);
    const margin = (data ?? []).reduce((acc: number, r: { margin_dollars: number }) => acc + Number(r.margin_dollars ?? 0), 0);
    return { value: margin, metadata: { period: "mtd" }, quality: 1.0 };
  },

  gross_margin_pct_mtd: async (admin, ws) => {
    const start = startOfMonth();
    const { data, error } = await admin
      .from("mv_exec_revenue_daily")
      .select("revenue, margin_dollars")
      .eq("workspace_id", ws)
      .gte("day", isoDate(start));
    if (error) throw new Error(`gmp_mtd: ${error.message}`);
    const rows = data ?? [];
    const revenue = rows.reduce((a: number, r: { revenue: number }) => a + Number(r.revenue ?? 0), 0);
    const margin = rows.reduce((a: number, r: { margin_dollars: number }) => a + Number(r.margin_dollars ?? 0), 0);
    const pct = revenue > 0 ? (margin / revenue) * 100 : null;
    return { value: pct, metadata: { revenue, margin }, quality: revenue > 0 ? 1.0 : 0.5 };
  },

  weighted_pipeline: async (admin, ws) => {
    const { data, error } = await admin
      .from("mv_exec_pipeline_stage_summary")
      .select("weighted_pipeline, stage_name, raw_pipeline, open_deal_count")
      .eq("workspace_id", ws);
    if (error) throw new Error(`weighted_pipeline: ${error.message}`);
    const rows = data ?? [];
    const total = rows.reduce((a: number, r: { weighted_pipeline: number }) => a + Number(r.weighted_pipeline ?? 0), 0);
    const totalRaw = rows.reduce((a: number, r: { raw_pipeline: number }) => a + Number(r.raw_pipeline ?? 0), 0);
    const totalDeals = rows.reduce((a: number, r: { open_deal_count: number }) => a + Number(r.open_deal_count ?? 0), 0);
    return {
      value: total,
      metadata: {
        raw_pipeline: totalRaw,
        open_deal_count: totalDeals,
        stages: rows.map((r) => ({ stage: r.stage_name, weighted: r.weighted_pipeline })),
      },
      quality: 1.0,
    };
  },

  forecast_confidence_score: async (admin, ws) => {
    // Composite v1: weighted average of stage weight + activity recency.
    // Inputs: mv_exec_pipeline_stage_summary (avg_inactivity_days),
    //         and the existing crm_deals_weighted view.
    // ML upgrade is a future slice; weights live in synthetic_weights JSONB.
    const { data, error } = await admin
      .from("mv_exec_pipeline_stage_summary")
      .select("weighted_pipeline, raw_pipeline, avg_inactivity_days, stage_probability, open_deal_count")
      .eq("workspace_id", ws);
    if (error) throw new Error(`fcs: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) return { value: 0, metadata: { reason: "no_open_pipeline" }, quality: 0.3 };

    let weightSum = 0;
    let scoreSum = 0;
    for (const r of rows) {
      const stageProb = Number(r.stage_probability ?? 0);
      const inactivityDays = Number(r.avg_inactivity_days ?? 0);
      const dealCount = Number(r.open_deal_count ?? 0);

      // activity_recency: 100 if last activity < 3d, 50 if < 14d, 0 if older
      const activityScore = inactivityDays < 3 ? 100 : inactivityDays < 14 ? 50 : 0;

      // Composite per stage = 0.6 * stageProb + 0.4 * activityScore
      const stageScore = (0.6 * stageProb) + (0.4 * activityScore);

      // Weight by deal count
      scoreSum += stageScore * dealCount;
      weightSum += dealCount;
    }
    const composite = weightSum > 0 ? scoreSum / weightSum : 0;
    return { value: Math.round(composite), metadata: { weights: { stage: 0.6, activity: 0.4 }, stages_evaluated: rows.length }, quality: 0.85 };
  },

  net_contribution_after_load: async (admin, ws) => {
    // Slice 2 stub: equals gross margin until the loaded-margin columns
    // ship in Slice 3 (mig 190). Marks itself as partial-quality.
    const start = startOfMonth();
    const { data, error } = await admin
      .from("mv_exec_revenue_daily")
      .select("margin_dollars")
      .eq("workspace_id", ws)
      .gte("day", isoDate(start));
    if (error) throw new Error(`ncal: ${error.message}`);
    const margin = (data ?? []).reduce((a: number, r: { margin_dollars: number }) => a + Number(r.margin_dollars ?? 0), 0);
    return { value: margin, metadata: { stub: "equals_gross_margin_until_slice_3" }, quality: 0.6 };
  },

  enterprise_risk_count: async (admin, ws) => {
    // Count open critical/error rows in exception_queue for this workspace.
    const { data, error } = await admin
      .from("exception_queue")
      .select("id, severity")
      .eq("workspace_id", ws)
      .eq("status", "open")
      .in("severity", ["critical", "error"]);
    if (error) throw new Error(`erc: ${error.message}`);
    const rows = data ?? [];
    return {
      value: rows.length,
      metadata: { critical: rows.filter((r) => r.severity === "critical").length, error: rows.filter((r) => r.severity === "error").length },
      quality: 1.0,
    };
  },

  cash_pressure_index: async (admin, ws, def) => {
    // Synthetic moonshot metric. Weights live in def.synthetic_weights.
    // Component scores 0-100; final is weighted sum.
    const weights = def.synthetic_weights ?? {
      ar_aging_score: 0.30,
      unverified_deposit_score: 0.30,
      refund_exposure_score: 0.20,
      payment_exception_score: 0.20,
    };

    // Component 1: unverified_deposit_score — count of pending deposits
    // (ar_aging + refund_exposure + payment_exception ship in Slice 3 as
    //  the column additions land; for now they're stub-zero with quality<1)
    let unverifiedCount = 0;
    try {
      const { data } = await admin.from("deposits").select("id, status").eq("workspace_id", ws);
      unverifiedCount = (data ?? []).filter((r: { status: string }) => r.status === "pending" || r.status === "required").length;
    } catch { /* deposits table may not be in every workspace */ }

    // Map count to 0-100: 0 → 0, 5 → 50, 20+ → 100
    const unverifiedScore = Math.min(100, unverifiedCount * 10);

    // Components not yet wired (Slice 3)
    const arAgingScore = 0;
    const refundExposureScore = 0;
    const paymentExceptionScore = 0;

    const composite =
      (weights.ar_aging_score ?? 0.30) * arAgingScore +
      (weights.unverified_deposit_score ?? 0.30) * unverifiedScore +
      (weights.refund_exposure_score ?? 0.20) * refundExposureScore +
      (weights.payment_exception_score ?? 0.20) * paymentExceptionScore;

    return {
      value: Math.round(composite),
      metadata: {
        components: {
          ar_aging_score: arAgingScore,
          unverified_deposit_score: unverifiedScore,
          refund_exposure_score: refundExposureScore,
          payment_exception_score: paymentExceptionScore,
        },
        weights,
        unverified_deposit_count: unverifiedCount,
      },
      quality: 0.5, // partial until Slice 3 wires the rest
    };
  },
};

/* ─── Auth guard ──────────────────────────────────────────────────────── */

async function isAuthorizedCaller(req: Request, admin: SupabaseClient): Promise<boolean> {
  // Path 1: cron / internal callers
  const internalSecret = req.headers.get("x-internal-service-secret");
  if (internalSecret && INTERNAL_SECRET && internalSecret === INTERNAL_SECRET) return true;

  // Path 2: manual trigger from /exec page (owner JWT)
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const jwt = auth.slice(7);
  try {
    const { data: userRes } = await admin.auth.getUser(jwt);
    const userId = userRes?.user?.id;
    if (!userId) return false;
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    return profile?.role === "owner";
  } catch {
    return false;
  }
}

/* ─── Workspaces to process ──────────────────────────────────────────── */

async function listWorkspaces(admin: SupabaseClient): Promise<string[]> {
  // Pull distinct workspaces from the profile_workspaces junction table,
  // which is the canonical source for workspace membership (migration 115).
  // The prior implementation queried profiles.workspace_id which has never
  // existed as a column — it always returned all nulls and fell to ['default'].
  const { data, error } = await admin.from("profile_workspaces").select("workspace_id");
  if (error) {
    console.warn("listWorkspaces fallback to default:", error.message);
    return ["default"];
  }
  const set = new Set<string>();
  for (const row of data ?? []) {
    const ws = (row as { workspace_id: string | null }).workspace_id;
    if (ws) set.add(ws);
  }
  if (set.size === 0) set.add("default");
  return Array.from(set);
}

/* ─── Main handler ────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (!(await isAuthorizedCaller(req, admin))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const startedAt = new Date();
  const results: { workspace: string; metric: string; ok: boolean; error?: string }[] = [];

  try {
    // 1. Refresh materialized views (best-effort; failure does not block snapshots)
    try {
      await admin.rpc("refresh_exec_materialized_views");
    } catch (err) {
      console.warn("[snapshot-runner] MV refresh failed:", (err as Error).message);
    }

    // 2. Load enabled metric definitions
    const { data: defs, error: defsErr } = await admin
      .from("analytics_metric_definitions")
      .select("metric_key, label, display_category, owner_role, formula_sql, refresh_cadence, threshold_config, synthetic_weights, enabled")
      .eq("enabled", true);
    if (defsErr) throw new Error(`load definitions: ${defsErr.message}`);

    const definitions = (defs ?? []) as MetricDefinitionRow[];

    // 3. Iterate workspaces × metrics
    const workspaces = await listWorkspaces(admin);
    const periodEnd = isoDate(startOfDay());
    const periodStart = isoDate(startOfMonth());

    for (const workspace of workspaces) {
      for (const def of definitions) {
        const computer = COMPUTERS[def.metric_key];
        if (!computer) {
          results.push({ workspace, metric: def.metric_key, ok: false, error: "no_computer" });
          continue;
        }
        try {
          const { value, metadata, quality } = await computer(admin, workspace, def);
          // P1-1 fix (mig 193): atomic update+insert via write_kpi_snapshot RPC.
          // Eliminates the race between marking prior recalculated and the
          // unique-partial-index protected insert when two cron invocations
          // overlap.
          const { error: rpcErr } = await admin.rpc("write_kpi_snapshot", {
            p_workspace_id: workspace,
            p_metric_key: def.metric_key,
            p_metric_value: value,
            p_data_quality_score: quality,
            p_period_start: periodStart,
            p_period_end: periodEnd,
            p_refresh_state: quality < 1.0 ? "partial" : "fresh",
            p_metadata: metadata,
          });
          if (rpcErr) throw new Error(rpcErr.message);

          results.push({ workspace, metric: def.metric_key, ok: true });
        } catch (err) {
          results.push({ workspace, metric: def.metric_key, ok: false, error: (err as Error).message });
        }
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    const finishedAt = new Date();

    // Audit row in service_cron_runs (best-effort)
    try {
      await admin.from("service_cron_runs").insert({
        workspace_id: "default",
        job_name: "analytics-snapshot-runner",
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        ok: failCount === 0,
        error: failCount > 0 ? `${failCount} computations failed` : null,
        metadata: { ok: okCount, failed: failCount, results },
      });
    } catch { /* swallow */ }

    return new Response(JSON.stringify({
      ok: true,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      snapshots_written: okCount,
      failed: failCount,
      results,
    }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (err) {
    captureEdgeException(err, { fn: "analytics-snapshot-runner", req });
    console.error("[snapshot-runner] fatal:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message, results }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
