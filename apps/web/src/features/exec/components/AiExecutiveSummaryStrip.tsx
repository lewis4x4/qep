/**
 * AI Executive Summary Strip — calls the exec-summary-generator edge fn,
 * renders the returned markdown, with a refresh button + freshness chip.
 *
 * v1: deterministic template-driven generation. v2 will allow LLM rewrite
 * via a "mode=ai" flag without changing the UI.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Sparkles, RefreshCcw, Loader2, ArrowRight, AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { ExecRoleTab } from "../lib/types";
import { useExecAlerts, useFallbackKpis, useLatestSnapshots, useMetricDefinitions } from "../lib/useExecData";
import { formatForMetric, formatKpiValue } from "../lib/formatters";
import { resolveExecAlertPlaybookLink, resolveExecAlertRecordLink } from "../lib/alert-actions";

interface SummaryResponse {
  ok: boolean;
  role: string;
  generated_at: string;
  markdown: string;
  stats: { definitions: number; snapshots: number; alerts: number };
  error?: string;
}

interface Props {
  role: ExecRoleTab;
}

interface LocalDefinition {
  metric_key: string;
  label: string;
  threshold_config?: Record<string, unknown> | null;
}

interface LocalSnapshot {
  metric_key: string;
  metric_value: number | null;
}

interface InvokeError {
  message?: string;
  context?: Response;
}

async function requireFreshAccessToken(forceRefresh = false): Promise<string> {
  const supa = supabase as unknown as {
    auth: {
      getSession: () => Promise<{
        data: { session: { access_token?: string | null; expires_at?: number | null } | null };
        error: { message?: string } | null;
      }>;
      refreshSession: () => Promise<{
        data: { session: { access_token?: string | null } | null };
        error: { message?: string } | null;
      }>;
    };
  };

  const { data, error } = await supa.auth.getSession();
  if (error) {
    throw new Error(error.message ?? "session lookup failed");
  }

  const session = data.session;
  if (!session?.access_token) {
    throw new Error("Executive briefing requires a signed-in session.");
  }

  if (forceRefresh) {
    const refresh = await supa.auth.refreshSession();
    if (refresh.error || !refresh.data.session?.access_token) {
      throw new Error(refresh.error?.message ?? "Your session expired. Sign in again and retry.");
    }
    return refresh.data.session.access_token;
  }

  const expiresAt = session.expires_at ?? null;
  const expiresSoon = typeof expiresAt === "number" && expiresAt * 1000 <= Date.now() + 30_000;
  if (!expiresSoon) {
    return session.access_token;
  }

  const refresh = await supa.auth.refreshSession();
  if (refresh.error || !refresh.data.session?.access_token) {
    throw new Error(refresh.error?.message ?? "Your session expired. Sign in again and retry.");
  }
  return refresh.data.session.access_token;
}

async function explainInvokeError(error: InvokeError, fallback: string): Promise<string> {
  const response = error.context;
  if (response && typeof response.text === "function") {
    try {
      const body = await response.text();
      if (body) {
        try {
          const parsed = JSON.parse(body) as { error?: string; message?: string };
          return `${parsed.error ?? parsed.message ?? body} (HTTP ${response.status})`;
        } catch {
          return `${body.slice(0, 200)} (HTTP ${response.status})`;
        }
      }
      return `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }
  return error.message ?? fallback;
}

async function fetchExecutiveBriefing(
  role: ExecRoleTab,
  accessToken: string
): Promise<SummaryResponse> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exec-summary-generator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ role }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    let errorMessage = bodyText || `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
      errorMessage = parsed.error ?? parsed.message ?? errorMessage;
    } catch {
      // keep raw body text
    }
    const error = new Error(`${errorMessage} (HTTP ${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const parsed = (await response.json()) as SummaryResponse;
  return parsed ?? { ok: false, role, generated_at: "", markdown: "", stats: { definitions: 0, snapshots: 0, alerts: 0 } };
}

function evaluateBand(value: number | null, config: Record<string, unknown> | null | undefined): "good" | "warn" | "critical" | "neutral" {
  if (value == null || !config) return "neutral";
  if (typeof config.critical_above === "number" && value >= config.critical_above) return "critical";
  if (typeof config.warn_above === "number" && value >= config.warn_above) return "warn";
  if (typeof config.critical_below === "number" && value <= config.critical_below) return "critical";
  if (typeof config.warn_below === "number" && value <= config.warn_below) return "warn";
  return "good";
}

function buildLocalExecutiveBriefing(
  role: ExecRoleTab,
  definitions: LocalDefinition[],
  snapshots: LocalSnapshot[],
  alerts: Array<{ severity: string; title: string; description?: string | null }>
): SummaryResponse {
  const snapByKey = new Map(snapshots.map((snapshot) => [snapshot.metric_key, snapshot]));
  const roleLabel = role.toUpperCase();
  const lines: string[] = [
    `# ${roleLabel} Briefing`,
    "",
    "## Headline numbers",
  ];

  for (const definition of definitions.slice(0, 4)) {
    const snapshot = snapByKey.get(definition.metric_key);
    const value = snapshot?.metric_value ?? null;
    const icon = evaluateBand(value, definition.threshold_config) === "critical"
      ? "🔴"
      : evaluateBand(value, definition.threshold_config) === "warn"
      ? "🟡"
      : "🟢";
    lines.push(
      `- ${icon} **${definition.label}** — ${formatKpiValue(value, formatForMetric(definition.metric_key))}`
    );
  }

  const criticalAlerts = alerts.filter((alert) => alert.severity === "critical" || alert.severity === "error");
  const watchAlerts = alerts.filter((alert) => alert.severity === "warn" || alert.severity === "info");

  if (criticalAlerts.length > 0) {
    lines.push("", "## Needs attention now");
    for (const alert of criticalAlerts.slice(0, 4)) {
      lines.push(`- **${alert.title}**${alert.description ? ` — ${alert.description}` : ""}`);
    }
  }

  if (watchAlerts.length > 0) {
    lines.push("", "## Watch list");
    for (const alert of watchAlerts.slice(0, 4)) {
      lines.push(`- ${alert.title}`);
    }
  }

  lines.push(
    "",
    "## Health rollup",
    `- ${definitions.length} executive metrics in scope`,
    `- ${snapshots.length} live snapshots available`,
    `- ${alerts.length} open alerts influencing this lens`,
    "",
    `_Generated locally from the live executive data already on screen._`
  );

  return {
    ok: true,
    role,
    generated_at: new Date().toISOString(),
    markdown: lines.join("\n"),
    stats: {
      definitions: definitions.length,
      snapshots: snapshots.length,
      alerts: alerts.length,
    },
  };
}

export function AiExecutiveSummaryStrip({ role }: Props) {
  const { data: alerts = [] } = useExecAlerts(role);
  const { data: definitions = [] } = useMetricDefinitions(role);
  const metricKeys = definitions.map((definition) => definition.metric_key);
  const { data: snapshots = [] } = useLatestSnapshots(metricKeys);
  const { data: fallbackKpis = {} } = useFallbackKpis(role);
  const topAlert = alerts[0] ?? null;
  const topAlertPlaybook = topAlert ? resolveExecAlertPlaybookLink(topAlert) : null;
  const topAlertRecord = topAlert ? resolveExecAlertRecordLink(topAlert) : null;
  const localSummary = buildLocalExecutiveBriefing(
    role,
    definitions,
    definitions.map((definition) => {
      const snapshot = snapshots.find((candidate) => candidate.metric_key === definition.metric_key);
      return {
        metric_key: definition.metric_key,
        metric_value: snapshot?.metric_value ?? fallbackKpis[definition.metric_key]?.value ?? null,
      };
    }),
    alerts,
  );
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["exec", "summary", role],
    queryFn: async (): Promise<SummaryResponse> => {
      try {
        const accessToken = await requireFreshAccessToken();
        return await fetchExecutiveBriefing(role, accessToken);
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        const message = error instanceof Error ? error.message : "summary failed";
        const authFailure = status === 401 || /invalid jwt|jwt|unauthorized/i.test(message);
        if (!authFailure) {
          throw error instanceof Error ? error : new Error("summary failed");
        }

        const refreshedToken = await requireFreshAccessToken(true);
        return await fetchExecutiveBriefing(role, refreshedToken);
      }
    },
    staleTime: 5 * 60_000,
  });

  return (
    <Card className="border-qep-orange/20 bg-gradient-to-r from-qep-orange/5 to-transparent p-4">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-qep-orange" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-qep-orange">Executive briefing</p>
            <Button size="sm" variant="ghost" disabled={isFetching} onClick={() => refetch()}>
              {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
            </Button>
          </div>
          {isLoading ? (
            <p className="mt-2 text-xs text-muted-foreground">Generating briefing…</p>
          ) : error ? (
            <>
              <SummaryMarkdown markdown={localSummary.markdown} />
              <p className="mt-2 text-[10px] text-amber-300">
                Edge function unavailable: {(error as Error).message}. Showing local synthesis from live executive data.
              </p>
            </>
          ) : data?.markdown ? (
            <SummaryMarkdown markdown={data.markdown} />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No briefing yet.</p>
          )}
          {(data ?? localSummary) && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {(data ?? localSummary).stats.definitions} metrics · {(data ?? localSummary).stats.snapshots} snapshots · {(data ?? localSummary).stats.alerts} alerts ·
              generated {new Date((data ?? localSummary).generated_at).toLocaleTimeString()}
            </p>
          )}

          {topAlert && (
            <div className="mt-3 rounded-md border border-qep-orange/20 bg-black/10 p-3">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-3.5 w-3.5 text-qep-orange" />
                <p className="text-[10px] uppercase tracking-wider text-qep-orange">Top action from alerts</p>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-foreground">{topAlert.title}</p>
              {topAlert.description && (
                <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{topAlert.description}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {topAlertPlaybook && (
                  <Link
                    to={topAlertPlaybook.href}
                    className="inline-flex items-center gap-1 rounded-md border border-qep-orange/30 bg-qep-orange/10 px-3 py-1.5 text-[11px] font-medium text-qep-orange hover:bg-qep-orange/15"
                  >
                    {topAlertPlaybook.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
                {topAlertRecord && (
                  <Link
                    to={topAlertRecord.href}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/20"
                  >
                    {topAlertRecord.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Lightweight markdown renderer — just enough for headings + bullets +
 * bold + emoji. Avoids pulling react-markdown into the bundle.
 */
function SummaryMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      out.push(<h2 key={i} className="mt-2 text-sm font-bold text-foreground">{line.slice(2)}</h2>);
    } else if (line.startsWith("## ")) {
      out.push(<h3 key={i} className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">{line.slice(3)}</h3>);
    } else if (line.startsWith("- ")) {
      out.push(
        <p key={i} className="text-[11px] text-foreground">
          {renderInlineMarkdown(line.slice(2))}
        </p>
      );
    } else if (line.startsWith("_") && line.endsWith("_")) {
      out.push(<p key={i} className="mt-2 text-[10px] italic text-muted-foreground">{line.slice(1, -1)}</p>);
    } else if (line.trim() === "") {
      out.push(<div key={i} className="h-1" />);
    } else {
      out.push(<p key={i} className="text-[11px] text-foreground">{line}</p>);
    }
  }
  return <div className="mt-1 space-y-0.5">{out}</div>;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}
