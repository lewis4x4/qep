import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  FileText,
  Layers,
  Mail,
  ShieldAlert,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";
import { AskIronAdvisorButton } from "@/components/primitives";
import {
  createRepriceDraft,
  fetchRepPriceImpacts,
  type CreateRepriceDraftResponse,
  type RepPriceImpact,
} from "../lib/price-intelligence-api";

const PRICE_INTELLIGENCE_IMPACTS_QUERY_KEY = ["price-intelligence", "phase1-impacts"] as const;

function formatCents(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const dollars = Math.abs(value) / 100;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (dollars >= 1_000_000) return `${sign}$${(dollars / 1_000_000).toFixed(2)}M`;
  if (dollars >= 1_000) return `${sign}$${(dollars / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(dollars).toLocaleString()}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function quoteLabel(impact: RepPriceImpact): string {
  const compact = impact.quotePackageId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return compact ? `Quote ${compact}` : "Quote";
}

function approvalCopy(impact: RepPriceImpact): string {
  if (!impact.requiresManagerReview) return "Rep draft allowed";
  if (impact.approvalRequiredReasons.length === 0) return "Manager review required";
  return impact.approvalRequiredReasons
    .map((reason) => reason.replace(/_/g, " "))
    .join(" · ");
}

export function PriceIntelligencePage() {
  const queryClient = useQueryClient();
  const [selectedDraft, setSelectedDraft] = useState<CreateRepriceDraftResponse | null>(null);

  const impactsQuery = useQuery({
    queryKey: PRICE_INTELLIGENCE_IMPACTS_QUERY_KEY,
    queryFn: fetchRepPriceImpacts,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const draftMutation = useMutation({
    mutationFn: (impact: RepPriceImpact) => createRepriceDraft(impact.id),
    onSuccess: (data) => {
      setSelectedDraft(data);
      void queryClient.invalidateQueries({ queryKey: PRICE_INTELLIGENCE_IMPACTS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["sales", "price-impacts"] });
    },
  });

  const impacts = impactsQuery.data?.impacts ?? [];
  const summary = impactsQuery.data?.summary;
  const visibleCount = summary?.visibleImpactCount ?? impacts.length;
  const totalLines = impacts.reduce((count, impact) => count + impact.lines.length, 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Price File Intelligence</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Phase 1 now reads persisted OEM price impacts from the staged admin upload workflow. Direct CSV/XLS imports are not part of the rep or manager path.
          </p>
        </div>
        <AskIronAdvisorButton contextType="price_intelligence" variant="inline" />
      </div>

      <Card className="border-qep-orange/25 bg-qep-orange/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Upload className="mt-0.5 h-5 w-5 shrink-0 text-qep-orange" aria-hidden />
            <div>
              <h2 className="text-sm font-bold text-foreground">Phase 1 upload lane is admin-staged</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload, diff review, publish, and impact persistence happen in Admin Price Sheets. This page only reviews published material impacts and creates rep-review drafts; customer emails are never auto-sent.
              </p>
            </div>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link to="/admin/price-sheets">Open admin price sheets</Link>
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label="Visible impacts"
          value={visibleCount}
          icon={<FileText className="h-4 w-4 text-amber-400" />}
          accent="text-amber-400"
          loading={impactsQuery.isLoading}
        />
        <SummaryTile
          label="Quotes affected"
          value={summary?.affectedQuoteCount ?? visibleCount}
          icon={<Users className="h-4 w-4 text-blue-400" />}
          accent="text-blue-400"
          loading={impactsQuery.isLoading}
        />
        <SummaryTile
          label="Impacted lines"
          value={totalLines}
          icon={<Layers className="h-4 w-4 text-muted-foreground" />}
          loading={impactsQuery.isLoading}
        />
        <SummaryTile
          label="Exposure"
          value={formatCents(summary?.totalDeltaCents ?? 0)}
          icon={<DollarSign className="h-4 w-4 text-red-400" />}
          accent="text-red-400"
          loading={impactsQuery.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_2fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
              <h3 className="text-sm font-bold text-foreground">Legacy lane guardrail</h3>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The old direct upload importer is intentionally hidden here to avoid conflicting OEM catalog state. If legacy CSV/XLS import is needed, keep it as an admin-only compatibility tool outside Phase 1.
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-qep-orange" aria-hidden />
              <h3 className="text-sm font-bold text-foreground">Draft policy</h3>
            </div>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <li>• Reprice drafts are created from persisted impact IDs.</li>
              <li>• Manager review follows the Phase 1 approval policy.</li>
              <li>• Email drafts are review-only; no customer auto-send.</li>
            </ul>
          </Card>
        </div>

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />
            <h3 className="text-sm font-bold text-foreground">Published OEM impacts</h3>
            <span className="text-[10px] text-muted-foreground">(persisted Phase 1 queue)</span>
            <Button asChild size="sm" variant="outline" className="ml-auto h-7 text-[10px]">
              <Link to="/sales/price-impacts">Open rep review page</Link>
            </Button>
          </div>

          {draftMutation.isError && (
            <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-400">
              Reprice draft failed: {(draftMutation.error as Error)?.message ?? "unknown"}
            </div>
          )}

          {impactsQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 rounded-md bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {impactsQuery.isError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4">
              <p className="text-xs text-red-400">Failed to load persisted OEM price impacts.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void impactsQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!impactsQuery.isLoading && !impactsQuery.isError && impacts.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-4 text-center">
              <p className="text-xs text-muted-foreground">
                No material OEM impacts are currently visible. Publish a staged admin price sheet to create the Phase 1 impact queue.
              </p>
            </div>
          )}

          {!impactsQuery.isLoading && impacts.length > 0 && (
            <div className="space-y-2 max-h-[640px] overflow-y-auto">
              {impacts
                .slice()
                .sort((a, b) => Math.abs(b.totalDeltaCents) - Math.abs(a.totalDeltaCents))
                .map((impact) => (
                  <ImpactRow
                    key={impact.id}
                    impact={impact}
                    onDraft={() => draftMutation.mutate(impact)}
                    draftPending={draftMutation.isPending && draftMutation.variables?.id === impact.id}
                  />
                ))}
            </div>
          )}
        </Card>
      </div>

      {selectedDraft && (
        <DraftResultModal
          draft={selectedDraft}
          onClose={() => setSelectedDraft(null)}
        />
      )}
    </div>
  );
}

function SummaryTile({
  label, value, icon, accent, loading,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  accent?: string;
  loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-16 rounded bg-muted animate-pulse" />
      ) : (
        <p className={`mt-2 text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
      )}
    </Card>
  );
}

function ImpactRow({
  impact,
  onDraft,
  draftPending,
}: {
  impact: RepPriceImpact;
  onDraft: () => void;
  draftPending: boolean;
}) {
  const canCreateDraft = impact.state === "visible";
  const topLines = impact.lines.slice(0, 2).map((line) => line.modelCode).join(", ") || "Impacted equipment";

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
              {impact.quoteStatus ?? "open quote"}
            </span>
            <span className="rounded-full bg-qep-orange/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-qep-orange">
              {impact.state.replace(/_/g, " ")}
            </span>
            {impact.requiresManagerReview && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">
                <ShieldAlert className="h-3 w-3" aria-hidden /> approval
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-foreground truncate">
            {quoteLabel(impact)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground truncate">
            {topLines} · margin {formatPercent(impact.oldMarginPct)} → {formatPercent(impact.projectedMarginPct)} · commission {formatCents(impact.commissionDeltaCents)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {approvalCopy(impact)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-lg font-bold ${impact.totalDeltaCents > 0 ? "text-red-400" : "text-emerald-400"}`}>
            {formatCents(impact.totalDeltaCents)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            max line {formatPercent(impact.maxLineDeltaPct)}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        {impact.dealId && (
          <Link to={`/crm/deals/${impact.dealId}`} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ExternalLink className="h-3 w-3" aria-hidden /> Open deal
          </Link>
        )}
        <Link to={`/sales/quotes/${impact.quotePackageId}`} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ExternalLink className="h-3 w-3" aria-hidden /> Open quote
        </Link>
        <Button
          size="sm"
          className="h-7 text-[11px]"
          onClick={onDraft}
          disabled={!canCreateDraft || draftPending}
        >
          <Mail className="mr-1 h-3 w-3" />
          {draftPending ? "Drafting…" : impact.requiresManagerReview ? "Submit approval" : "Create draft"}
        </Button>
      </div>
    </div>
  );
}

function DraftResultModal({ draft, onClose }: { draft: CreateRepriceDraftResponse; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card
        className="w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-qep-orange" aria-hidden />
              <h3 className="text-sm font-bold text-foreground">
                {draft.approvalRequired ? "Approval submitted" : "Reprice draft created"}
              </h3>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Status: {draft.status.replace(/_/g, " ")}
              {draft.emailDraftId ? ` · Email draft ${draft.emailDraftId.slice(0, 8)}` : ""}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>×</Button>
        </div>

        <div className="mt-4 rounded-md border border-border/60 bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            The Phase 1 server created this from a persisted impact record. A rep or manager must review any generated email draft before customer communication.
          </p>
          {draft.approvalReasons.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-300">
              Approval reasons: {draft.approvalReasons.join(", ")}
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      </Card>
    </div>
  );
}
