import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Loader2 } from "lucide-react";
import { RequireAdmin } from "@/components/RequireAdmin";
import {
  getQuoteVelocityRows,
  summarizeVelocity,
  findStalledQuotes,
  formatDuration,
  type QuoteVelocityRow,
  type StageStats,
  type VelocitySummary,
} from "../lib/velocity-api";

type PeriodFilter = "30" | "90" | "all";
const DEFAULT_STALL_DAYS = 14;
const PERIOD_FILTERS: readonly PeriodFilter[] = ["30", "90", "all"];

export function DealVelocityPage() {
  return (
    <RequireAdmin>
      <DealVelocityPageInner />
    </RequireAdmin>
  );
}

function DealVelocityPageInner() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodFilter>("90");
  const [rows, setRows] = useState<QuoteVelocityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getQuoteVelocityRows({
      daysBack: period === "all" ? null : parseInt(period),
    }).then((data) => {
      setRows(data);
      setLoading(false);
    });
  }, [period]);

  const summary: VelocitySummary | null = useMemo(
    () => (rows.length > 0 ? summarizeVelocity(rows) : null),
    [rows],
  );
  const stalled = useMemo(() => findStalledQuotes(rows, DEFAULT_STALL_DAYS), [rows]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Deal Velocity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How long quotes spend in each stage, and which ones are stalled. Descriptive today;
          predictive signals layer on in later slices.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
        <span className="text-muted-foreground">Period:</span>
        {PERIOD_FILTERS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-md px-3 py-1 transition-colors ${
              period === p ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
            }`}
          >
            {p === "all" ? "All time" : `Last ${p}d`}
          </button>
        ))}
      </div>

      {loading && (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      )}

      {!loading && summary && summary.totalQuotes === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No quotes in this period yet.
          </CardContent>
        </Card>
      )}

      {!loading && summary && summary.totalQuotes > 0 && (
        <>
          {/* Summary stats strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <HeaderStat value={summary.totalQuotes} label="Quotes" />
            <HeaderStat value={summary.inFlight}    label="In flight" />
            <HeaderStat value={summary.won}         label="Won"  tone="success" />
            <HeaderStat value={summary.lost}        label="Lost" tone="destructive" />
          </div>

          {/* Stage timing */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Stage timing</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <StageCard label="Draft → Sent"     stats={summary.draftToSent} />
                <StageCard label="Sent → Viewed"    stats={summary.sentToViewed} />
                <StageCard label="Sent → Outcome"   stats={summary.sentToOutcome} />
              </div>
            </CardContent>
          </Card>

          {/* Stalled drill-down */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Stalled quotes
                <span className="text-xs font-normal text-muted-foreground">
                  (sent/viewed, age ≥ {DEFAULT_STALL_DAYS}d)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {stalled.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No stalled quotes — pipeline is moving.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2">Customer</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Sent</th>
                        <th className="px-4 py-2">Age in stage</th>
                        <th className="px-4 py-2" aria-hidden />
                      </tr>
                    </thead>
                    <tbody>
                      {stalled.map((r) => (
                        <tr
                          key={r.id}
                          className="cursor-pointer border-b transition-colors hover:bg-muted/20"
                          onClick={() => navigate(`/quote-v2?package_id=${r.id}`)}
                        >
                          <td className="px-4 py-2 font-medium">
                            {r.customer ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {r.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {r.sent_at ? new Date(r.sent_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-1 text-xs font-medium text-warning">
                              <Clock className="h-3 w-3" />
                              {formatDuration(r.currentStageAgeSec)}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-primary">Open →</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function HeaderStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "success" | "destructive";
}) {
  const toneClass =
    tone === "success"     ? "text-success-foreground" :
    tone === "destructive" ? "text-destructive" :
                             "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function StageCard({ label, stats }: { label: string; stats: StageStats }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {stats.n === 0 ? (
        <div className="text-sm text-muted-foreground">No data</div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold">{formatDuration(stats.medianSec)}</div>
            <div className="text-xs text-muted-foreground">median</div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>p90 {formatDuration(stats.p90Sec)}</span>
            <span>n={stats.n}</span>
          </div>
        </div>
      )}
    </div>
  );
}
