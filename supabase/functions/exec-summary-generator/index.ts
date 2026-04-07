/**
 * QEP Moonshot Command Center — exec-summary-generator (Slice 5)
 *
 * Produces a role-specific executive briefing in markdown by reading
 * `analytics_kpi_snapshots` + `analytics_alerts` for the given role and
 * shaping them into a structured "what's good / what needs attention"
 * narrative.
 *
 * v1: deterministic template-driven generation (no LLM call) so the
 *     surface is functional without API costs and LLM upgrade is one
 *     branch swap away.
 * v2: optional LLM rewrite gated on a `mode=ai` query param.
 *
 * Auth:
 *   - JWT must belong to a profile with role='owner'
 *   - Cron callers may pre-warm via x-internal-service-secret
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

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

interface RequestBody {
  role: "ceo" | "cfo" | "coo";
  workspace_id?: string;
}

async function isAuthorizedCaller(req: Request, admin: SupabaseClient): Promise<{ ok: boolean; userId?: string; workspace?: string }> {
  const internalSecret = req.headers.get("x-internal-service-secret");
  if (internalSecret && INTERNAL_SECRET && internalSecret === INTERNAL_SECRET) return { ok: true };

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false };
  try {
    const { data: userRes } = await admin.auth.getUser(auth.slice(7));
    const userId = userRes?.user?.id;
    if (!userId) return { ok: false };
    const { data: profile } = await admin.from("profiles").select("role, active_workspace_id").eq("id", userId).maybeSingle();
    if (profile?.role !== "owner") return { ok: false };
    return { ok: true, userId, workspace: profile.active_workspace_id };
  } catch {
    return { ok: false };
  }
}

function formatValue(metricKey: string, value: number | null): string {
  if (value == null) return "—";
  if (metricKey.includes("_pct") || metricKey.includes("_rate")) return `${Number(value).toFixed(1)}%`;
  if (metricKey.includes("revenue") || metricKey.includes("margin_dollars") || metricKey.includes("contribution") || metricKey.includes("pipeline") || metricKey.includes("exposure") || metricKey.includes("collected")) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
  }
  if (metricKey.includes("count") || metricKey.includes("score") || metricKey.includes("index")) return Math.round(Number(value)).toString();
  return Math.round(Number(value)).toString();
}

interface Snapshot {
  metric_key: string;
  metric_value: number | null;
  refresh_state: string;
}

interface Definition {
  metric_key: string;
  label: string;
  threshold_config: Record<string, unknown>;
}

interface Alert {
  severity: string;
  title: string;
  description: string | null;
  metric_key: string | null;
}

function evaluateBand(value: number | null, config: Record<string, unknown>): "good" | "warn" | "critical" | "neutral" {
  if (value == null) return "neutral";
  if (typeof config.critical_above === "number" && value >= config.critical_above) return "critical";
  if (typeof config.warn_above === "number" && value >= config.warn_above) return "warn";
  if (typeof config.critical_below === "number" && value <= config.critical_below) return "critical";
  if (typeof config.warn_below === "number" && value <= config.warn_below) return "warn";
  if (typeof config.warn_above === "number" || typeof config.warn_below === "number") return "good";
  return "neutral";
}

function buildBriefing(role: string, definitions: Definition[], snapshots: Snapshot[], alerts: Alert[]): string {
  const snapByKey = new Map(snapshots.map((s) => [s.metric_key, s]));
  const lines: string[] = [];

  const roleLabel = role === "ceo" ? "CEO" : role === "cfo" ? "CFO" : "COO";
  lines.push(`# ${roleLabel} Briefing — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`);
  lines.push("");

  // Headline KPIs
  const headline = definitions.slice(0, 4);
  if (headline.length > 0) {
    lines.push("## Headline numbers");
    for (const def of headline) {
      const snap = snapByKey.get(def.metric_key);
      const value = snap?.metric_value ?? null;
      const band = evaluateBand(value, def.threshold_config ?? {});
      const icon = band === "critical" ? "🔴" : band === "warn" ? "🟡" : band === "good" ? "🟢" : "⚪";
      lines.push(`- ${icon} **${def.label}** — ${formatValue(def.metric_key, value)}`);
    }
    lines.push("");
  }

  // What needs attention
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warnAlerts = alerts.filter((a) => a.severity === "error" || a.severity === "warn");

  if (criticalAlerts.length > 0) {
    lines.push("## ⚠ Needs attention NOW");
    for (const a of criticalAlerts.slice(0, 5)) {
      lines.push(`- **${a.title}**${a.description ? ` — ${a.description}` : ""}`);
    }
    lines.push("");
  }

  if (warnAlerts.length > 0) {
    lines.push("## Watch list");
    for (const a of warnAlerts.slice(0, 5)) {
      lines.push(`- ${a.title}`);
    }
    lines.push("");
  }

  // Bands summary
  let goodCount = 0;
  let warnCount = 0;
  let criticalCount = 0;
  for (const def of definitions) {
    const snap = snapByKey.get(def.metric_key);
    const band = evaluateBand(snap?.metric_value ?? null, def.threshold_config ?? {});
    if (band === "good") goodCount++;
    if (band === "warn") warnCount++;
    if (band === "critical") criticalCount++;
  }

  lines.push("## Health rollup");
  lines.push(`- 🟢 ${goodCount} metric${goodCount === 1 ? "" : "s"} in safe band`);
  lines.push(`- 🟡 ${warnCount} warning${warnCount === 1 ? "" : "s"}`);
  lines.push(`- 🔴 ${criticalCount} critical`);
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()} from ${snapshots.length} live snapshots and ${alerts.length} open alerts._`);

  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const auth = await isAuthorizedCaller(req, admin);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  if (!body.role || !["ceo", "cfo", "coo"].includes(body.role)) {
    return new Response(JSON.stringify({ error: "invalid_role" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const workspace = body.workspace_id ?? auth.workspace ?? "default";

  try {
    // Load definitions for the role
    const { data: defs, error: defsErr } = await admin
      .from("analytics_metric_definitions")
      .select("metric_key, label, threshold_config")
      .eq("owner_role", body.role)
      .eq("enabled", true);
    if (defsErr) throw new Error(defsErr.message);

    const definitions = (defs ?? []) as Definition[];
    const metricKeys = definitions.map((d) => d.metric_key);

    // Latest snapshot per metric for this workspace
    const { data: snaps, error: snapErr } = await admin
      .from("analytics_kpi_snapshots")
      .select("metric_key, metric_value, refresh_state, calculated_at")
      .eq("workspace_id", workspace)
      .in("metric_key", metricKeys.length > 0 ? metricKeys : ["__none__"])
      .in("refresh_state", ["fresh", "partial", "recalculated"])
      .order("calculated_at", { ascending: false });
    if (snapErr) throw new Error(snapErr.message);

    const latestByMetric = new Map<string, Snapshot>();
    for (const s of (snaps ?? []) as Snapshot[]) {
      if (!latestByMetric.has(s.metric_key)) latestByMetric.set(s.metric_key, s);
    }
    const snapshots = Array.from(latestByMetric.values());

    // Open alerts for the role
    const { data: alerts, error: alertErr } = await admin
      .from("analytics_alerts")
      .select("severity, title, description, metric_key")
      .eq("workspace_id", workspace)
      .eq("role_target", body.role)
      .in("status", ["new", "acknowledged", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (alertErr) throw new Error(alertErr.message);

    const markdown = buildBriefing(body.role, definitions, snapshots, (alerts ?? []) as Alert[]);

    return new Response(JSON.stringify({
      ok: true,
      role: body.role,
      workspace_id: workspace,
      generated_at: new Date().toISOString(),
      markdown,
      stats: {
        definitions: definitions.length,
        snapshots: snapshots.length,
        alerts: alerts?.length ?? 0,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[exec-summary-generator] error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
