import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Clock3, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { fetchDealComposite } from "../lib/deal-composite-api";
import { buildDealCoachBoard } from "../lib/deal-coach";
import { readVoiceCaptureTimelineSignals } from "../lib/voice-capture-activity-metadata";
import { useQuoteVelocity } from "../command-center/hooks/useQuoteVelocity";
import { computeQuoteVelocity } from "../command-center/lib/quoteVelocity";
import { useBlockers } from "../command-center/hooks/useBlockers";
import { groupBlockedDeals } from "../command-center/lib/blockerTypes";
import type { TimeBankRow } from "../lib/time-bank";

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
  }
}

export function DealCoachPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const workspaceQuery = useMyWorkspaceId();
  const workspaceId = workspaceQuery.data ?? "default";

  const compositeQuery = useQuery({
    queryKey: ["deal-coach", dealId, "composite"],
    queryFn: () => fetchDealComposite(dealId!),
    enabled: Boolean(dealId),
    staleTime: 30_000,
  });

  const timeBankQuery = useQuery({
    queryKey: ["deal-coach", dealId, "time-bank", workspaceId],
    enabled: Boolean(dealId && workspaceId),
    queryFn: async (): Promise<TimeBankRow | null> => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: TimeBankRow[] | null; error: { message?: string } | null }>;
      }).rpc("qrm_time_bank", {
        p_workspace_id: workspaceId,
        p_default_budget_days: 14,
      });
      if (error) throw new Error(error.message ?? "Failed to load Time Bank.");
      return (data ?? []).find((row) => row.deal_id === dealId) ?? null;
    },
    staleTime: 60_000,
  });

  const quoteVelocity = useQuoteVelocity();
  const blockers = useBlockers();

  if (!dealId) {
    return <Navigate to="/qrm/deals" replace />;
  }

  const composite = compositeQuery.data;
  const quoteRows = quoteVelocity.data
    ? computeQuoteVelocity(quoteVelocity.data.packages, quoteVelocity.data.signatures, Date.now()).rows
    : [];
  const quote = quoteRows.find((row) => row.dealId === dealId) ?? null;

  const blocker = blockers.data
    ? groupBlockedDeals(blockers.data.deals, blockers.data.deposits, blockers.data.anomalies).groups
        .flatMap((group) => group.deals)
        .find((item) => item.dealId === dealId) ?? null
    : null;

  const voiceSignals = composite
    ? composite.activities
        .map((activity) => readVoiceCaptureTimelineSignals(activity))
        .filter((signal): signal is NonNullable<typeof signal> => signal != null)
    : [];

  const board = useMemo(
    () =>
      composite
        ? buildDealCoachBoard({
            composite,
            quote,
            timeBank: timeBankQuery.data ?? null,
            blocker,
            voiceSignals,
          })
        : null,
    [composite, quote, timeBankQuery.data, blocker, voiceSignals],
  );

  const loading =
    compositeQuery.isLoading ||
    workspaceQuery.isLoading ||
    timeBankQuery.isLoading ||
    quoteVelocity.isLoading ||
    blockers.isLoading;
  const error =
    compositeQuery.error ||
    timeBankQuery.error ||
    quoteVelocity.error ||
    blockers.error;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={`/qrm/deals/${dealId}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to deal
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}/room`}>Deal Room</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}`}>
              Open detail <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={composite?.deal.name ? `${composite.deal.name} — AI Deal Coach` : "AI Deal Coach"}
        subtitle="Per-opportunity coaching with confidence labels and traceable evidence from the live deal system."
      />

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading deal coaching…</Card>
      ) : error || !composite || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {error instanceof Error ? error.message : "Deal coaching is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Sparkles} label="Recommendations" value={String(board.summary.recommendationCount)} />
            <SummaryCard icon={AlertTriangle} label="Blockers" value={String(board.summary.blockerCount)} tone={board.summary.blockerCount > 0 ? "warn" : "default"} />
            <SummaryCard icon={Clock3} label="Quote Risk" value={board.summary.quoteRisk ? "Yes" : "No"} tone={board.summary.quoteRisk ? "warn" : "default"} />
            <SummaryCard icon={Sparkles} label="Field Signals" value={String(board.summary.voiceSignalCount)} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Coaching queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every recommendation includes a confidence label and a working trace so the rep can see why it is being suggested.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {board.recommendations.map((item) => (
                <div key={item.key} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{item.headline}</p>
                        <span className={`text-[11px] font-medium ${confidenceTone(item.confidence)}`}>
                          {item.confidence} confidence
                        </span>
                      </div>
                      <div className="mt-3 space-y-1">
                        {item.trace.map((line) => (
                          <p key={line} className="text-xs text-muted-foreground">
                            {line}
                          </p>
                        ))}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to={item.href}>
                        {item.actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}
