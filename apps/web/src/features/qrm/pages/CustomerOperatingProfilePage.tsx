import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeDollarSign,
  BrainCircuit,
  Compass,
  Mountain,
  Settings2,
  Tractor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountFleetIntelligenceHref,
  buildAccountGenomeHref,
  buildAccountOperatingProfileHref,
  buildAccountTimelineHref,
} from "../lib/account-command";
import {
  buildCustomerOperatingProfileBoard,
  type CustomerOperatingAssessment,
} from "../lib/customer-operating-profile";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

function formatDate(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function CustomerOperatingProfilePage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["customer-operating-profile", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["customer-operating-profile", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: false,
      }),
    staleTime: 30_000,
  });

  const assessmentsQuery = useQuery({
    queryKey: ["customer-operating-profile", accountId, "assessments"],
    enabled: Boolean(accountId),
    queryFn: async (): Promise<CustomerOperatingAssessment[]> => {
      const { data: deals, error: dealsError } = await supabase
        .from("crm_deals")
        .select("id, name")
        .eq("company_id", accountId!)
        .limit(100);

      if (dealsError) {
        throw new Error(dealsError.message);
      }

      const dealRows = deals ?? [];
      if (dealRows.length === 0) return [];

      const dealNameById = new Map(dealRows.map((deal) => [deal.id, deal.name ?? "Deal"]));
      const dealIds = dealRows.map((deal) => deal.id);

      const { data: assessments, error: assessmentsError } = await supabase
        .from("needs_assessments")
        .select(
          "id, deal_id, created_at, application, work_type, terrain_material, brand_preference, budget_type, monthly_payment_target, financing_preference, next_step, completeness_pct, qrm_narrative",
        )
        .in("deal_id", dealIds)
        .order("created_at", { ascending: false })
        .limit(30);

      if (assessmentsError) {
        throw new Error(assessmentsError.message);
      }

      return (assessments ?? []).map((row) => ({
        id: row.id,
        dealId: row.deal_id,
        dealName: dealNameById.get(row.deal_id) ?? "Deal",
        createdAt: row.created_at,
        application: row.application,
        workType: row.work_type,
        terrainMaterial: row.terrain_material,
        brandPreference: row.brand_preference,
        budgetType: row.budget_type,
        monthlyPaymentTarget: row.monthly_payment_target,
        financingPreference: row.financing_preference,
        nextStep: row.next_step,
        completenessPct: row.completeness_pct,
        qrmNarrative: row.qrm_narrative,
      }));
    },
    staleTime: 30_000,
  });

  if (!accountId) {
    return <Navigate to="/qrm/companies" replace />;
  }

  if (accountQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This customer operating profile surface isn&apos;t available right now.
          </p>
        </DeckSurface>
      </div>
    );
  }

  const account = accountQuery.data;
  const board = buildCustomerOperatingProfileBoard(profileQuery.data ?? null, assessmentsQuery.data ?? []);

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
            <Link to={buildAccountGenomeHref(accountId)}>Customer Genome</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountTimelineHref(accountId)}>Timeline</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountCommandHref(accountId)}>Account Command</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountFleetIntelligenceHref(accountId)}>Fleet Intelligence</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Operating Profile`}
        subtitle="Work type, terrain, brand preference, budget behavior, and buying style grounded in live account evidence."
      />
      <QrmSubNav />

      {profileQuery.isError || assessmentsQuery.isError ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : assessmentsQuery.error instanceof Error
              ? assessmentsQuery.error.message
              : "Operating profile is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Assessments</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.assessments)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Account-linked needs assessments feeding the operating profile.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <BadgeDollarSign className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Payment Targets</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.monthlyTargetAssessments)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Assessments with explicit monthly payment targets.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Financing Tagged</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.financingTaggedAssessments)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Assessments with a recorded financing preference.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Compass className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Latest Evidence</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{formatDate(board.summary.latestAssessmentAt)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Most recent account assessment used in this operating profile.</p>
            </DeckSurface>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
            <div className="space-y-4">
              <DeckSurface className="p-4">
                <div className="flex items-center gap-2">
                  <Tractor className="h-4 w-4 text-qep-orange" />
                  <h2 className="text-sm font-semibold text-foreground">{board.workType.label}</h2>
                </div>
                <div className="mt-4 space-y-2">
                  {board.workType.supporting.map((line) => (
                    <p key={line} className="text-sm text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              </DeckSurface>
              <DeckSurface className="p-4">
                <div className="flex items-center gap-2">
                  <Mountain className="h-4 w-4 text-qep-orange" />
                  <h2 className="text-sm font-semibold text-foreground">{board.terrain.label}</h2>
                </div>
                <div className="mt-4 space-y-2">
                  {board.terrain.supporting.map((line) => (
                    <p key={line} className="text-sm text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              </DeckSurface>
              <DeckSurface className="p-4">
                <div className="flex items-center gap-2">
                  <Compass className="h-4 w-4 text-qep-orange" />
                  <h2 className="text-sm font-semibold text-foreground">{board.brandPreference.label}</h2>
                </div>
                <div className="mt-4 space-y-2">
                  {board.brandPreference.supporting.map((line) => (
                    <p key={line} className="text-sm text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              </DeckSurface>
            </div>

            <div className="space-y-4">
              <DeckSurface className="p-4">
                <div className="flex items-center gap-2">
                  <BadgeDollarSign className="h-4 w-4 text-qep-orange" />
                  <h2 className="text-sm font-semibold text-foreground">{board.budgetBehavior.label}</h2>
                </div>
                <div className="mt-4 space-y-2">
                  {board.budgetBehavior.supporting.map((line) => (
                    <p key={line} className="text-sm text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              </DeckSurface>
              <DeckSurface className="p-4">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-qep-orange" />
                  <h2 className="text-sm font-semibold text-foreground">{board.buyingStyle.label}</h2>
                </div>
                <div className="mt-4 space-y-2">
                  {board.buyingStyle.supporting.map((line) => (
                    <p key={line} className="text-sm text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              </DeckSurface>
            </div>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical route</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customer Operating Profile is the live account behavior layer. Use it with Customer Genome, not instead of it.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to={buildAccountOperatingProfileHref(accountId)}>Refresh profile</Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Recent assessment evidence</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The operating profile is grounded in recent account-level needs assessments, not inferred from empty fields.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountGenomeHref(accountId)}>
                  Customer Genome <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {assessmentsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading needs-assessment evidence…</p>
              ) : board.recentAssessments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No account-linked needs assessments are recorded yet. Voice capture and deal discovery will enrich this surface.
                </p>
              ) : (
                board.recentAssessments.map((assessment) => (
                  <div key={assessment.id} className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{assessment.dealName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(assessment.createdAt)} · {assessment.completenessPct?.toFixed(0) ?? "0"}% complete
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {titleize(assessment.workType ?? assessment.application)} · {titleize(assessment.terrainMaterial)} · {titleize(assessment.brandPreference)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {titleize(assessment.budgetType)} · {titleize(assessment.financingPreference)} · Next step {titleize(assessment.nextStep)}
                        </p>
                        {assessment.qrmNarrative ? (
                          <p className="mt-2 text-sm text-muted-foreground">{assessment.qrmNarrative}</p>
                        ) : null}
                      </div>
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/qrm/deals/${assessment.dealId}`}>
                          Open deal <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open Fleet Intelligence to see owned machines, attachment gaps, and replacement windows for this account.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountFleetIntelligenceHref(accountId)}>
                  Fleet intelligence <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>
        </>
      )}
    </div>
  );
}
