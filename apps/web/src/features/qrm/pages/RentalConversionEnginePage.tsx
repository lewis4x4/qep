import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  DollarSign,
  RefreshCcw,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountRentalConversionHref,
  buildAccountRelationshipMapHref,
  buildAccountWhiteSpaceHref,
} from "../lib/account-command";
import { buildRentalConversionBoard } from "../lib/rental-conversion";
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

export function RentalConversionEnginePage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["rental-conversion", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const boardQuery = useQuery({
    queryKey: ["rental-conversion", accountId, "signals"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data: deals, error: dealsError } = await supabase
        .from("crm_deals")
        .select("id, name, created_at")
        .eq("company_id", accountId!)
        .is("deleted_at", null)
        .limit(200);
      if (dealsError) throw new Error(dealsError.message);

      const dealRows = deals ?? [];
      const dealIds = dealRows.map((deal) => deal.id);
      const [linksResult, voiceResult] = await Promise.all([
        dealIds.length > 0
          ? supabase
              .from("crm_deal_equipment")
              .select("deal_id, equipment_id, crm_equipment!inner(id, name, make, model, year, ownership, daily_rental_rate, current_market_value)")
              .in("deal_id", dealIds)
              .eq("role", "rental")
              .limit(200)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("voice_captures")
          .select("created_at, extracted_data")
          .eq("linked_company_id", accountId!)
          .limit(200),
      ]);

      if (linksResult.error) throw new Error(linksResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);

      return buildRentalConversionBoard({
        deals: dealRows.map((deal) => ({
          id: deal.id,
          name: deal.name,
          createdAt: deal.created_at,
        })),
        rentalLinks: (linksResult.data ?? []).flatMap((row) => {
          const equipmentJoin = Array.isArray(row.crm_equipment) ? row.crm_equipment[0] : row.crm_equipment;
          if (!equipmentJoin || equipmentJoin.ownership !== "rental_fleet") return [];
          return [{
            dealId: row.deal_id,
            equipmentId: equipmentJoin.id,
            make: equipmentJoin.make,
            model: equipmentJoin.model,
            year: equipmentJoin.year,
            name: equipmentJoin.name,
            dailyRentalRate: equipmentJoin.daily_rental_rate,
            currentMarketValue: equipmentJoin.current_market_value,
          }];
        }),
        voiceSignals: (voiceResult.data ?? []).map((row) => ({
          createdAt: row.created_at,
          extractedData: (row.extracted_data ?? null) as ExtractedDealData | null,
        })),
        openQuoteCount: accountQuery.data?.open_quotes.length ?? 0,
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
          <p className="text-sm text-muted-foreground">This rental conversion surface isn&apos;t available right now.</p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;
  const board = boardQuery.data;

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
            <Link to={buildAccountWhiteSpaceHref(accountId)}>White-Space Map</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountRelationshipMapHref(accountId)}>Relationship Map</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Rental Conversion Engine`}
        subtitle="Repeat renters and rental-first signals translated into purchase motion."
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading rental conversion signals…</Card>
      ) : boardQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Rental conversion is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <SummaryCard icon={Truck} label="Candidates" value={String(board.summary.candidates)} />
            <SummaryCard icon={RefreshCcw} label="Repeat Renters" value={String(board.summary.repeatRentalCandidates)} />
            <SummaryCard icon={Truck} label="Rental Intent" value={String(board.summary.rentalIntentSignals)} />
            <SummaryCard icon={ShoppingCart} label="Purchase Ready" value={String(board.summary.purchaseReadySignals)} />
            <SummaryCard icon={DollarSign} label="Open Quotes" value={String(board.summary.openQuotes)} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Conversion queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Candidates rank higher when repeated rental behavior overlaps with rental-first or rent-to-own signals and active purchase motion.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountRentalConversionHref(accountId)}>Refresh queue</Link>
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {board.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rental-to-purchase motion is surfaced for this account right now.
                </p>
              ) : (
                board.candidates.map((candidate) => (
                  <div key={candidate.id} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{candidate.title}</p>
                          <span className={`text-[11px] font-medium ${confidenceTone(candidate.confidence)}`}>
                            {candidate.confidence} confidence
                          </span>
                          {candidate.estimatedPurchaseValue != null ? (
                            <span className="text-[11px] text-muted-foreground">
                              est. {formatCurrency(candidate.estimatedPurchaseValue)}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {candidate.rentalDealCount} rental-linked deals
                          {candidate.rentalFirstSignals > 0 ? ` · ${candidate.rentalFirstSignals} rental-first signals` : ""}
                          {candidate.rentToOwnSignals > 0 ? ` · ${candidate.rentToOwnSignals} rent-to-own signals` : ""}
                          {candidate.purchaseReadySignals > 0 ? ` · ${candidate.purchaseReadySignals} purchase-ready signals` : ""}
                        </p>
                        <div className="mt-3 space-y-1">
                          {candidate.reasons.map((line) => (
                            <p key={line} className="text-xs text-muted-foreground">
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={buildAccountCommandHref(accountId)}>
                            Account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                        {candidate.equipmentIds[0] ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/equipment/${candidate.equipmentIds[0]}`}>
                              Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        ) : null}
                      </div>
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
