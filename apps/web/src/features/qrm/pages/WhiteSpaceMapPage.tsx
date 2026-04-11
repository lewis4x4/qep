import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  DollarSign,
  PackagePlus,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountFleetIntelligenceHref,
  buildAccountGenomeHref,
  buildAccountOperatingProfileHref,
  buildAccountRentalConversionHref,
  buildAccountRelationshipMapHref,
  buildAccountWhiteSpaceHref,
} from "../lib/account-command";
import { buildWhiteSpaceMapBoard, type WhiteSpaceOpportunity, type WhiteSpaceOpportunityType } from "../lib/white-space-map";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

function typeMeta(type: WhiteSpaceOpportunityType): { label: string; icon: ComponentType<{ className?: string }>; tone: string } {
  switch (type) {
    case "replacement":
      return { label: "Replacement", icon: DollarSign, tone: "text-qep-orange" };
    case "attachment":
      return { label: "Attachment", icon: PackagePlus, tone: "text-blue-400" };
    case "service_coverage":
      return { label: "Service", icon: Wrench, tone: "text-amber-400" };
    case "parts_penetration":
      return { label: "Parts", icon: Boxes, tone: "text-violet-400" };
  }
}

function confidenceTone(confidence: WhiteSpaceOpportunity["confidence"]): string {
  switch (confidence) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
  }
}

function opportunityHref(accountId: string, opportunity: WhiteSpaceOpportunity): string {
  switch (opportunity.type) {
    case "replacement":
    case "attachment":
      return opportunity.equipmentId ? `/equipment/${opportunity.equipmentId}` : buildAccountFleetIntelligenceHref(accountId);
    case "service_coverage":
      return "/service";
    case "parts_penetration":
      return "/parts/analytics";
  }
}

export function WhiteSpaceMapPage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["white-space-map", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["white-space-map", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: true,
      }),
    staleTime: 30_000,
  });

  const equipmentQuery = useQuery({
    queryKey: ["white-space-map", accountId, "equipment"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_equipment")
        .select("id, metadata, current_market_value, replacement_cost")
        .eq("company_id", accountId!)
        .eq("ownership", "customer_owned")
        .is("deleted_at", null)
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => {
        const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
        const attachments = Array.isArray(metadata.attachments) ? metadata.attachments.filter((item) => item != null) : [];
        return {
          equipmentId: row.id,
          attachmentCount: attachments.length,
          currentMarketValue: row.current_market_value,
          replacementCost: row.replacement_cost,
        };
      });
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
          <p className="text-sm text-muted-foreground">This white-space map surface isn&apos;t available right now.</p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;
  const board = buildWhiteSpaceMapBoard({
    fleet: account.fleet,
    service: account.service,
    parts: account.parts,
    profile: profileQuery.data ?? null,
    predictions: profileQuery.data?.fleet ?? [],
    equipmentSignals: equipmentQuery.data ?? [],
  });

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
            <Link to={buildAccountOperatingProfileHref(accountId)}>Operating Profile</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountRelationshipMapHref(accountId)}>Relationship Map</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountRentalConversionHref(accountId)}>Rental Conversion</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — White-Space Map`}
        subtitle="Revenue lanes the dealership should be capturing but is not fully capturing yet."
      />
      <QrmSubNav />

      {profileQuery.isError || equipmentQuery.isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : equipmentQuery.error instanceof Error
              ? equipmentQuery.error.message
              : "White-space map is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <SummaryCard icon={AlertTriangle} label="Total Gaps" value={String(board.summary.total)} />
            <SummaryCard icon={DollarSign} label="Replacement" value={String(board.summary.replacement)} />
            <SummaryCard icon={PackagePlus} label="Attachment" value={String(board.summary.attachment)} />
            <SummaryCard icon={Wrench} label="Service" value={String(board.summary.serviceCoverage)} />
            <SummaryCard icon={Boxes} label="Parts" value={String(board.summary.partsPenetration)} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Revenue gaps</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ranked by category severity and evidence confidence. Each row shows why the gap exists and where to act next.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountWhiteSpaceHref(accountId)}>Refresh map</Link>
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {profileQuery.isLoading || equipmentQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading whitespace signals…</p>
              ) : board.opportunities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No clear whitespace lanes are surfaced from the current account evidence.
                </p>
              ) : (
                board.opportunities.map((opportunity) => {
                  const meta = typeMeta(opportunity.type);
                  return (
                    <div key={opportunity.id} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[11px] ${meta.tone}`}>
                              <meta.icon className="h-3 w-3" />
                              {meta.label}
                            </span>
                            <span className={`text-[11px] font-medium ${confidenceTone(opportunity.confidence)}`}>
                              {opportunity.confidence} confidence
                            </span>
                            {opportunity.estimatedRevenue != null ? (
                              <span className="text-[11px] text-muted-foreground">
                                est. {formatCurrency(opportunity.estimatedRevenue)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm font-semibold text-foreground">{opportunity.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{opportunity.detail}</p>
                          <div className="mt-3 space-y-1">
                            {opportunity.evidence.map((line) => (
                              <p key={line} className="text-xs text-muted-foreground">
                                {line}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <Button asChild size="sm" variant="ghost">
                            <Link to={opportunityHref(accountId, opportunity)}>
                              Open lane <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open Rental Conversion Engine to translate repeat rental behavior into purchase motion.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountRentalConversionHref(accountId)}>
                  Rental conversion <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
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
