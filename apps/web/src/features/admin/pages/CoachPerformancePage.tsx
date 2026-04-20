/**
 * Coach Performance Page — Slice 18.
 *
 * Answers "is the Deal Coach actually helping?" for operators. Three
 * panels:
 *
 *  1. Headline stats: total actions, accepted %, adaptive state.
 *  2. Per-rule table with acceptance + win-rate uplift columns, plus
 *     an inline adaptive-state badge (Active / Demoted / Suppressed).
 *  3. Adaptive preview: sliders for suppress/demote thresholds — the
 *     page shows which rules WOULD flip before the runtime picks it
 *     up. Admins can pressure-test tuning without shipping config.
 *  4. Rep dismissal leaderboard — who's dismissing most, what, and
 *     how many distinct rules. Pairs with personal suppression memory
 *     so admin can see "this rep has 47 dismissals across 4 rules,
 *     something's off with how we're targeting them."
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequireAdmin } from "@/components/RequireAdmin";
import {
  getCoachPerformanceSummary,
  wouldDemoteAt,
  wouldSuppressAt,
  type CoachPerformanceSummary,
  type RulePerformanceRow,
} from "../lib/coach-performance-api";
import {
  MIN_CONFIDENCE_SHOWS,
  SUPPRESS_BELOW_PCT as DEFAULT_SUPPRESS,
  DEMOTE_BELOW_PCT   as DEFAULT_DEMOTE,
} from "@/features/quote-builder/lib/coach-rules";

export function CoachPerformancePage() {
  return (
    <RequireAdmin>
      <CoachPerformancePageInner />
    </RequireAdmin>
  );
}

function CoachPerformancePageInner() {
  const [summary, setSummary] = useState<CoachPerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [suppressAt, setSuppressAt] = useState(DEFAULT_SUPPRESS);
  const [demoteAt,   setDemoteAt]   = useState(DEFAULT_DEMOTE);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCoachPerformanceSummary(90).then((s) => {
      if (!cancelled) {
        setSummary(s);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const preview = useMemo(() => {
    if (!summary) return null;
    return {
      suppressed: wouldSuppressAt(summary.rules, suppressAt, MIN_CONFIDENCE_SHOWS),
      demoted:    wouldDemoteAt(summary.rules, suppressAt, demoteAt, MIN_CONFIDENCE_SHOWS),
    };
  }, [summary, suppressAt, demoteAt]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Coach Performance</h1>
        <p className="text-sm text-muted-foreground">
          Rolling 90-day visibility into every Deal Coach rule — acceptance
          rates, win-rate uplift on applied suggestions, dismissal activity
          per rep, and a safe preview of adaptive-threshold changes.
        </p>
      </div>

      {loading || !summary ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : summary.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Couldn't load coach performance</div>
          <div className="text-xs text-muted-foreground">{summary.error}</div>
        </div>
      ) : (
        <>
          {summary.truncated && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
              Rollup is computed over the 5,000 most recent actions — consider shortening the
              window if you need a complete sample.
            </div>
          )}
          <HeadlineStrip summary={summary} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Rule performance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {summary.rules.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No rules have fired in the last 90 days.</p>
              ) : (
                <RuleTable rules={summary.rules} preview={preview} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Adaptive tuning preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Runtime defaults: suppress at <strong>{DEFAULT_SUPPRESS}%</strong> acceptance,
                demote below <strong>{DEFAULT_DEMOTE}%</strong>. Slide to see which rules would
                flip under alternative policy. Rules need at least{" "}
                <strong>{MIN_CONFIDENCE_SHOWS}</strong> shows before adjustment applies.
              </p>
              <ThresholdSlider
                label="Suppress when acceptance is under"
                value={suppressAt}
                onChange={(next) => {
                  setSuppressAt(next);
                  // Keep suppress ≤ demote so `wouldDemoteAt` always has a
                  // valid band to filter on. Without this clamp the admin
                  // can drag suppress above demote and the preview
                  // silently empties out.
                  if (next > demoteAt) setDemoteAt(next);
                }}
                min={0}
                max={80}
              />
              <ThresholdSlider
                label="Demote when acceptance is under (but above suppress)"
                value={demoteAt}
                onChange={setDemoteAt}
                min={suppressAt}
                max={80}
              />
              <PreviewList preview={preview} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Rep dismissal leaderboard</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {summary.repDismissals.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No dismissals in the last 90 days.</p>
              ) : (
                <RepDismissalTable summary={summary} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Headline strip ───────────────────────────────────────────────────────

function HeadlineStrip({ summary }: { summary: CoachPerformanceSummary }) {
  const pctFmt = summary.acceptedPct != null ? `${summary.acceptedPct.toFixed(1)}%` : "—";
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Actions (90d)"    value={summary.totalActions.toLocaleString()} />
      <Stat label="Applied"          value={summary.totalApplied.toLocaleString()} />
      <Stat label="Dismissed"        value={summary.totalDismissed.toLocaleString()} />
      <Stat label="Accepted rate"    value={pctFmt} emphasis />
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-md border ${emphasis ? "border-primary/50 bg-primary/10" : "border-border"} p-3`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${emphasis ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

// ── Rule table ───────────────────────────────────────────────────────────

function RuleTable({
  rules,
  preview,
}: {
  rules: RulePerformanceRow[];
  preview: { suppressed: RulePerformanceRow[]; demoted: RulePerformanceRow[] } | null;
}) {
  const suppressedIds = new Set((preview?.suppressed ?? []).map((r) => r.ruleId));
  const demotedIds    = new Set((preview?.demoted ?? []).map((r) => r.ruleId));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/20">
          <tr className="text-left">
            <th className="px-4 py-2 font-medium">Rule</th>
            <th className="px-4 py-2 font-medium text-right">Shown</th>
            <th className="px-4 py-2 font-medium text-right">Applied</th>
            <th className="px-4 py-2 font-medium text-right">Dismissed</th>
            <th className="px-4 py-2 font-medium text-right">Accept %</th>
            <th className="px-4 py-2 font-medium text-right">Win % (shown)</th>
            <th className="px-4 py-2 font-medium text-right">Win % (applied)</th>
            <th className="px-4 py-2 font-medium text-right">Uplift</th>
            <th className="px-4 py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.ruleId} className="border-b last:border-b-0">
              <td className="px-4 py-2 font-mono text-xs">{r.ruleId}</td>
              <td className="px-4 py-2 text-right">{r.timesShown}</td>
              <td className="px-4 py-2 text-right">{r.timesApplied}</td>
              <td className="px-4 py-2 text-right">{r.timesDismissed}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtPct(r.acceptanceRatePct)}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtPct(r.winRateWhenShownPct)}</td>
              <td className="px-4 py-2 text-right font-mono">{fmtPct(r.winRateWhenAppliedPct)}</td>
              <td className={`px-4 py-2 text-right font-mono ${upliftTone(r.upliftPts)}`}>{fmtDelta(r.upliftPts)}</td>
              <td className="px-4 py-2">
                {suppressedIds.has(r.ruleId) ? (
                  <Badge variant="destructive">Would suppress</Badge>
                ) : demotedIds.has(r.ruleId) ? (
                  <Badge variant="default">Would demote</Badge>
                ) : r.timesShown < MIN_CONFIDENCE_SHOWS ? (
                  <Badge variant="outline">Learning</Badge>
                ) : (
                  <Badge variant="secondary">Active</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sliders ──────────────────────────────────────────────────────────────

function ThresholdSlider({
  label, value, onChange, min, max,
}: {
  label: string; value: number; onChange: (n: number) => void; min: number; max: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={1}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1"
        />
        <span className="font-mono text-sm w-12 text-right">{value}%</span>
      </div>
    </label>
  );
}

function PreviewList({
  preview,
}: {
  preview: { suppressed: RulePerformanceRow[]; demoted: RulePerformanceRow[] } | null;
}) {
  if (!preview) return null;
  if (preview.suppressed.length === 0 && preview.demoted.length === 0) {
    return <p className="text-xs text-muted-foreground">No rules would flip under these thresholds.</p>;
  }
  return (
    <div className="space-y-2">
      {preview.suppressed.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Would be suppressed
          </div>
          <ul className="text-xs space-y-0.5">
            {preview.suppressed.map((r) => (
              <li key={r.ruleId} className="font-mono">
                {r.ruleId} — {fmtPct(r.acceptanceRatePct)} acceptance over {r.timesShown} shows
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.demoted.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Would be demoted
          </div>
          <ul className="text-xs space-y-0.5">
            {preview.demoted.map((r) => (
              <li key={r.ruleId} className="font-mono">
                {r.ruleId} — {fmtPct(r.acceptanceRatePct)} acceptance over {r.timesShown} shows
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Rep dismissal table ──────────────────────────────────────────────────

function RepDismissalTable({ summary }: { summary: CoachPerformanceSummary }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/20">
          <tr className="text-left">
            <th className="px-4 py-2 font-medium">Rep</th>
            <th className="px-4 py-2 font-medium text-right">Dismissals</th>
            <th className="px-4 py-2 font-medium text-right">Distinct rules</th>
            <th className="px-4 py-2 font-medium">Most-dismissed rule</th>
          </tr>
        </thead>
        <tbody>
          {summary.repDismissals.slice(0, 20).map((r) => (
            <tr key={r.repId} className="border-b last:border-b-0">
              <td className="px-4 py-2">{r.displayName ?? r.repId.slice(0, 8)}</td>
              <td className="px-4 py-2 text-right font-mono">{r.dismissalCount}</td>
              <td className="px-4 py-2 text-right font-mono">{r.distinctRules}</td>
              <td className="px-4 py-2 font-mono text-xs">{r.topDismissedRule ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Formatters ───────────────────────────────────────────────────────────

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtDelta(n: number | null): string {
  if (n == null) return "—";
  if (n > 0) return `+${n.toFixed(1)}`;
  return n.toFixed(1);
}

function upliftTone(n: number | null): string {
  if (n == null) return "";
  if (n > 0) return "text-primary";
  if (n < 0) return "text-destructive";
  return "";
}
