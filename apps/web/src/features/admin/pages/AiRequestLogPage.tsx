import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAiRequestLogs, getAiLogStats, formatTimeToQuote, type AiLogRow, type AiLogFilter, type AiLogStats } from "../lib/ai-log-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function shortUserId(id: string | null): string {
  if (!id) return "—";
  return id.slice(0, 8) + "…";
}

function resolveDisplay(row: AiLogRow): string {
  if (!row.resolved_model_id) return "Unresolved";
  const brand = row.qb_brands?.name ?? "?";
  const model = row.qb_equipment_models?.name_display ?? "?";
  return `${brand} – ${model}`;
}

function dealSize(row: AiLogRow): string {
  if (!row.resolved_model_id || !row.qb_equipment_models) return "—";
  return fmtUsd(row.qb_equipment_models.list_price_cents);
}

function customerTypeDisplay(ct: string | null): string {
  if (ct === "standard") return "Standard";
  if (ct === "gmu") return "GMU";
  return "—";
}

function rowColorClass(row: AiLogRow): string {
  if (row.error) return "bg-red-50 dark:bg-red-950/20";
  if (row.resolved_model_id) return "bg-green-50 dark:bg-green-950/20";
  return "bg-yellow-50 dark:bg-yellow-950/20";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: AiLogStats | null }) {
  if (!stats) return null;
  const resolvedPct = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;
  return (
    <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <span><span className="font-semibold">{stats.total}</span> Total</span>
      <span><span className="font-semibold">{resolvedPct}%</span> Resolved</span>
      <span><span className="font-semibold">{stats.voice}</span> Voice</span>
      <span><span className="font-semibold">{stats.text}</span> Text</span>
    </div>
  );
}

// ── Expanded row panel ────────────────────────────────────────────────────────

function ExpandedRow({ row }: { row: AiLogRow }) {
  return (
    <tr>
      <td colSpan={6} className="border-b bg-muted/30 px-4 py-3">
        <div className="space-y-2 text-xs">
          <div>
            <span className="font-medium text-muted-foreground">Raw prompt:</span>{" "}
            <span className="font-mono">{row.raw_prompt}</span>
          </div>
          {row.confidence && (
            <div>
              <span className="font-medium text-muted-foreground">Confidence:</span>{" "}
              <span className="font-mono whitespace-pre-wrap">{JSON.stringify(row.confidence, null, 2)}</span>
            </div>
          )}
          {row.model_candidates && (
            <div>
              <span className="font-medium text-muted-foreground">Model candidates:</span>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(row.model_candidates, null, 2)}</pre>
            </div>
          )}
          {row.error && (
            <div>
              <span className="font-medium text-destructive">Error:</span>{" "}
              <span className="font-mono text-destructive">{row.error}</span>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type DaysFilter = "7" | "30" | "all";
type SourceFilter = "all" | "text" | "voice";

export function AiRequestLogPage() {
  const { profile } = useAuth();

  const canView = ["admin", "manager", "owner"].includes(profile?.role ?? "");
  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">You do not have access to this page.</p>
      </div>
    );
  }

  const [days, setDays]           = useState<DaysFilter>("7");
  const [source, setSource]       = useState<SourceFilter>("all");
  const [rows, setRows]           = useState<AiLogRow[]>([]);
  const [stats, setStats]         = useState<AiLogStats | null>(null);
  const [loading, setLoading]     = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filter: AiLogFilter = {
    daysBack:     days === "all" ? null : parseInt(days),
    promptSource: source,
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getAiRequestLogs(filter),
      getAiLogStats(filter),
    ]).then(([data, s]) => {
      setRows(data);
      setStats(s);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, source]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Iron Advisor — AI Request Log</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Logs are kept in full to support Iron AI training. Retention policy: soft-keep, no scheduled pruning.
        </p>
      </div>

      <StatsBar stats={stats} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Period:</span>
          {(["7", "30", "all"] as DaysFilter[]).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                days === d ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
              }`}
            >
              {d === "7" ? "Last 7d" : d === "30" ? "Last 30d" : "All time"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Source:</span>
          {(["all", "text", "voice"] as SourceFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`rounded-md px-3 py-1 text-sm capitalize transition-colors ${
                source === s ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No AI requests in selected range.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2">Time</th>
                      <th className="px-4 py-2">Iron Advisor</th>
                      <th className="px-4 py-2">Make / Model</th>
                      <th className="px-4 py-2">Deal Size</th>
                      <th className="px-4 py-2">Customer</th>
                      <th className="px-4 py-2" title="Time from AI request to first saved quote.">
                        Time to Quote
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <>
                        <tr
                          key={row.id}
                          className={`cursor-pointer border-b transition-opacity hover:opacity-80 ${rowColorClass(row)}`}
                          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                        >
                          <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(row.created_at)}</td>
                          <td className="px-4 py-2 font-mono text-xs">{shortUserId(row.user_id)}</td>
                          <td className="px-4 py-2">
                            {row.resolved_model_id ? (
                              resolveDisplay(row)
                            ) : (
                              <Badge variant="outline" className="text-yellow-600 border-yellow-300">Unresolved</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2">{dealSize(row)}</td>
                          <td className="px-4 py-2">{customerTypeDisplay(row.customer_type)}</td>
                          <td
                            className={`px-4 py-2 ${
                              row.time_to_quote_seconds != null ? "font-medium" : "text-muted-foreground"
                            }`}
                          >
                            {formatTimeToQuote(row.time_to_quote_seconds)}
                          </td>
                        </tr>
                        {expandedId === row.id && <ExpandedRow key={`${row.id}-expanded`} row={row} />}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                Showing {rows.length} of up to 500 entries
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
