import { useMemo } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  BadgeDollarSign,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchAccount360 } from "../lib/account-360-api";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { supabase } from "@/lib/supabase";
import {
  buildAccountCommandHref,
  buildAccountEcosystemHref,
  buildAccountStrategistHref,
} from "../lib/account-command";
import { buildEcosystemLayerBoard } from "../lib/ecosystem-layer";
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

export function EcosystemLayerPage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["ecosystem-layer", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["ecosystem-layer", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: true,
      }),
    staleTime: 30_000,
  });

  const signalsQuery = useQuery({
    queryKey: ["ecosystem-layer", accountId, "signals"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data: deals, error: dealsError } = await supabase
        .from("crm_deals")
        .select("id, amount")
        .eq("company_id", accountId!)
        .is("deleted_at", null)
        .limit(200);
      if (dealsError) throw new Error(dealsError.message);

      const dealRows = deals ?? [];
      const dealIds = dealRows.map((row) => row.id);
      const fleetIds = accountQuery.data?.fleet.map((item) => item.id) ?? [];
      const makes = Array.from(
        new Set([
          ...((profileQuery.data?.fleet ?? []).map((item) => item.make).filter((value): value is string => Boolean(value))),
          ...(accountQuery.data?.fleet.map((item) => item.make).filter((value): value is string => Boolean(value)) ?? []),
        ]),
      );
      const models = Array.from(
        new Set([
          ...((profileQuery.data?.fleet ?? []).map((item) => item.model).filter((value): value is string => Boolean(value))),
          ...(accountQuery.data?.fleet.map((item) => item.model).filter((value): value is string => Boolean(value)) ?? []),
        ]),
      );

      const [assessmentsResult, financeRatesResult, coverageResult, transportResult, incentivesResult, auctionsResult] =
        await Promise.all([
          dealIds.length > 0
            ? supabase
                .from("needs_assessments")
                .select("deal_id, financing_preference, monthly_payment_target, brand_preference, budget_type")
                .in("deal_id", dealIds)
                .limit(200)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from("financing_rate_matrix")
            .select("lender_name, credit_tier, rate_pct, term_months, min_amount, max_amount, expiry_date")
            .eq("is_active", true)
            .limit(300),
          fleetIds.length > 0
            ? supabase
                .from("customer_fleet")
                .select("equipment_id, make, model, year, warranty_expiry, warranty_type, next_service_due")
                .in("equipment_id", fleetIds)
                .limit(300)
            : Promise.resolve({ data: [], error: null }),
          dealIds.length > 0
            ? supabase
                .from("traffic_tickets")
                .select("id, deal_id, status, shipping_date, promised_delivery_at, blocker_reason, late_reason, ticket_type")
                .in("deal_id", dealIds)
                .limit(300)
            : Promise.resolve({ data: [], error: null }),
          makes.length > 0
            ? supabase
                .from("manufacturer_incentives")
                .select("oem_name, program_name, end_date, requires_approval, discount_type, discount_value")
                .eq("is_active", true)
                .in("oem_name", makes)
                .limit(200)
            : Promise.resolve({ data: [], error: null }),
          makes.length > 0 && models.length > 0
            ? supabase
                .from("auction_results")
                .select("make, model, year, auction_date, hammer_price, location")
                .in("make", makes)
                .in("model", models)
                .limit(400)
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
      if (financeRatesResult.error) throw new Error(financeRatesResult.error.message);
      if (coverageResult.error) throw new Error(coverageResult.error.message);
      if (transportResult.error) throw new Error(transportResult.error.message);
      if (incentivesResult.error) throw new Error(incentivesResult.error.message);
      if (auctionsResult.error) throw new Error(auctionsResult.error.message);

      return {
        deals: dealRows,
        assessments: assessmentsResult.data ?? [],
        financeRates: financeRatesResult.data ?? [],
        coverage: coverageResult.data ?? [],
        transport: transportResult.data ?? [],
        incentives: incentivesResult.data ?? [],
        auctions: auctionsResult.data ?? [],
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
            This ecosystem layer surface isn&apos;t available right now.
          </p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;

  const board = useMemo(() => {
    if (!signalsQuery.data) return null;

    const amountAnchor = Math.max(
      ...[
        ...account.open_quotes.map((row) => Number(row.net_total ?? 0)),
        ...signalsQuery.data.deals.map((row) => Number(row.amount ?? 0)),
        0,
      ],
    );
    const fleetKeys = new Set(
      (profileQuery.data?.fleet ?? []).map((item) => `${item.make?.toLowerCase() ?? ""}::${item.model?.toLowerCase() ?? ""}::${item.year ?? ""}`),
    );

    return buildEcosystemLayerBoard({
      accountId,
      amountAnchor: amountAnchor > 0 ? amountAnchor : null,
      assessments: signalsQuery.data.assessments.map((row) => ({
        dealId: row.deal_id,
        financingPreference: row.financing_preference,
        monthlyPaymentTarget: row.monthly_payment_target,
        brandPreference: row.brand_preference,
        budgetType: row.budget_type,
      })),
      financeRates: signalsQuery.data.financeRates.map((row) => ({
        lenderName: row.lender_name,
        creditTier: row.credit_tier,
        ratePct: row.rate_pct,
        termMonths: row.term_months,
        minAmount: row.min_amount,
        maxAmount: row.max_amount,
        expiryDate: row.expiry_date,
      })),
      coverage: signalsQuery.data.coverage.map((row) => ({
        equipmentId: row.equipment_id,
        label: `${row.make} ${row.model}${row.year ? ` ${row.year}` : ""}`,
        warrantyExpiry: row.warranty_expiry,
        warrantyType: row.warranty_type,
        nextServiceDue: row.next_service_due,
      })),
      transport: signalsQuery.data.transport.map((row) => ({
        id: row.id,
        dealId: row.deal_id,
        status: row.status,
        shippingDate: row.shipping_date,
        promisedDeliveryAt: row.promised_delivery_at,
        blockerReason: row.blocker_reason,
        lateReason: row.late_reason,
        ticketType: row.ticket_type,
      })),
      oemSignals: signalsQuery.data.incentives.map((row) => ({
        oemName: row.oem_name,
        programName: row.program_name,
        endDate: row.end_date,
        requiresApproval: row.requires_approval,
        discountType: row.discount_type,
        discountValue: row.discount_value,
      })),
      auctionSignals: signalsQuery.data.auctions
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
  }, [account.open_quotes, accountId, profileQuery.data?.fleet, signalsQuery.data]);

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
        title={`${account.company.name} — Ecosystem Layer`}
        subtitle="Lenders, coverage, transport, OEM programs, and auction context around this account in one operating surface."
      />
      <QrmSubNav />

      {profileQuery.isLoading || signalsQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading ecosystem layer…</Card>
      ) : profileQuery.isError || signalsQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : signalsQuery.error instanceof Error
              ? signalsQuery.error.message
              : "Ecosystem layer is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Banknote} label="Lender Lanes" value={String(board.summary.lenderLanes)} />
            <SummaryCard icon={ShieldCheck} label="Coverage Alerts" value={String(board.summary.coverageAlerts)} tone={board.summary.coverageAlerts > 0 ? "warn" : "default"} />
            <SummaryCard icon={Truck} label="Transport Moves" value={String(board.summary.transportMoves)} />
            <SummaryCard icon={BadgeDollarSign} label="Market Signals" value={String(board.summary.marketSignals)} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Layer framing</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ecosystem Layer shows the external actors and operating dependencies already shaping this account: financing, coverage, transport, OEM programs, and auction market context.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountEcosystemHref(accountId)}>Refresh layer</Link>
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <EcosystemColumn title="Lenders" rows={board.finance} emptyText="No lender lanes are currently visible." />
            <EcosystemColumn title="Coverage" rows={board.coverage} emptyText="No warranty or coverage alerts are currently visible." />
            <EcosystemColumn title="Transport" rows={board.transport} emptyText="No transport dependencies are active right now." />
            <EcosystemColumn title="OEM + Auction" rows={board.market} emptyText="No OEM or auction context is currently visible." />
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

function EcosystemColumn({
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
