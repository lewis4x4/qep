import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountRentalConversionHref,
} from "../lib/account-command";
import {
  buildRentalConversionBoard,
  buildRentalTruthConversionBoard,
} from "../lib/rental-conversion";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { QrmAccountDetailMenu } from "../components/QrmAccountDetailMenu";
import { rentalOpsApi } from "../lib/rental-ops-api";

export function RentalConversionEnginePage() {
  const { accountId } = useParams<{ accountId: string }>();
  const queryClient = useQueryClient();
  if (!accountId) return <Navigate to="/qrm/companies" replace />;

  const accountQuery = useQuery({
    queryKey: ["rental-conversion", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  // Wave 2 primary: rental contracts + RPO accrual, not CRM tags + voice.
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

  const companyName = accountQuery.data?.company.name ?? "Account";

  const board = rentalTruth
    ? buildRentalTruthConversionBoard([
        {
          companyId: accountId,
          companyName,
          contractCount: rentalTruth.contractCount,
          openContractCount: rentalTruth.openContractCount,
          trailing90dBilledCents: rentalTruth.trailing90dBilledCents,
          rpoAccruedCents: rentalTruth.activeRpo.reduce(
            (sum, r) => sum + Number(r.accrued_cents ?? 0),
            0,
          ),
          activeRpoCount: rentalTruth.activeRpo.length,
          maxRpoPurchasePriceCents: rentalTruth.activeRpo.reduce(
            (max, r) =>
              Math.max(max, Number(r.purchase_price_cents ?? 0)),
            0,
          ) || null,
          rankScore:
            rentalTruth.activeRpo.length * 100 +
            Math.min(rentalTruth.contractCount, 20) * 5 +
            Math.min(rentalTruth.trailing90dBilledCents / 10000, 50),
          confidence: (rentalTruth.activeRpo.length > 0
            ? "high"
            : rentalTruth.contractCount >= 3
              ? "medium"
              : "low") as "high" | "medium" | "low",
        },
      ].filter((row) => row.contractCount > 0 || row.activeRpoCount > 0))
    : buildRentalConversionBoard({
        deals: [],
        rentalLinks: [],
        voiceSignals: [],
        openQuoteCount: 0,
      });

  const convertMutation = useMutation({
    mutationFn: (contractId: string) =>
      rentalOpsApi.convertRpoToDeal({ contract_id: contractId }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["rental-conversion", accountId] });
      window.location.assign(`/qrm/deals/${result.deal_id}`);
    },
  });

  const isLoading = accountQuery.isLoading || rentalTruthQuery.isLoading;
  const isError = accountQuery.isError || rentalTruthQuery.isError;

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
      ) : isError ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {accountQuery.error instanceof Error
              ? accountQuery.error.message
              : rentalTruthQuery.error instanceof Error
                ? rentalTruthQuery.error.message
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
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-muted-foreground">
                            <span>
                              {rpo.exercise_deadline
                                ? `exercise by ${rpo.exercise_deadline}`
                                : "no deadline"}
                            </span>
                            {rpo.conversion_deal_id ? (
                              <Link
                                to={`/qrm/deals/${rpo.conversion_deal_id}`}
                                className="text-qep-orange hover:underline"
                              >
                                conversion deal
                              </Link>
                            ) : (
                              <button
                                type="button"
                                className="rounded border border-purple-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-purple-200 hover:bg-purple-500/15 disabled:opacity-50"
                                disabled={convertMutation.isPending}
                                onClick={() => convertMutation.mutate(rpo.contract_id)}
                              >
                                Convert to purchase
                              </button>
                            )}
                          </div>
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
                <h2 className="text-sm font-semibold text-foreground">Ranked from rental truth</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Confidence and purchase motion derive from live contracts, trailing rental
                  spend, and RPO accrual — not CRM tags alone.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountRentalConversionHref(accountId)}>
                  Refresh <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            {board.candidates.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                No rental contracts yet for this account — conversion queue is empty.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {board.candidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    className="rounded border border-white/10 px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{candidate.title}</span>
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {candidate.confidence}
                      </span>
                    </div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {candidate.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </DeckSurface>
        </>
      )}
    </div>
  );
}
