import { useMemo } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  MessageSquareText,
  Mic2,
  Wrench,
  Gavel,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchAccount360 } from "../lib/account-360-api";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { supabase } from "@/lib/supabase";
import { normalizeExtractedDealData } from "@/lib/voice-capture-extraction";
import {
  buildAccountCommandHref,
  buildAccountReputationHref,
  buildAccountStrategistHref,
} from "../lib/account-command";
import { buildReputationSurfaceBoard } from "../lib/reputation-surface";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ReputationSurfacePage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["reputation-surface", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["reputation-surface", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: true,
      }),
    staleTime: 30_000,
  });

  const signalsQuery = useQuery({
    queryKey: ["reputation-surface", accountId, "signals"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data: deals, error: dealsError } = await supabase
        .from("crm_deals")
        .select("id")
        .eq("company_id", accountId!)
        .is("deleted_at", null)
        .limit(300);
      if (dealsError) throw new Error(dealsError.message);

      const dealIds = (deals ?? []).map((row) => row.id);
      const fleetIds = accountQuery.data?.fleet.map((item) => item.id) ?? [];
      const makes = Array.from(
        new Set((profileQuery.data?.fleet ?? []).map((item) => item.make).filter((value): value is string => Boolean(value))),
      );
      const models = Array.from(
        new Set((profileQuery.data?.fleet ?? []).map((item) => item.model).filter((value): value is string => Boolean(value))),
      );

      const [voiceResult, feedbackResult, knowledgeResult, lifecycleResult, portalReviewResult, auctionResult] =
        await Promise.all([
          supabase
            .from("voice_captures")
            .select("created_at, transcript, extracted_data")
            .eq("linked_company_id", accountId!)
            .limit(300),
          supabase
            .from("service_completion_feedback")
            .select("created_at, time_saver_notes, serial_specific_note, return_visit_risk, service_jobs!inner(customer_id)")
            .limit(300),
          fleetIds.length > 0
            ? supabase
                .from("machine_knowledge_notes")
                .select("created_at, note_type, content, equipment_id")
                .in("equipment_id", fleetIds)
                .limit(300)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from("customer_lifecycle_events")
            .select("event_type, event_at, metadata")
            .eq("company_id", accountId!)
            .in("event_type", ["nps_response", "churn_risk_flag", "won_back", "lost"])
            .order("event_at", { ascending: false })
            .limit(100),
          dealIds.length > 0
            ? supabase
                .from("portal_quote_reviews")
                .select("created_at, status, counter_notes, viewed_at, signed_at")
                .in("deal_id", dealIds)
                .limit(200)
            : Promise.resolve({ data: [], error: null }),
          makes.length > 0 && models.length > 0
            ? supabase
                .from("auction_results")
                .select("make, model, year, auction_date, hammer_price, location")
                .in("make", makes)
                .in("model", models)
                .limit(300)
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (feedbackResult.error) throw new Error(feedbackResult.error.message);
      if (knowledgeResult.error) throw new Error(knowledgeResult.error.message);
      if (lifecycleResult.error) throw new Error(lifecycleResult.error.message);
      if (portalReviewResult.error) throw new Error(portalReviewResult.error.message);
      if (auctionResult.error) throw new Error(auctionResult.error.message);

      return {
        voiceSignals: voiceResult.data ?? [],
        feedbackSignals: (feedbackResult.data ?? []).filter((row) => {
          const job = Array.isArray(row.service_jobs) ? row.service_jobs[0] : row.service_jobs;
          return job?.customer_id === accountId;
        }),
        knowledgeNotes: knowledgeResult.data ?? [],
        lifecycleEvents: lifecycleResult.data ?? [],
        portalReviews: portalReviewResult.data ?? [],
        auctionSignals: auctionResult.data ?? [],
      };
    },
    staleTime: 30_000,
  });

  if (!accountId) {
    return <Navigate to="/qrm/companies" replace />;
  }

  if (accountQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="h-32 animate-pulse border-border bg-muted/40" />
        <Card className="h-80 animate-pulse border-border bg-muted/40" />
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This reputation surface isn&apos;t available right now.
          </p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;
  const fleetKeys = new Set(
    (profileQuery.data?.fleet ?? []).map((item) => `${item.make?.toLowerCase() ?? ""}::${item.model?.toLowerCase() ?? ""}::${item.year ?? ""}`),
  );

  const board = useMemo(() => {
    if (!signalsQuery.data) return null;
    return buildReputationSurfaceBoard({
      accountId,
      voiceSignals: signalsQuery.data.voiceSignals.map((row) => ({
        createdAt: row.created_at,
        transcript: row.transcript,
        extractedData: row.extracted_data == null ? null : normalizeExtractedDealData(row.extracted_data),
      })),
      feedbackSignals: signalsQuery.data.feedbackSignals.map((row) => ({
        createdAt: row.created_at,
        returnVisitRisk: row.return_visit_risk,
        timeSaverNotes: row.time_saver_notes,
        serialSpecificNote: row.serial_specific_note,
      })),
      knowledgeNotes: signalsQuery.data.knowledgeNotes.map((row) => ({
        createdAt: row.created_at,
        noteType: row.note_type,
        content: row.content,
      })),
      lifecycleEvents: signalsQuery.data.lifecycleEvents.map((row) => ({
        eventType: row.event_type,
        eventAt: row.event_at,
        metadata: isRecord(row.metadata) ? row.metadata : {},
      })),
      portalReviews: signalsQuery.data.portalReviews.map((row) => ({
        createdAt: row.created_at,
        status: row.status,
        counterNotes: row.counter_notes,
        viewedAt: row.viewed_at,
        signedAt: row.signed_at,
      })),
      auctionSignals: signalsQuery.data.auctionSignals
        .filter((row) => fleetKeys.has(`${row.make.toLowerCase()}::${row.model.toLowerCase()}::${row.year ?? ""}`))
        .map((row) => ({
          make: row.make,
          model: row.model,
          year: row.year,
          auctionDate: row.auction_date,
          hammerPrice: row.hammer_price,
          location: row.location,
        })),
    });
  }, [accountId, fleetKeys, signalsQuery.data]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={buildAccountCommandHref(accountId)}>
            <ArrowLeft className="h-4 w-4" />
            Back to account
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountStrategistHref(accountId)}>Customer Strategist</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Reputation Surface`}
        subtitle="Reviews, field talk, shop-floor gossip, and auction-floor context pulled into one account reputation surface."
      />
      <QrmSubNav />

      {profileQuery.isLoading || signalsQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading reputation surface…</Card>
      ) : profileQuery.isError || signalsQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : signalsQuery.error instanceof Error
              ? signalsQuery.error.message
              : "Reputation surface is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={MessageSquareText} label="Customer Voice" value={String(board.summary.customerSignals)} />
            <SummaryCard icon={Mic2} label="Field Talk" value={String(board.summary.fieldSignals)} />
            <SummaryCard icon={Wrench} label="Shop Talk" value={String(board.summary.shopSignals)} />
            <SummaryCard icon={Gavel} label="Market Talk" value={String(board.summary.marketSignals)} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Surface framing</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Reputation Surface is where customer response, field sentiment, mechanic notes, and auction-floor context meet before they quietly change the account story.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountReputationHref(accountId)}>Refresh surface</Link>
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <ReputationColumn title="Customer Voice" rows={board.customerVoice} emptyText="No customer-response signals are visible right now." />
            <ReputationColumn title="Field Talk" rows={board.fieldTalk} emptyText="No fresh field talk is visible right now." />
            <ReputationColumn title="Shop Talk" rows={board.shopTalk} emptyText="No shop-floor notes are visible right now." />
            <ReputationColumn title="Market Talk" rows={board.marketTalk} emptyText="No auction-floor context is visible right now." />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function ReputationColumn({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: Array<{
    key: string;
    title: string;
    confidence: "high" | "medium" | "low";
    trace: string[];
    actionLabel: string;
    href: string;
  }>;
  emptyText: string;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{row.title}</p>
                    <span className={`text-[11px] font-medium ${confidenceTone(row.confidence)}`}>
                      {row.confidence} confidence
                    </span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {row.trace.map((line) => (
                      <p key={line} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={row.href}>
                    {row.actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
