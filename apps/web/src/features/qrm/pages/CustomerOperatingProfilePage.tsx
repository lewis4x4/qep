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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
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
            This customer operating profile surface isn&apos;t available right now.
          </p>
        </Card>
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
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Operating Profile`}
        subtitle="Work type, terrain, brand preference, budget behavior, and buying style grounded in live account evidence."
      />
      <QrmSubNav />

      {profileQuery.isError || assessmentsQuery.isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : assessmentsQuery.error instanceof Error
              ? assessmentsQuery.error.message
              : "Operating profile is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard
              icon={Settings2}
              label="Assessments"
              value={String(board.summary.assessments)}
              detail="Account-linked needs assessments feeding the operating profile."
            />
            <SummaryCard
              icon={BadgeDollarSign}
              label="Payment Targets"
              value={String(board.summary.monthlyTargetAssessments)}
              detail="Assessments with explicit monthly payment targets."
            />
            <SummaryCard
              icon={BrainCircuit}
              label="Financing Tagged"
              value={String(board.summary.financingTaggedAssessments)}
              detail="Assessments with a recorded financing preference."
            />
            <SummaryCard
              icon={Compass}
              label="Latest Evidence"
              value={formatDate(board.summary.latestAssessmentAt)}
              detail="Most recent account assessment used in this operating profile."
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
            <div className="space-y-4">
              <FacetCard icon={Tractor} facet={board.workType} />
              <FacetCard icon={Mountain} facet={board.terrain} />
              <FacetCard icon={Compass} facet={board.brandPreference} />
            </div>

            <div className="space-y-4">
              <FacetCard icon={BadgeDollarSign} facet={board.budgetBehavior} />
              <FacetCard icon={BrainCircuit} facet={board.buyingStyle} />
              <Card className="p-4">
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
              </Card>
            </div>
          </div>

          <Card className="p-4">
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
                  <div key={assessment.id} className="rounded-xl border border-border/60 bg-muted/10 p-4">
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
  detail,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function FacetCard({
  icon: Icon,
  facet,
}: {
  icon: ComponentType<{ className?: string }>;
  facet: {
    label: string;
    primary: string;
    supporting: string[];
  };
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <h2 className="text-sm font-semibold text-foreground">{facet.label}</h2>
      </div>
      <p className="mt-3 text-lg font-semibold text-foreground">{facet.primary}</p>
      <div className="mt-3 space-y-2">
        {facet.supporting.map((line) => (
          <p key={line} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
    </Card>
  );
}
