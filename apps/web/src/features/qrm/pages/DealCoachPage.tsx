import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Clock3, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
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
    enabled: Boolean(dealId) && Boolean(workspaceId),
    queryFn: async (): Promise<TimeBankRow | null> => {
      const { data, error } = await supabase.rpc("qrm_time_bank", {
        p_workspace_id: workspaceId,
        p_default_budget_days: 14,
      });
      if (error) throw new Error(error.message ?? "Failed to load Time Bank.");
      const rows = (data ?? []) as Array<TimeBankRow & { deal_id?: string }>;
      return rows.find((row) => row.deal_id === dealId) ?? null;
    },
    staleTime: 60_000,
  });

  const quoteVelocity = useQuoteVelocity();
  const blockers = useBlockers();

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

  const loading =
    compositeQuery.isLoading ||
    workspaceQuery.isLoading ||
    timeBankQuery.isLoading ||
    quoteVelocity.isLoading ||
    blockers.isLoading;

  const errorMessage =
    compositeQuery.error instanceof Error
      ? compositeQuery.error.message
      : workspaceQuery.error instanceof Error
        ? workspaceQuery.error.message
        : timeBankQuery.error instanceof Error
          ? timeBankQuery.error.message
          : quoteVelocity.error instanceof Error
            ? quoteVelocity.error.message
            : blockers.error instanceof Error
              ? blockers.error.message
              : null;

  const board = useMemo(
    () =>
      composite
        ? buildDealCoachBoard({
            composite,
            quote,
            timeBank: timeBankQuery.data ?? null,
            blocker,
            voiceSignals: composite.activities
              .map((activity) => readVoiceCaptureTimelineSignals(activity))
              .filter((signal): signal is NonNullable<ReturnType<typeof readVoiceCaptureTimelineSignals>> => signal != null),
          })
        : null,
    [composite, quote, blocker, timeBankQuery.data],
  );

  if (!dealId) {
    return <Navigate to="/qrm/deals" replace />;
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (errorMessage || !composite) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">{errorMessage ?? "Deal coaching is unavailable right now."}</p>
        </DeckSurface>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={`/qrm/deals/${dealId}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to deal
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}/room`}>Deal Room</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}/decision-room`}>Decision Room Simulator</Link>
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
        subtitle="Per-opportunity coaching with confidence labels and traceable evidence from live deal system."
      />

      {loading ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center text-sm text-muted-foreground">Loading deal coaching…</DeckSurface>
      ) : errorMessage || !composite || !board ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {errorMessage ?? "Deal coaching is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recommendations</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.recommendationCount)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Blockers</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.blockerCount)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quote Risk</p>
              </div>
              <p className={`mt-3 text-2xl font-semibold ${board.summary.quoteRisk ? "text-amber-400" : "text-foreground"}`}>{board.summary.quoteRisk ? "Yes" : "No"}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Field Signals</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.voiceSignalCount)}</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Coaching queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every recommendation includes a confidence label and a working trace so rep can see why it is being suggested.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={`/qrm/deals/${dealId}/room`}>
                  Refresh strategist <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open Deal Room to run scenarios, decision room simulator, and pipeline pressure testing on this deal.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={`/qrm/deals/${dealId}/room`}>
                  Deal Room <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Coaching timeline</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Trace the coaching history: who coached this deal, when, and what was the outcome.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={`/qrm/deals/${dealId}`}>
                  Open timeline <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>
        </>
      )}
    </div>
  );
}
