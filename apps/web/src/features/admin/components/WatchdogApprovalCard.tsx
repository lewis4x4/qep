/**
 * WatchdogApprovalCard — Slice 16 moonshot surface.
 *
 * Appears on the Price Sheets admin page when there's a pending-review
 * sheet that was auto-detected by the watchdog. Leads with the
 * differentiating insight: in-flight quote impact.
 *
 * Layout (top to bottom):
 *   - Header: "Auto-detected: <brand> — <source label>" with pill.
 *   - Headline strip: 4 numbers — total changes, avg Δ%, net Δ$,
 *     affected quotes.
 *   - Pipeline impact card (only if impact.affectedQuoteCount > 0):
 *     expandable list of quotes with per-quote Δ$.
 *   - Catalog changes list: model-by-model price changes, sorted by
 *     |Δ| desc; top 10 by default with "show all" expander.
 *   - Actions row: "Review in extract table" (deep link) / Dismiss.
 *
 * Data fetched lazily — sheet list pages may render many card
 * placeholders, so we only hit the diff + impact APIs when the card
 * actually mounts. On error we still render the card with a failure
 * note so the admin isn't silently left without the banner.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, Sparkles } from "lucide-react";
import {
  generateSheetDiff,
  getInFlightImpact,
  type InFlightImpact,
  type ModelPriceChange,
  type SheetDiff,
} from "../lib/sheet-diff-api";

export interface WatchdogApprovalCardProps {
  priceSheetId: string;
  brandName: string | null;
  sourceLabel: string | null;
  onReview?: () => void;
}

export function WatchdogApprovalCard({
  priceSheetId,
  brandName,
  sourceLabel,
  onReview,
}: WatchdogApprovalCardProps) {
  const [diff, setDiff] = useState<SheetDiff | null>(null);
  const [impact, setImpact] = useState<InFlightImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [showAffected, setShowAffected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const d = await generateSheetDiff(priceSheetId);
        if (cancelled) return;
        setDiff(d);
        if (d) {
          const imp = await getInFlightImpact(d);
          if (!cancelled) setImpact(imp);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Diff computation failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [priceSheetId]);

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold">Auto-detected price book</span>
          {brandName && <Badge variant="outline">{brandName}</Badge>}
          {sourceLabel && (
            <span className="text-xs text-muted-foreground">via {sourceLabel}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Our watchdog spotted a change at the source and queued this sheet for your review.
          Below is the diff against the previously-published book, plus the impact on your
          in-flight quotes.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Computing diff + pipeline impact…</p>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              <div className="font-medium">Couldn't compute diff</div>
              <div className="text-xs text-muted-foreground">{error}</div>
            </div>
          </div>
        ) : diff ? (
          <>
            <HeadlineStrip diff={diff} impact={impact} />

            {impact && impact.affectedQuoteCount > 0 && (
              <PipelineImpactPanel
                impact={impact}
                expanded={showAffected}
                onToggle={() => setShowAffected((v) => !v)}
              />
            )}

            <ChangeList
              changes={diff.modelChanges}
              showAll={showAllChanges}
              onToggle={() => setShowAllChanges((v) => !v)}
            />

            <div className="flex gap-2 pt-2">
              {onReview && (
                <Button size="sm" onClick={onReview}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Review items
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No diff data available yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function HeadlineStrip({ diff, impact }: { diff: SheetDiff; impact: InFlightImpact | null }) {
  const s = diff.summary;
  const netDeltaFmt = formatCents(s.totalDeltaCents, { showSign: true });
  const impactFmt = impact ? formatCents(impact.totalDeltaCents, { showSign: true }) : "—";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
      <Stat label="Total changes" value={s.totalChanges.toString()} hint={`${s.newModels} new · ${s.removedModels} removed`} />
      <Stat
        label="Avg Δ"
        value={s.avgDeltaPct != null ? `${s.avgDeltaPct > 0 ? "+" : ""}${s.avgDeltaPct.toFixed(1)}%` : "—"}
        hint={`${s.pricesIncreased}↑  ${s.pricesDecreased}↓`}
      />
      <Stat
        label="Net Δ (catalog)"
        value={netDeltaFmt}
        hint="sum over changed models"
      />
      <Stat
        label="Open quotes affected"
        value={impact ? impact.affectedQuoteCount.toString() : "—"}
        hint={`Δ ${impactFmt} across pipeline`}
        emphasis
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-md border ${emphasis ? "border-primary/50 bg-primary/10" : "border-border"} p-3`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${emphasis ? "text-primary" : ""}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function PipelineImpactPanel({
  impact,
  expanded,
  onToggle,
}: {
  impact: InFlightImpact;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visible = expanded ? impact.quotes : impact.quotes.slice(0, 5);
  return (
    <div className="rounded-md border border-primary/40 bg-card">
      <div className="p-3 border-b border-border">
        <div className="font-medium text-sm">Pipeline impact</div>
        <div className="text-xs text-muted-foreground">
          Approving this sheet would reprice {impact.affectedQuoteCount} open{" "}
          {impact.affectedQuoteCount === 1 ? "quote" : "quotes"} by{" "}
          <span className={impact.totalDeltaCents >= 0 ? "text-destructive" : "text-primary"}>
            {formatCents(impact.totalDeltaCents, { showSign: true })}
          </span>{" "}
          total.
        </div>
      </div>
      <div className="divide-y">
        {visible.map((q) => (
          <div key={q.quotePackageId} className="p-3 text-sm flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">
                {q.quoteNumber ?? "(no number)"} · {q.customerName ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {q.status} · {q.affectedLines.length} line{q.affectedLines.length === 1 ? "" : "s"} affected
              </div>
            </div>
            <div className={`font-mono font-medium text-sm ${q.deltaCents >= 0 ? "text-destructive" : "text-primary"}`}>
              {formatCents(q.deltaCents, { showSign: true })}
            </div>
          </div>
        ))}
      </div>
      {impact.quotes.length > 5 && (
        <div className="p-2 border-t text-center">
          <button onClick={onToggle} className="text-xs text-primary hover:underline">
            {expanded ? "Collapse" : `Show all ${impact.quotes.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

function ChangeList({
  changes,
  showAll,
  onToggle,
}: {
  changes: ModelPriceChange[];
  showAll: boolean;
  onToggle: () => void;
}) {
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes vs. prior sheet.</p>;
  }
  const visible = showAll ? changes : changes.slice(0, 10);

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="p-3 border-b border-border font-medium text-sm">
        Catalog changes ({changes.length})
      </div>
      <div className="divide-y">
        {visible.map((c) => (
          <ChangeRow key={c.modelCode + c.kind} change={c} />
        ))}
      </div>
      {changes.length > 10 && (
        <div className="p-2 border-t text-center">
          <button onClick={onToggle} className="text-xs text-primary hover:underline">
            {showAll ? "Collapse" : `Show all ${changes.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

function ChangeRow({ change }: { change: ModelPriceChange }) {
  const badge = (() => {
    switch (change.kind) {
      case "new":       return <Badge variant="default">New</Badge>;
      case "removed":   return <Badge variant="secondary">Removed</Badge>;
      case "increased": return <Badge variant="destructive">+{change.deltaPct.toFixed(1)}%</Badge>;
      case "decreased": return <Badge variant="default">{change.deltaPct.toFixed(1)}%</Badge>;
      case "unchanged": return <Badge variant="outline">Unchanged</Badge>;
    }
  })();

  const amount = (() => {
    if (change.kind === "new" && change.newPriceCents != null) return formatCents(change.newPriceCents);
    if (change.kind === "removed" && change.oldPriceCents != null) return `was ${formatCents(change.oldPriceCents)}`;
    if (change.oldPriceCents != null && change.newPriceCents != null) {
      return `${formatCents(change.oldPriceCents)} → ${formatCents(change.newPriceCents)}`;
    }
    return "";
  })();

  return (
    <div className="p-3 text-sm flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        {badge}
        <span className="font-mono truncate">{change.modelCode}</span>
        {change.nameDisplay && change.nameDisplay !== change.modelCode && (
          <span className="text-muted-foreground truncate">· {change.nameDisplay}</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground font-mono whitespace-nowrap">{amount}</div>
    </div>
  );
}

// ── Formatting helper ────────────────────────────────────────────────────

function formatCents(cents: number, opts: { showSign?: boolean } = {}): string {
  const abs = Math.abs(Math.round(cents / 100));
  const str = `$${abs.toLocaleString("en-US")}`;
  if (!opts.showSign) return str;
  if (cents > 0) return `+${str}`;
  if (cents < 0) return `−${str}`;
  return str;
}
