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
import { useExecAlerts } from "../lib/useExecData";
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

interface InvokeError {
  message?: string;
  context?: Response;
}

async function requireFreshAccessToken(): Promise<string> {
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

export function AiExecutiveSummaryStrip({ role }: Props) {
  const { data: alerts = [] } = useExecAlerts(role);
  const topAlert = alerts[0] ?? null;
  const topAlertPlaybook = topAlert ? resolveExecAlertPlaybookLink(topAlert) : null;
  const topAlertRecord = topAlert ? resolveExecAlertRecordLink(topAlert) : null;
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["exec", "summary", role],
    queryFn: async (): Promise<SummaryResponse> => {
      const supa = supabase as unknown as {
        functions: {
          invoke: (
            name: string,
            opts: { body: Record<string, unknown>; headers?: Record<string, string> }
          ) => Promise<{ data: SummaryResponse | null; error: InvokeError | null }>;
        };
      };
      const accessToken = await requireFreshAccessToken();

      const res = await supa.functions.invoke("exec-summary-generator", {
        body: { role },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (res.error) {
        throw new Error(await explainInvokeError(res.error, "summary failed"));
      }
      return res.data ?? { ok: false, role, generated_at: "", markdown: "", stats: { definitions: 0, snapshots: 0, alerts: 0 } };
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
            <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>
          ) : data?.markdown ? (
            <SummaryMarkdown markdown={data.markdown} />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No briefing yet.</p>
          )}
          {data && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {data.stats.definitions} metrics · {data.stats.snapshots} snapshots · {data.stats.alerts} alerts ·
              generated {new Date(data.generated_at).toLocaleTimeString()}
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
