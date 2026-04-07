/**
 * QEP Moonshot Command Center — analytics-alert-evaluator (Slice 2)
 *
 * Reads the latest snapshots, applies the threshold rules from each
 * metric_definitions row, and calls `enqueue_analytics_alert` to dedupe +
 * dual-write blockers into exception_queue.
 *
 * Also runs an auto-resolve pass: any open alert whose underlying metric
 * has now recovered (snapshot value back inside the safe band) is moved to
 * status='resolved' with `metadata.auto_resolved = true`.
 *
 * Designed to run on cron immediately after analytics-snapshot-runner.
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

interface MetricDefRow {
  metric_key: string;
  label: string;
  owner_role: string;
  threshold_config: Record<string, unknown>;
}

interface SnapshotRow {
  workspace_id: string;
  metric_key: string;
  metric_value: number | null;
  calculated_at: string;
  metadata: Record<string, unknown>;
  refresh_state: string;
}

/**
 * Threshold rule evaluator. Returns severity + reason or null (within band).
 *
 * Supported rule shapes (in threshold_config JSON):
 *   { warn_above: N, critical_above: M }
 *   { warn_below: N, critical_below: M }
 *   { warn_pct: N, critical_pct: M }   (compares value as a percentage)
 *   { target_pct_of_quota: N, warn_pct: M, critical_pct: P }  (relative)
 */
function evaluateThreshold(value: number | null, config: Record<string, unknown>): { severity: "warn" | "error" | "critical" | null; reason: string } {
  if (value == null) return { severity: null, reason: "no_value" };

  const cfg = config ?? {};
  // ── above thresholds (high = bad) ──
  if (typeof cfg.critical_above === "number" && value >= cfg.critical_above) {
    return { severity: "critical", reason: `value ${value} ≥ critical_above ${cfg.critical_above}` };
  }
  if (typeof cfg.warn_above === "number" && value >= cfg.warn_above) {
    return { severity: "warn", reason: `value ${value} ≥ warn_above ${cfg.warn_above}` };
  }

  // ── below thresholds (low = bad) ──
  if (typeof cfg.critical_below === "number" && value <= cfg.critical_below) {
    return { severity: "critical", reason: `value ${value} ≤ critical_below ${cfg.critical_below}` };
  }
  if (typeof cfg.warn_below === "number" && value <= cfg.warn_below) {
    return { severity: "warn", reason: `value ${value} ≤ warn_below ${cfg.warn_below}` };
  }

  // ── percentage targets (pct of target hit) ──
  if (typeof cfg.target_pct_of_quota === "number" && value < cfg.target_pct_of_quota) {
    if (typeof cfg.critical_pct === "number" && value < cfg.critical_pct) {
      return { severity: "critical", reason: `attainment ${value}% < critical ${cfg.critical_pct}%` };
    }
    if (typeof cfg.warn_pct === "number" && value < cfg.warn_pct) {
      return { severity: "warn", reason: `attainment ${value}% < warn ${cfg.warn_pct}%` };
    }
  }

  return { severity: null, reason: "within_band" };
}

async function isAuthorizedCaller(req: Request, admin: SupabaseClient): Promise<boolean> {
  const internalSecret = req.headers.get("x-internal-service-secret");
  if (internalSecret && INTERNAL_SECRET && internalSecret === INTERNAL_SECRET) return true;

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
  const fired: { metric_key: string; severity: string; alert_id?: string }[] = [];
  const resolved: string[] = [];

  try {
    // Load all enabled definitions
    const { data: defs, error: defsErr } = await admin
      .from("analytics_metric_definitions")
      .select("metric_key, label, owner_role, threshold_config")
      .eq("enabled", true);
    if (defsErr) throw new Error(defsErr.message);
    const definitions = (defs ?? []) as MetricDefRow[];
    if (definitions.length === 0) {
      return new Response(JSON.stringify({ ok: true, fired: [], resolved: [] }), {
        status: 200,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Pull latest snapshot per metric per workspace
    const metricKeys = definitions.map((d) => d.metric_key);
    const { data: snapshots, error: snapErr } = await admin
      .from("analytics_kpi_snapshots")
      .select("workspace_id, metric_key, metric_value, calculated_at, metadata, refresh_state")
      .in("metric_key", metricKeys)
      .in("refresh_state", ["fresh", "partial"])
      .order("calculated_at", { ascending: false });
    if (snapErr) throw new Error(snapErr.message);

    // Latest per (workspace, metric)
    const latest = new Map<string, SnapshotRow>();
    for (const s of (snapshots ?? []) as SnapshotRow[]) {
      const k = `${s.workspace_id}::${s.metric_key}`;
      if (!latest.has(k)) latest.set(k, s);
    }

    const defByKey = new Map(definitions.map((d) => [d.metric_key, d]));

    // ── Fire phase ────────────────────────────────────────────────────
    for (const snapshot of latest.values()) {
      const def = defByKey.get(snapshot.metric_key);
      if (!def) continue;

      const verdict = evaluateThreshold(snapshot.metric_value, def.threshold_config ?? {});
      if (!verdict.severity) continue;

      const dedupeKey = `${snapshot.workspace_id}::${snapshot.metric_key}::threshold`;

      try {
        // Switch to caller context for the workspace? No — service role bypasses
        // P1-4 fix (mig 193): single source of truth via enqueue_analytics_alert
        // RPC. The RPC takes p_workspace_id explicitly so service-role callers
        // (us) work correctly. It handles dedupe + dual-write to exception_queue
        // + insert atomically.
        const title = `${def.label} ${verdict.severity === "critical" ? "CRITICAL" : "WARNING"}`;
        const description = `${verdict.reason}. Calculated ${snapshot.calculated_at}.`;
        const severity = verdict.severity;

        const { data: alertId, error: rpcErr } = await admin.rpc("enqueue_analytics_alert", {
          p_workspace_id: snapshot.workspace_id,
          p_alert_type: "threshold_breach",
          p_metric_key: snapshot.metric_key,
          p_severity: severity,
          p_title: title,
          p_description: description,
          p_role_target: def.owner_role,
          p_dedupe_key: dedupeKey,
          p_metadata: {
            snapshot_calculated_at: snapshot.calculated_at,
            snapshot_metadata: snapshot.metadata,
            threshold_config: def.threshold_config,
          },
        });
        if (rpcErr) throw new Error(rpcErr.message);

        fired.push({ metric_key: snapshot.metric_key, severity, alert_id: alertId as string | undefined });
      } catch (err) {
        console.warn(`[alert-evaluator] failed for ${snapshot.metric_key}:`, (err as Error).message);
      }
    }

    // ── Auto-resolve phase ────────────────────────────────────────────
    // Any open alert whose latest snapshot is now within band → resolve.
    const { data: openAlerts } = await admin
      .from("analytics_alerts")
      .select("id, workspace_id, metric_key")
      .in("status", ["new", "acknowledged", "in_progress"]);

    for (const alert of (openAlerts ?? []) as { id: string; workspace_id: string; metric_key: string }[]) {
      const def = defByKey.get(alert.metric_key);
      if (!def) continue;
      const snapshot = latest.get(`${alert.workspace_id}::${alert.metric_key}`);
      if (!snapshot) continue;
      const verdict = evaluateThreshold(snapshot.metric_value, def.threshold_config ?? {});
      if (verdict.severity == null) {
        await admin
          .from("analytics_alerts")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
            metadata: { auto_resolved: true, resolved_value: snapshot.metric_value },
          })
          .eq("id", alert.id);
        resolved.push(alert.id);
      }
    }

    const finishedAt = new Date();
    try {
      await admin.from("service_cron_runs").insert({
        workspace_id: "default",
        job_name: "analytics-alert-evaluator",
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        ok: true,
        metadata: { fired: fired.length, resolved: resolved.length },
      });
    } catch { /* swallow */ }

    return new Response(JSON.stringify({
      ok: true,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      fired,
      resolved,
    }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (err) {
    captureEdgeException(err, { fn: "analytics-alert-evaluator", req });
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
