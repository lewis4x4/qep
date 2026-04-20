import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import {
  getOutcomeRollup,
  REASON_LABELS,
  type OutcomeRollup,
} from "@/features/quote-builder/lib/outcomes-api";

/**
 * Slice 10 — Admin view of win/loss reason aggregation (Track A7).
 *
 * Lives as a tab on DealEconomicsPage. Two panels: outcome summary
 * (won/lost/expired/skipped + win rate) + reason frequencies sorted by
 * count.
 *
 * Filter: period chip (30d / 90d / all). Feeds the Deal Coach +
 * velocity slices once enough data accumulates.
 */

type PeriodFilter = "30" | "90" | "all";

export function WinLossRollup() {
  const [period, setPeriod] = useState<PeriodFilter>("90");
  const [rollup, setRollup] = useState<OutcomeRollup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getOutcomeRollup({ daysBack: period === "all" ? null : parseInt(period) })
      .then((r) => {
        setRollup(r);
        setLoading(false);
      });
  }, [period]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Win/Loss Reasons</CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Period:</span>
            {(["30", "90", "all"] as PeriodFilter[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-md px-2 py-0.5 transition-colors ${
                  period === p ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
                }`}
              >
                {p === "all" ? "All time" : `${p}d`}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {!loading && rollup && rollup.total === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No outcomes recorded in this period yet. Capture starts when reps mark quotes as
            won, lost, or expired from the quote list.
          </div>
        )}
        {!loading && rollup && rollup.total > 0 && (
          <>
            {/* Outcome summary stats bar */}
            <div className="flex flex-wrap gap-6 text-sm">
              <Stat value={rollup.won}     label="Won"     tone="success" />
              <Stat value={rollup.lost}    label="Lost"    tone="destructive" />
              <Stat value={rollup.expired} label="Expired" tone="warning" />
              <Stat value={rollup.skipped} label="Skipped" tone="muted" />
              <div className="ml-auto text-right">
                <div className="text-2xl font-bold">
                  {rollup.winRatePct != null ? `${rollup.winRatePct}%` : "—"}
                </div>
                <div className="text-xs text-muted-foreground">Win rate (won/resolved)</div>
              </div>
            </div>

            {/* Reason breakdown */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Top reasons</h3>
              {rollup.topReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No reasons recorded yet — won/lost rows need at least a chip selection.
                </p>
              ) : (
                <div className="space-y-2">
                  {rollup.topReasons.map(({ reason, count }) => {
                    const max = rollup.topReasons[0]?.count ?? 1;
                    const widthPct = Math.max(5, Math.round((count / max) * 100));
                    return (
                      <div key={reason} className="flex items-center gap-3">
                        <div className="w-32 shrink-0 text-xs">{REASON_LABELS[reason]}</div>
                        <div className="flex flex-1 items-center gap-2">
                          <div
                            className="h-5 rounded-sm bg-primary/70"
                            style={{ width: `${widthPct}%` }}
                          />
                          <span className="text-xs font-medium text-muted-foreground">
                            {count}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {rollup.skipRatePct != null && rollup.skipRatePct > 20 && (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
                <Badge variant="warning" className="mr-2">heads up</Badge>
                <span>
                  Skip rate is <b>{rollup.skipRatePct}%</b> — rep adoption of outcome capture is
                  soft. Consider adding a nudge or making capture required.
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "success" | "destructive" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"     ? "text-success-foreground" :
    tone === "destructive" ? "text-destructive" :
    tone === "warning"     ? "text-warning" :
                             "text-muted-foreground";
  return (
    <div>
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
