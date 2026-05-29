/**
 * WatchdogApprovalCard — staged OEM price-sheet review surface.
 *
 * Despite the legacy component name, this now handles both watchdog and manual
 * admin uploads. Preview/publish authority lives in the oem-price-feeds server
 * API so upload no longer auto-publishes or computes quote impact client-side.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Send, Sparkles, XCircle } from "lucide-react";
import { rejectStagedSheet } from "../lib/price-sheets-api";
import {
  getSheetDiffPreview,
  publishSheetAndCreateImpacts,
  type InFlightImpact,
  type ModelPriceChange,
  type SheetDiff,
  type SheetDiffPreview,
} from "../lib/sheet-diff-api";

export interface WatchdogApprovalCardProps {
  priceSheetId: string;
  brandName: string | null;
  sourceLabel: string | null;
  onReview?: () => void;
  onMutated?: () => void;
}

export function WatchdogApprovalCard({
  priceSheetId,
  brandName,
  sourceLabel,
  onReview,
  onMutated,
}: WatchdogApprovalCardProps) {
  const { profile } = useAuth();
  const [preview, setPreview] = useState<SheetDiffPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [showAffected, setShowAffected] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreviewError(null);
    setActionError(null);
    setActionMessage(null);
    (async () => {
      try {
        const next = await getSheetDiffPreview(priceSheetId);
        if (!cancelled) setPreview(next);
      } catch (e) {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : "Preview failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [priceSheetId, reloadKey]);

  async function handlePublish() {
    setPublishing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await publishSheetAndCreateImpacts(priceSheetId);
      if ("error" in result) {
        setActionError(result.error);
        return;
      }
      setActionMessage(
        `Published. ${result.itemsApplied} items applied; ${result.materialQuotesAffected} material quote impacts are ready for reps.`,
      );
      onMutated?.();
    } finally {
      setPublishing(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await rejectStagedSheet(priceSheetId, profile?.id);
      if ("error" in result) {
        setActionError(result.error);
        return;
      }
      setActionMessage("Rejected staged sheet. It will not publish to reps.");
      onMutated?.();
    } finally {
      setRejecting(false);
    }
  }

  const diff = preview?.diff ?? null;
  const impact = preview?.impact ?? null;
  const source = sourceLabel ?? "manual upload";

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold">Staged price book review</span>
          {brandName && <Badge variant="outline">{brandName}</Badge>}
          <span className="text-xs text-muted-foreground">via {source}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          This sheet is staged for review. Server preview compares it to current OEM prices,
          estimates quote impact, and publish will notify reps through persisted price impacts.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading server preview…</p>
        ) : previewError ? (
          <div className="space-y-3">
            <Message tone="error" title="Couldn't preview sheet" message={previewError} />
            {actionError && <Message tone="error" title="Review action failed" message={actionError} />}
            {actionMessage && <Message tone="success" title="Review action complete" message={actionMessage} />}
            {/* A failed preview must not strand the admin with no actions: let
                them retry the preview or reject the sheet outright. Publish is
                intentionally withheld until a preview succeeds. */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)} disabled={rejecting}>
                <Loader2 className="mr-1.5 h-3.5 w-3.5" />
                Retry preview
              </Button>
              <Button size="sm" variant="outline" onClick={handleReject} disabled={rejecting}>
                {rejecting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                Reject sheet
              </Button>
            </div>
          </div>
        ) : diff ? (
          <>
            {actionError && <Message tone="error" title="Review action failed" message={actionError} />}
            {actionMessage && <Message tone="success" title="Review action complete" message={actionMessage} />}
            <HeadlineStrip diff={diff} impact={impact} />
            {preview && <ServerPreviewBadges preview={preview} />}

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

            <div className="flex flex-wrap gap-2 pt-2">
              {onReview && (
                <Button size="sm" variant="outline" onClick={onReview}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Review items
                </Button>
              )}
              <Button size="sm" onClick={handlePublish} disabled={publishing || rejecting}>
                {publishing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                Publish &amp; notify reps
              </Button>
              <Button size="sm" variant="outline" onClick={handleReject} disabled={publishing || rejecting}>
                {rejecting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                Reject sheet
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No preview data available yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function Message({ tone, title, message }: { tone: "success" | "error"; title: string; message: string }) {
  const error = tone === "error";
  return (
    <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${error ? "border-destructive/40 bg-destructive/5" : "border-success/30 bg-success/10"}`}>
      {error ? <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />}
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}

function ServerPreviewBadges({ preview }: { preview: SheetDiffPreview }) {
  const freightChanges = preview.diff.items.filter(
    (i) => i.itemType === "freight" && i.changeKind !== "unchanged",
  ).length;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <Badge variant="outline">{preview.impactPreview.materialQuotesAffected} material quote impacts</Badge>
      <Badge variant="secondary">{preview.impactPreview.quietQuotesAffected} quiet impacts</Badge>
      {freightChanges > 0 && (
        <Badge variant="warning">{freightChanges} freight zone {freightChanges === 1 ? "change" : "changes"}</Badge>
      )}
      {preview.impactPreview.needsApprovalCount > 0 && (
        <Badge variant="warning">{preview.impactPreview.needsApprovalCount} need manager review</Badge>
      )}
      {preview.impactPreview.stockLockedLineCount > 0 && (
        <Badge variant="warning">{preview.impactPreview.stockLockedLineCount} stock-locked lines</Badge>
      )}
    </div>
  );
}

function HeadlineStrip({ diff, impact }: { diff: SheetDiff & { changedItemCount?: number }; impact: InFlightImpact | null }) {
  const s = diff.summary;
  // Count ALL changed items (list price + freight + programs), not just model
  // changes, so a freight/program-only sheet doesn't read as "0 changes".
  const totalChanges = diff.changedItemCount ?? s.totalChanges;
  const netDeltaFmt = formatCents(s.totalDeltaCents, { showSign: true });
  const impactFmt = impact ? formatCents(impact.totalDeltaCents, { showSign: true }) : "—";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
      <Stat label="Total changes" value={totalChanges.toString()} hint={`${s.newModels} new · ${s.removedModels} removed (models)`} />
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
        label="Material quotes"
        value={impact ? impact.affectedQuoteCount.toString() : "—"}
        hint={`Δ ${impactFmt} across preview`}
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
        <div className="font-medium text-sm">Server impact preview</div>
        <div className="text-xs text-muted-foreground">
          Publishing this sheet will make {impact.affectedQuoteCount} material{" "}
          {impact.affectedQuoteCount === 1 ? "quote impact" : "quote impacts"} visible to reps, totaling{" "}
          <span className={impact.totalDeltaCents >= 0 ? "text-destructive" : "text-primary"}>
            {formatCents(impact.totalDeltaCents, { showSign: true })}
          </span>.
        </div>
      </div>
      <div className="divide-y">
        {visible.map((q) => (
          <div key={q.quotePackageId} className="p-3 text-sm flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">Quote {q.quotePackageId.slice(0, 8)}…</div>
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
            {expanded
              ? "Collapse"
              : impact.affectedQuoteCount > impact.quotes.length
              ? `Show ${impact.quotes.length} of ${impact.affectedQuoteCount}`
              : `Show all ${impact.quotes.length}`}
          </button>
        </div>
      )}
      {expanded && impact.affectedQuoteCount > impact.quotes.length && (
        <div className="p-2 border-t text-center text-[11px] text-muted-foreground">
          Showing the top {impact.quotes.length} of {impact.affectedQuoteCount} impacted quotes — open Review items for the rest.
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
    return <p className="text-sm text-muted-foreground">No list-price changes vs. current catalog.</p>;
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
