import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, AlertTriangle, FileText, Mail, ExternalLink, DollarSign, Layers, Users,
} from "lucide-react";
import {
  fetchImpactReport,
  draftRequote,
  type ImpactItem,
  type RequoteDraftResult,
} from "../lib/price-intelligence-api";
import { PriceFileUpload } from "../components/PriceFileUpload";

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

export function PriceIntelligencePage() {
  const queryClient = useQueryClient();
  const [selectedDraft, setSelectedDraft] = useState<RequoteDraftResult | null>(null);

  const { data: impactReport, isLoading: reportLoading, isError: reportError } = useQuery({
    queryKey: ["price-intelligence", "impact"],
    queryFn: fetchImpactReport,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const requoteMutation = useMutation({
    mutationFn: draftRequote,
    onSuccess: (data) => {
      setSelectedDraft(data);
      queryClient.invalidateQueries({ queryKey: ["price-intelligence", "impact"] });
    },
  });

  const items: ImpactItem[] = impactReport?.impact_items ?? [];
  const summary = impactReport?.summary;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-qep-orange" aria-hidden />
          <h1 className="text-xl font-bold text-foreground">Price File Intelligence</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload manufacturer price files. See which open quotes are affected. Draft requotes with one click.
        </p>
      </div>

      {/* Impact summary tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label="Quotes affected"
          value={summary?.total_quotes_affected ?? 0}
          icon={<FileText className="h-4 w-4 text-amber-400" />}
          accent="text-amber-400"
          loading={reportLoading}
        />
        <SummaryTile
          label="Deals affected"
          value={summary?.total_deals_affected ?? 0}
          icon={<Users className="h-4 w-4 text-blue-400" />}
          accent="text-blue-400"
          loading={reportLoading}
        />
        <SummaryTile
          label="Line items"
          value={items.length}
          icon={<Layers className="h-4 w-4 text-muted-foreground" />}
          loading={reportLoading}
        />
        <SummaryTile
          label="$ exposure"
          value={formatCurrency(summary?.total_dollar_exposure ?? 0)}
          icon={<DollarSign className="h-4 w-4 text-red-400" />}
          accent="text-red-400"
          loading={reportLoading}
        />
      </div>

      {/* Upload + Impact report two-column layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <PriceFileUpload
            onUploadSuccess={() => queryClient.invalidateQueries({ queryKey: ["price-intelligence", "impact"] })}
          />
        </div>

        {/* Impact report list */}
        <div className="lg:col-span-2">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />
              <h3 className="text-sm font-bold text-foreground">Affected Quotes</h3>
              <span className="text-[10px] text-muted-foreground">(sorted by $ impact)</span>
            </div>

            {reportLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
                ))}
              </div>
            )}

            {reportError && (
              <p className="text-xs text-red-400">Failed to load impact report.</p>
            )}

            {!reportLoading && !reportError && items.length === 0 && (
              <div className="rounded-md border border-dashed border-border p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  No quotes currently affected by price changes. Upload a new price file to trigger analysis.
                </p>
              </div>
            )}

            {!reportLoading && items.length > 0 && (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {items.map((item) => (
                  <ImpactRow
                    key={item.line_item_id}
                    item={item}
                    onRequote={() => requoteMutation.mutate(item.quote_package_id)}
                    requotePending={requoteMutation.isPending}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Draft modal */}
      {selectedDraft && (
        <DraftReviewModal
          draft={selectedDraft}
          onClose={() => setSelectedDraft(null)}
        />
      )}

      {requoteMutation.isError && (
        <Card className="border-red-500/20 bg-red-500/5 p-3">
          <p className="text-xs text-red-400">
            Requote failed: {(requoteMutation.error as Error)?.message ?? "unknown"}
          </p>
        </Card>
      )}
    </div>
  );
}

/* ── Subcomponents ───────────────────────────────────────────────── */

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
  item,
  onRequote,
  requotePending,
}: {
  item: ImpactItem;
  onRequote: () => void;
  requotePending: boolean;
}) {
  const delta = item.price_delta_total ?? 0;
  const deltaPositive = delta > 0;
  const changePct = item.price_change_pct ?? 0;

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
              {item.quote_status}
            </span>
            {item.price_change_source && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {item.price_change_source}
              </span>
            )}
            {item.price_changed_at && (
              <span className="text-[10px] text-muted-foreground">
                changed {new Date(item.price_changed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-foreground truncate">
            {item.make} {item.model}
          </p>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>was: {formatCurrency(item.quoted_list_price)}</span>
            <span>→</span>
            <span>now: {formatCurrency(item.current_list_price)}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-lg font-bold ${deltaPositive ? "text-red-400" : "text-emerald-400"}`}>
            {deltaPositive ? "+" : ""}{formatCurrency(Math.abs(delta))}
          </p>
          <p className={`text-[10px] ${deltaPositive ? "text-red-300" : "text-emerald-300"}`}>
            {deltaPositive ? "+" : ""}{changePct.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        {item.deal_id && (
          <Link to={`/crm/deals/${item.deal_id}`} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ExternalLink className="h-3 w-3" aria-hidden /> Open deal
          </Link>
        )}
        <Button
          size="sm"
          className="h-7 text-[11px]"
          onClick={onRequote}
          disabled={requotePending}
        >
          <Mail className="mr-1 h-3 w-3" />
          {requotePending ? "Drafting…" : "Draft requote"}
        </Button>
      </div>
    </div>
  );
}

function DraftReviewModal({ draft, onClose }: { draft: RequoteDraftResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-qep-orange" aria-hidden />
              <h3 className="text-sm font-bold text-foreground">Requote email draft</h3>
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                draft.email_draft.tone === "urgent" ? "bg-red-500/10 text-red-400" :
                draft.email_draft.tone === "friendly" ? "bg-emerald-500/10 text-emerald-400" :
                "bg-blue-500/10 text-blue-400"
              }`}>
                {draft.email_draft.tone}
              </span>
              {draft.email_draft.ai_generated && (
                <span className="rounded-full bg-qep-orange/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-qep-orange">
                  AI
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {draft.impact.line_items_affected} line item{draft.impact.line_items_affected === 1 ? "" : "s"} · {draft.impact.manufacturers} · effective {draft.impact.effective_date}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>×</Button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Subject</p>
            <p className="text-sm font-medium text-foreground border border-border rounded-md p-2 bg-card">
              {draft.email_draft.subject}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Body</p>
            <pre className="text-xs text-foreground border border-border rounded-md p-3 bg-card whitespace-pre-wrap font-sans leading-relaxed">
{draft.email_draft.body}
            </pre>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-2">
            <p className="text-[10px] text-muted-foreground">
              This draft has been saved to <code>email_drafts</code>. The rep reviews, edits, and sends it from their inbox — nothing auto-sends.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      </Card>
    </div>
  );
}
