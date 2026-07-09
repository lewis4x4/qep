import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  DollarSign,
  RefreshCcw,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { normalizeExtractedDealData } from "@/lib/voice-capture-extraction";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountRentalConversionHref,
  buildAccountStrategistHref,
} from "../lib/account-command";
import { buildRentalConversionBoard } from "../lib/rental-conversion";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { QrmAccountDetailMenu } from "../components/QrmAccountDetailMenu";

export function RentalConversionEnginePage() {
  const { accountId } = useParams<{ accountId: string }>();
  if (!accountId) return <Navigate to="/qrm/companies" replace />;

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

      const { data: links, error: linksError } = await supabase
        .from("crm_deal_equipment")
        .select("deal_id, equipment_id, role")
        .in("role", ["rental"])
        .in("deal_id", (deals ?? []).map((d) => d.id))
        .limit(200);
      if (linksError) throw new Error(linksError.message);

      const { data: voice, error: voiceError } = await supabase
        .from("voice_captures")
        .select("created_at, extracted_data")
        .eq("linked_company_id", accountId!)
        .limit(200);
      if (voiceError) throw new Error(voiceError.message);

      const { data: invoices, error: invoicesError } = await supabase
        .from("customer_invoices")
        .select("id, invoice_number, service_job_id, status")
        .eq("company_id", accountId!)
        .is("branch_id", null)
        .not("service_job_id", "is", null)
        .limit(200);
      if (invoicesError) throw new Error(invoicesError.message);

      const openQuotes = (invoices ?? []).length;

      const equipmentIds = (links ?? []).map((link) => link.equipment_id);

      const { data: equipment, error: equipmentError } = await supabase
        .from("crm_equipment")
        .select("id, name, make, model, year, ownership, daily_rental_rate, current_market_value")
        .in("id", equipmentIds.length > 0 ? equipmentIds : [""])
        .in("ownership", ["rental_fleet"])
        .limit(200);
      if (equipmentError) throw new Error(equipmentError.message);

      const rentalFleet = (equipment ?? []).filter((e) => e.ownership === "rental_fleet");

      return buildRentalConversionBoard({
        deals: (deals ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
        })),
        rentalLinks: (links ?? []).flatMap((row) => {
          const equipmentJoin = rentalFleet.find((equipmentRow) => equipmentRow.id === row.equipment_id);
          if (!equipmentJoin) return [];
          return [{
            dealId: row.deal_id,
            equipmentId: row.equipment_id,
            make: equipmentJoin.make,
            model: equipmentJoin.model,
            year: equipmentJoin.year,
            name: equipmentJoin.name,
            dailyRentalRate: equipmentJoin.daily_rental_rate,
            currentMarketValue: equipmentJoin.current_market_value,
          }];
        }),
        voiceSignals: (voice ?? []).map((row) => ({
          createdAt: row.created_at,
          extractedData: row.extracted_data == null ? null : normalizeExtractedDealData(row.extracted_data),
        })),
        openQuoteCount: openQuotes,
      });
    },
    staleTime: 60_000,
  });

  // L9.3: rental truth — contracts/invoices/RPO accrual by qrm_company_id
  // (rental_conversion_signals, m807) instead of CRM deal tags + voice
  // captures only.
  const rentalTruthQuery = useQuery({
    queryKey: ["rental-conversion", accountId, "rental-truth"],
    enabled: Boolean(accountId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rental_conversion_signals", {
        p_company_id: accountId,
      });
      if (error) throw new Error(error.message);
      const record = (data ?? {}) as {
        contract_count?: number;
        open_contract_count?: number;
        trailing_90d_billed_cents?: number;
        active_rpo?: Array<{
          contract_id: string;
          contract_number: string | null;
          lifecycle_state: string | null;
          accrued_cents: number;
          purchase_price_cents: number | null;
          exercise_deadline: string | null;
          conversion_deal_id: string | null;
        }>;
      };
      return {
        contractCount: Number(record.contract_count ?? 0),
        openContractCount: Number(record.open_contract_count ?? 0),
        trailing90dBilledCents: Number(record.trailing_90d_billed_cents ?? 0),
        activeRpo: Array.isArray(record.active_rpo) ? record.active_rpo : [],
      };
    },
  });
  const rentalTruth = rentalTruthQuery.data;

  const board = boardQuery.data;
  const isLoading = accountQuery.isLoading || boardQuery.isLoading;
  const isError = accountQuery.isError || boardQuery.isError;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={buildAccountCommandHref(accountId)}>
            <ArrowLeft className="h-4 w-4" />
            Back to account
          </Link>
        </Button>
        <QrmAccountDetailMenu accountId={accountId} />
      </div>

      <QrmPageHeader
        title={`${accountQuery.data?.company.name ?? "Rental"} — Rental Conversion Engine`}
        subtitle="Repeat renters and rental-first signals translated into purchase motion."
      />
      <QrmSubNav />

      {isLoading ? (
        <>
          <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
          <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        </>
      ) : isError || !board ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {accountQuery.error instanceof Error
              ? accountQuery.error.message
              : boardQuery.error instanceof Error
                ? boardQuery.error.message
                : "Rental conversion is unavailable right now."}
          </p>
        </DeckSurface>
      ) : (
        <>
          {rentalTruth ? (
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Rental truth
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-2xl font-semibold text-foreground">
                    {rentalTruth.contractCount}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({rentalTruth.openContractCount} open)
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Rental contracts on this account.</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-foreground">
                    {formatCurrency(rentalTruth.trailing90dBilledCents / 100)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Rental billed, trailing 90 days.</p>
                </div>
                <div>
                  {rentalTruth.activeRpo.length === 0 ? (
                    <>
                      <p className="text-2xl font-semibold text-foreground">—</p>
                      <p className="mt-1 text-xs text-muted-foreground">No active RPO accrual.</p>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      {rentalTruth.activeRpo.map((rpo) => (
                        <div key={rpo.contract_id} className="text-xs">
                          <p className="font-medium text-foreground">
                            {rpo.contract_number ?? rpo.contract_id.slice(0, 8)}:{" "}
                            {formatCurrency(rpo.accrued_cents / 100)}
                            {rpo.purchase_price_cents != null
                              ? ` of ${formatCurrency(rpo.purchase_price_cents / 100)} buyout`
                              : ""}
                          </p>
                          <p className="text-muted-foreground">
                            {rpo.exercise_deadline ? `exercise by ${rpo.exercise_deadline}` : "no deadline"}
                            {rpo.conversion_deal_id ? (
                              <>
                                {" · "}
                                <Link
                                  to={`/qrm/deals/${rpo.conversion_deal_id}`}
                                  className="text-qep-orange hover:underline"
                                >
                                  conversion deal
                                </Link>
                              </>
                            ) : null}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </DeckSurface>
          ) : null}

          <div className="grid gap-4 md:grid-cols-5">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Candidates</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.candidates)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Accounts with repeated rental behavior and rental-first signals.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <RefreshCcw className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Repeat Renters</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.repeatRentalCandidates)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Customers who have rented the same unit more than once in the last 90 days.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rental Intent</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.rentalIntentSignals)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Rental signals: rent-first vs rent-to-own behavior.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Purchase Ready</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.purchaseReadySignals)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Accounts showing purchase readiness signals and active quotes.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Open Quotes</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.openQuotes)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Active quotes on account.</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Conversion queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Candidates rank higher when repeated rental behavior overlaps with rental-first or rent-to-own signals and active purchase motion.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountRentalConversionHref(accountId)}>
                  Refresh queue <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical route</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Rental Conversion Engine is a signal-gathering surface. The command center remains the source of truth for operating work.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to={buildAccountCommandHref(accountId)}>
                  Refresh <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open AI Customer Strategist to turn whitespace, relationship, and conversion signals into a 30/60/90 account plan.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountStrategistHref(accountId)}>
                  AI Strategist <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>
        </>
      )}
    </div>
  );
}
