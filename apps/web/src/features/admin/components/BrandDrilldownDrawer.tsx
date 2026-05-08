import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  MapPin,
  RadioTower,
  Sparkles,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UrgencyBadge, getUrgency } from "./UrgencyBadge";
import {
  formatCentsAsDollars,
  getBrandDrilldown,
  type BrandDrilldownDetail,
  type BrandPriceSheetSummary,
  type BrandSheetStatus,
} from "../lib/price-sheets-api";
import {
  isBrandQuoteReady,
  missingPrereqs,
  type BrandEngineStatusRow,
} from "../lib/deal-economics-api";
import {
  formatLastChecked,
  isOverdue,
  listRecentEventsForWorkspace,
  listSources,
  summarizeSourceHealth,
  type SheetSourceWithBrand,
  type SheetWatchEventRow,
} from "../lib/sheet-watchdog-api";

type ManagerSignal = {
  id: string;
  tone: "success" | "warning" | "destructive" | "secondary";
  title: string;
  description: string;
};

export interface BrandDrilldownDrawerProps {
  open: boolean;
  statusRow: BrandSheetStatus | null;
  onClose: () => void;
  onUpload: (brandId: string, brandCode: string, brandName: string) => void;
  onManageZones: (brandId: string, brandCode: string, brandName: string) => void;
  onOpenWatchdog: () => void;
  loadDetail?: typeof getBrandDrilldown;
  loadSources?: typeof listSources;
  loadEvents?: typeof listRecentEventsForWorkspace;
}

export function BrandDrilldownDrawer({
  open,
  statusRow,
  onClose,
  onUpload,
  onManageZones,
  onOpenWatchdog,
  loadDetail = getBrandDrilldown,
  loadSources = listSources,
  loadEvents = listRecentEventsForWorkspace,
}: BrandDrilldownDrawerProps) {
  const [detail, setDetail] = useState<BrandDrilldownDetail | null>(null);
  const [sources, setSources] = useState<SheetSourceWithBrand[]>([]);
  const [events, setEvents] = useState<SheetWatchEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !statusRow?.brand_id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setSources([]);
    setEvents([]);

    Promise.all([
      loadDetail(statusRow.brand_id),
      loadSources(),
      loadEvents(100),
    ])
      .then(([drilldownResult, sourceRows, eventRows]) => {
        if (cancelled) return;
        if ("error" in drilldownResult) {
          setError(drilldownResult.error);
          return;
        }
        setDetail(drilldownResult.detail);
        setSources(sourceRows);
        setEvents(eventRows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadDetail, loadEvents, loadSources, open, statusRow?.brand_id]);

  const brandSources = useMemo(
    () => (statusRow ? sources.filter((source) => source.brand_id === statusRow.brand_id) : []),
    [sources, statusRow],
  );

  const sourceEventsById = useMemo(() => {
    const sourceIds = new Set(brandSources.map((source) => source.id));
    const grouped = new Map<string, SheetWatchEventRow[]>();
    for (const event of events) {
      if (!sourceIds.has(event.source_id)) continue;
      const bucket = grouped.get(event.source_id) ?? [];
      bucket.push(event);
      grouped.set(event.source_id, bucket);
    }
    return grouped;
  }, [brandSources, events]);

  const sourceHealthRows = useMemo(() => {
    return brandSources.map((source) => {
      const sourceEvents = sourceEventsById.get(source.id) ?? [];
      return {
        source,
        health: summarizeSourceHealth(source, sourceEvents),
        overdue: isOverdue(source),
      };
    });
  }, [brandSources, sourceEventsById]);

  const readinessRow = useMemo<BrandEngineStatusRow | null>(() => {
    if (!statusRow) return null;
    return {
      id: statusRow.brand_id,
      code: statusRow.brand_code,
      name: statusRow.brand_name,
      discount_configured: detail?.readiness.dealEngineEnabled ?? statusRow.discount_configured,
      has_inbound_freight_key: detail?.readiness.hasInboundFreightKey ?? statusRow.has_inbound_freight_key,
      published_sheet_count: detail?.readiness.publishedSheetCount ?? (statusRow.has_active_sheet ? 1 : 0),
      freight_zone_count: detail?.readiness.freightZoneCount ?? statusRow.freight_zone_count,
      active_program_count: detail?.readiness.activeProgramCount ?? 0,
    };
  }, [detail, statusRow]);

  const unhealthySourceCount = sourceHealthRows.filter((row) => row.health.isUnhealthy).length;
  const overdueSourceCount = sourceHealthRows.filter((row) => row.overdue).length;
  const quoteReady = readinessRow ? isBrandQuoteReady(readinessRow) : false;
  const missing = readinessRow ? missingPrereqs(readinessRow) : [];
  const signals = useMemo(() => {
    if (!statusRow || !readinessRow) return [];
    return buildManagerSignals({
      statusRow,
      detail,
      readinessRow,
      activeSourceCount: brandSources.filter((source) => source.active).length,
      unhealthySourceCount,
      overdueSourceCount,
    });
  }, [brandSources, detail, overdueSourceCount, readinessRow, statusRow, unhealthySourceCount]);

  function withBrand(action: (brandId: string, brandCode: string, brandName: string) => void) {
    if (!statusRow) return;
    onClose();
    action(statusRow.brand_id, statusRow.brand_code, statusRow.brand_name);
  }

  function openWatchdog() {
    onClose();
    onOpenWatchdog();
  }

  const activeSheet = detail?.activeSheet ?? null;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader className="mb-5">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            Brand detail
            {statusRow ? <Badge variant="outline">{statusRow.brand_code}</Badge> : null}
            {statusRow ? <UrgencyBadge lastUploadedAt={statusRow.last_uploaded_at} /> : null}
          </SheetTitle>
          <SheetDescription>
            {statusRow ? (
              <>
                Manager view for <span className="font-medium">{statusRow.brand_name}</span>: pricing,
                sheet freshness, freight coverage, Deal Engine readiness, and watchdog health.
              </>
            ) : (
              "Select a brand to inspect pricing and operational readiness."
            )}
          </SheetDescription>
        </SheetHeader>

        {!statusRow ? (
          <EmptyState message="No brand selected." />
        ) : loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading brand detail…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Could not load brand detail</div>
                <div className="mt-1 text-xs">{error}</div>
              </div>
            </div>
          </div>
        ) : detail && readinessRow ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <MetricCard label="Active sheet" value={activeSheet?.version ?? "None"} detail={activeSheet?.published_at ? `Published ${formatDate(activeSheet.published_at)}` : "No published sheet"} />
              <MetricCard label="Products" value={detail.products.loadedCount.toLocaleString()} detail={detail.products.hasMore ? `First ${detail.products.limit} loaded` : "Active model rows"} />
              <MetricCard label="Pending uploads" value={detail.pendingSheets.length.toLocaleString()} detail={detail.pendingSheets.length > 0 ? "Needs manager attention" : "Clear"} />
              <MetricCard label="Freight coverage" value={`${detail.freight.coverage.covered.length}/50`} detail={`${detail.freight.zones.length} zones · ${detail.freight.coverage.uncovered.length} gaps`} />
              <MetricCard label="Watchdog health" value={`${brandSources.filter((source) => source.active).length} active`} detail={`${unhealthySourceCount} unhealthy · ${overdueSourceCount} overdue`} />
            </div>

            <Section title="Manager signals" icon={<AlertCircle className="h-4 w-4" />}>
              <div className="space-y-2">{signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
            </Section>

            <Section title="Manager actions" icon={<Sparkles className="h-4 w-4" />}>
              <div className="grid gap-2 sm:grid-cols-3">
                <Button size="sm" onClick={() => withBrand(onUpload)}><Upload className="h-3.5 w-3.5" /> Upload new sheet</Button>
                <Button size="sm" variant="outline" onClick={() => withBrand(onManageZones)}><MapPin className="h-3.5 w-3.5" /> Manage freight zones</Button>
                <Button size="sm" variant="outline" onClick={openWatchdog}><RadioTower className="h-3.5 w-3.5" /> Open Watchdog</Button>
              </div>
            </Section>

            <Section title="Products & pricing" icon={<FileText className="h-4 w-4" />}>
              {detail.products.rows.length === 0 ? (
                <EmptyState message={activeSheet ? "No model price rows were extracted for the active sheet." : "No active published sheet yet."} />
              ) : (
                <>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Model</th>
                          <th className="px-3 py-2 font-medium">Name / description</th>
                          <th className="px-3 py-2 font-medium">Category</th>
                          <th className="px-3 py-2 text-right font-medium">List price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.products.rows.map((product) => (
                          <tr key={product.id} className="border-b last:border-0">
                            <td className="px-3 py-2 font-mono text-xs font-medium">{product.model_code}</td>
                            <td className="px-3 py-2 text-muted-foreground">{product.name_display ?? "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{product.category ?? "—"}</td>
                            <td className="px-3 py-2 text-right font-medium">{product.list_price_cents == null ? "—" : `$${formatCentsAsDollars(product.list_price_cents)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {detail.products.hasMore ? <p className="text-xs text-muted-foreground">Showing first {detail.products.loadedCount.toLocaleString()} products.</p> : null}
                </>
              )}
            </Section>

            <Section title="Sheet metadata & history" icon={<Clock className="h-4 w-4" />}>
              <div className="grid gap-3 lg:grid-cols-2">
                <Card className="p-3"><div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Active sheet</div>{activeSheet ? <SheetSummary sheet={activeSheet} /> : <p className="text-sm text-muted-foreground">No published sheet.</p>}</Card>
                <Card className="p-3"><div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Pending uploads ({detail.pendingSheets.length})</div>{detail.pendingSheets.length === 0 ? <p className="text-sm text-muted-foreground">No pending extraction or review work.</p> : <div className="space-y-2">{detail.pendingSheets.map((sheet) => <SheetSummary key={sheet.id} sheet={sheet} compact />)}</div>}</Card>
              </div>
              <div className="space-y-2"><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Recent history</div>{detail.sheetHistory.length === 0 ? <EmptyState message="No uploaded sheets found for this brand." /> : detail.sheetHistory.map((sheet) => <SheetSummary key={sheet.id} sheet={sheet} compact />)}</div>
            </Section>

            <Section title="Operational readiness" icon={<CheckCircle2 className="h-4 w-4" />}>
              <div className="grid gap-3 lg:grid-cols-3">
                <ReadinessCard title="Freight readiness" badge={detail.freight.coverage.uncovered.length === 0 ? "Covered" : "Gaps"} badgeVariant={detail.freight.coverage.uncovered.length === 0 ? "success" : "warning"} rows={[["Zones", detail.freight.zones.length.toLocaleString()], ["Covered states", detail.freight.coverage.covered.length.toLocaleString()], ["Uncovered states", detail.freight.coverage.uncovered.length.toLocaleString()], ["Overlaps", detail.freight.coverage.overlaps.length.toLocaleString()]]} />
                <ReadinessCard title="Deal Engine readiness" badge={quoteReady && readinessRow.discount_configured ? "Live" : quoteReady ? "Ready" : "Blocked"} badgeVariant={quoteReady && readinessRow.discount_configured ? "success" : quoteReady ? "outline" : "destructive"} rows={[["Published sheets", readinessRow.published_sheet_count.toLocaleString()], ["Freight zones", readinessRow.freight_zone_count.toLocaleString()], ["Active programs", readinessRow.active_program_count.toLocaleString()], ["Inbound freight key", readinessRow.has_inbound_freight_key ? "Yes" : "No"], ["Missing prereqs", missing.length > 0 ? missing.join(", ") : "None"]]} />
                <ReadinessCard title="Watchdog / source health" badge={unhealthySourceCount > 0 || overdueSourceCount > 0 ? "Needs review" : "Healthy"} badgeVariant={unhealthySourceCount > 0 ? "destructive" : overdueSourceCount > 0 ? "warning" : "success"} rows={[["Sources", brandSources.length.toLocaleString()], ["Active", brandSources.filter((source) => source.active).length.toLocaleString()], ["Unhealthy", unhealthySourceCount.toLocaleString()], ["Overdue", overdueSourceCount.toLocaleString()]]} />
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Watchdog sources</div>
                {sourceHealthRows.length === 0 ? <EmptyState message="No watchdog sources are configured for this brand." /> : sourceHealthRows.map(({ source, health, overdue }) => (
                  <Card key={source.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-sm">{source.label}</span><Badge variant={source.active ? "success" : "outline"} className="text-[10px]">{source.active ? "Active" : "Paused"}</Badge>{health.isUnhealthy ? <Badge variant="destructive" className="text-[10px]">Unhealthy</Badge> : null}{overdue ? <Badge variant="warning" className="text-[10px]">Overdue</Badge> : null}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatLastChecked(source.last_checked_at)} · {health.counts.change_detected} changes · {health.counts.error} errors</div>
                        {source.last_error ? <div className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive">{source.last_error}</div> : null}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">Every {source.check_freq_hours}h</div>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>
          </div>
        ) : (
          <EmptyState message="No detail loaded for this brand." />
        )}
      </SheetContent>
    </Sheet>
  );
}

function buildManagerSignals({ statusRow, detail, readinessRow, activeSourceCount, unhealthySourceCount, overdueSourceCount }: { statusRow: BrandSheetStatus; detail: BrandDrilldownDetail | null; readinessRow: BrandEngineStatusRow; activeSourceCount: number; unhealthySourceCount: number; overdueSourceCount: number; }): ManagerSignal[] {
  const signals: ManagerSignal[] = [];
  const urgency = getUrgency(statusRow.last_uploaded_at);
  const quoteReady = isBrandQuoteReady(readinessRow);
  const missing = missingPrereqs(readinessRow);

  if (!statusRow.has_active_sheet) signals.push({ id: "missing-sheet", tone: "destructive", title: "No live pricing sheet", description: "Upload and publish a price sheet before reps quote this brand." });
  else if (urgency === "urgent") signals.push({ id: "urgent-freshness", tone: "destructive", title: "Pricing is urgent", description: "The active sheet is over 60 days old. Confirm manufacturer pricing before approving deals." });
  else if (urgency === "stale") signals.push({ id: "stale-freshness", tone: "warning", title: "Pricing is getting stale", description: "The active sheet is over 14 days old. Schedule a source check or upload a newer sheet." });

  const pendingCount = detail?.pendingSheets.length ?? statusRow.pending_review_count;
  if (pendingCount > 0) signals.push({ id: "pending-uploads", tone: "warning", title: "Pending uploads need review", description: `${pendingCount} sheet(s) are still extracting, extracted, or pending review.` });

  const uncoveredCount = detail?.freight.coverage.uncovered.length ?? (statusRow.freight_zone_count === 0 ? 50 : 0);
  if (uncoveredCount > 0) signals.push({ id: "freight-gaps", tone: "warning", title: "Freight coverage has gaps", description: `${uncoveredCount} states have no freight zone coverage.` });

  const overlapCount = detail?.freight.coverage.overlaps.length ?? 0;
  if (overlapCount > 0) signals.push({ id: "freight-overlaps", tone: "warning", title: "Freight zones overlap", description: `${overlapCount} states are claimed by multiple zones.` });

  if (!quoteReady) signals.push({ id: "quote-blocked", tone: "destructive", title: "Deal Engine quotes are blocked", description: `Missing ${missing.join(" and ")}. Configure prerequisites before enabling manager confidence.` });
  else if (!readinessRow.discount_configured) signals.push({ id: "deal-engine-disabled", tone: "secondary", title: "Deal Engine is disabled", description: "Prerequisites are present, but AI scenarios will stay off until the brand is enabled." });

  if (unhealthySourceCount > 0) signals.push({ id: "watchdog-unhealthy", tone: "destructive", title: "Watchdog source unhealthy", description: `${unhealthySourceCount} source(s) have recent errors or repeated failures.` });
  else if (overdueSourceCount > 0) signals.push({ id: "watchdog-overdue", tone: "warning", title: "Watchdog source overdue", description: `${overdueSourceCount} active source(s) are past their configured check cadence.` });
  else if (activeSourceCount === 0) signals.push({ id: "watchdog-missing", tone: "secondary", title: "No active watchdog source", description: "Add a manufacturer source if managers need automated change detection for this brand." });

  if (signals.length === 0) signals.push({ id: "ready", tone: "success", title: "Brand is manager-ready", description: "Pricing, freight, Deal Engine prerequisites, and watchdog source health are all clear." });
  return signals;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold">{icon}<span>{title}</span></div>{children}</section>;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card className="p-3"><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></Card>;
}

function SignalCard({ signal }: { signal: ManagerSignal }) {
  const className = signal.tone === "success" ? "border-success/30 bg-success/10" : signal.tone === "destructive" ? "border-destructive/30 bg-destructive/10" : signal.tone === "warning" ? "border-warning/30 bg-warning/10" : "border-border bg-muted/20";
  const iconClass = signal.tone === "success" ? "text-success" : signal.tone === "destructive" ? "text-destructive" : signal.tone === "warning" ? "text-warning" : "text-muted-foreground";
  return <div className={`flex items-start gap-3 rounded-md border p-3 ${className}`}>{signal.tone === "success" ? <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} /> : <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />}<div><div className="text-sm font-medium">{signal.title}</div><div className="mt-1 text-xs text-muted-foreground">{signal.description}</div></div></div>;
}

function SheetSummary({ sheet, compact = false }: { sheet: BrandPriceSheetSummary; compact?: boolean }) {
  return <div className={compact ? "rounded-md border border-border p-2" : "space-y-2"}><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-sm">{sheet.filename ?? "Unnamed sheet"}</span><Badge variant={sheet.status === "published" ? "success" : "warning"} className="text-[10px]">{sheet.status.replace(/_/g, " ")}</Badge>{sheet.version ? <Badge variant="outline" className="text-[10px]">{sheet.version}</Badge> : null}</div><div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2"><div>Type: {sheet.sheet_type ?? sheet.file_type ?? "—"}</div><div>Uploaded: {formatDateTime(sheet.uploaded_at)}</div><div>Published: {formatDateTime(sheet.published_at)}</div><div>Created: {formatDateTime(sheet.created_at)}</div></div></div>;
}

function ReadinessCard({ title, badge, badgeVariant, rows }: { title: string; badge: string; badgeVariant: "success" | "warning" | "destructive" | "outline"; rows: Array<[string, string]> }) {
  return <Card className="p-3"><div className="mb-3 flex items-center justify-between gap-2"><div className="text-sm font-medium">{title}</div><Badge variant={badgeVariant} className="text-[10px]">{badge}</Badge></div><div className="space-y-1.5 text-xs">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>)}</div></Card>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{message}</div>;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : "—";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}
