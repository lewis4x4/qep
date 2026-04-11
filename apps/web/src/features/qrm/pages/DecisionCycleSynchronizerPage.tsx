import { useMemo } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarSync,
  Clock3,
  RefreshCcw,
  Waves,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchAccount360 } from "../lib/account-360-api";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { supabase } from "@/lib/supabase";
import {
  buildAccountCommandHref,
  buildAccountDecisionCycleHref,
  buildAccountEcosystemHref,
  buildAccountReputationHref,
  buildAccountStrategistHref,
} from "../lib/account-command";
import { buildDecisionCycleBoard } from "../lib/decision-cycle";
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

export function DecisionCycleSynchronizerPage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["decision-cycle", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["decision-cycle", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: false,
      }),
    staleTime: 30_000,
  });

  const signalsQuery = useQuery({
    queryKey: ["decision-cycle", accountId, "signals"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const [{ data: deals, error: dealsError }, { data: stages, error: stagesError }] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("id, name, created_at, closed_at, expected_close_on, next_follow_up_at, stage_id")
          .eq("company_id", accountId!)
          .is("deleted_at", null)
          .limit(300),
        supabase
          .from("crm_deal_stages")
          .select("id, is_closed_won")
          .limit(100),
      ]);
      if (dealsError) throw new Error(dealsError.message);
      if (stagesError) throw new Error(stagesError.message);

      const dealRows = deals ?? [];
      const closedWonStageIds = new Set((stages ?? []).filter((row) => row.is_closed_won).map((row) => row.id));
      const closedDeals = dealRows.filter((row) => closedWonStageIds.has(row.stage_id));
      const openDeals = dealRows.filter((row) => !closedDeals.some((closed) => closed.id === row.id));
      const dealIds = dealRows.map((row) => row.id);

      const [signaturesResult, cadencesResult] = dealIds.length > 0
        ? await Promise.all([
            supabase
              .from("quote_signatures")
              .select("deal_id, signed_at")
              .in("deal_id", dealIds)
              .limit(300),
            supabase
              .from("follow_up_cadences")
              .select(`
                deal_id, status, started_at,
                follow_up_touchpoints(status)
              `)
              .in("deal_id", dealIds)
              .limit(300),
          ])
        : await Promise.all([
            Promise.resolve({ data: [], error: null }),
            Promise.resolve({ data: [], error: null }),
          ]);

      if (signaturesResult.error) throw new Error(signaturesResult.error.message);
      if (cadencesResult.error) throw new Error(cadencesResult.error.message);

      return {
        closedDeals,
        openDeals,
        signatures: signaturesResult.data ?? [],
        cadences: cadencesResult.data ?? [],
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
            This decision cycle synchronizer surface isn&apos;t available right now.
          </p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;

  const board = useMemo(() => {
    if (!signalsQuery.data) return null;
    return buildDecisionCycleBoard({
      accountId,
      closedDeals: signalsQuery.data.closedDeals
        .filter((row) => row.closed_at)
        .map((row) => ({
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
          closedAt: row.closed_at!,
        })),
      openDeals: signalsQuery.data.openDeals.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        expectedCloseOn: row.expected_close_on,
        nextFollowUpAt: row.next_follow_up_at,
      })),
      signatures: signalsQuery.data.signatures.map((row) => ({
        dealId: row.deal_id,
        signedAt: row.signed_at,
      })),
      cadences: signalsQuery.data.cadences.map((row) => {
        const touchpoints = Array.isArray(row.follow_up_touchpoints) ? row.follow_up_touchpoints : [];
        return {
          dealId: row.deal_id,
          status: row.status,
          startedAt: row.started_at,
          overdueTouchpoints: touchpoints.filter((tp) => tp.status === "overdue").length,
          pendingTouchpoints: touchpoints.filter((tp) => tp.status === "pending").length,
        };
      }),
      budgetCycleMonth: profileQuery.data?.budget_cycle_month ?? account.profile?.budget_cycle_month,
      seasonalPattern: profileQuery.data?.behavioral_signals?.seasonal_pattern ?? null,
    });
  }, [account.profile?.budget_cycle_month, accountId, profileQuery.data, signalsQuery.data]);

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
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountEcosystemHref(accountId)}>Ecosystem Layer</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountReputationHref(accountId)}>Reputation Surface</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Decision Cycle Synchronizer`}
        subtitle="Per-customer purchasing rhythm from closed deals, signatures, cadence drift, budget windows, and seasonality."
      />
      <QrmSubNav />

      {profileQuery.isLoading || signalsQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading decision cycle synchronizer…</Card>
      ) : profileQuery.isError || signalsQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : signalsQuery.error instanceof Error
              ? signalsQuery.error.message
              : "Decision cycle synchronizer is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={CalendarSync} label="Learned Cycle" value={board.summary.learnedCycleDays != null ? `${board.summary.learnedCycleDays}d` : "—"} />
            <SummaryCard icon={RefreshCcw} label="Sign To Close" value={board.summary.signatureToCloseDays != null ? `${board.summary.signatureToCloseDays}d` : "—"} />
            <SummaryCard icon={Clock3} label="Active Deals" value={String(board.summary.activeDeals)} />
            <SummaryCard icon={Waves} label="Drift" value={String(board.summary.driftCount)} tone={board.summary.driftCount > 0 ? "warn" : "default"} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Synchronizer framing</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Decision Cycle Synchronizer measures whether today&apos;s deals and cadence are moving with this customer&apos;s actual buying rhythm, not just our desired close dates.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountDecisionCycleHref(accountId)}>Refresh synchronizer</Link>
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <DecisionCycleColumn
              title="Learned Rhythm"
              rows={board.rhythm}
              emptyText="No rhythm model is available yet."
            />
            <DecisionCycleColumn
              title="Live Sync Gaps"
              rows={board.syncGaps}
              emptyText="No open deal drift is visible right now."
            />
            <DecisionCycleColumn
              title="Next Window"
              rows={board.nextWindow}
              emptyText="No next window is visible right now."
            />
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
  tone = "default",
}: {
  icon: ComponentType<{ className?: string }>;
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

function DecisionCycleColumn({
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
