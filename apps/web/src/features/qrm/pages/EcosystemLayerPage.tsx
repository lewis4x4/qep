import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarSync,
  Layers,
  Share2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountCrossDealerMirrorHref,
  buildAccountEcosystemHref,
  buildAccountOperatingProfileHref,
  buildAccountStrategistHref,
} from "../lib/account-command";
import { buildEcosystemLayerBoard, type EcosystemConfidence } from "../lib/ecosystem-layer";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

function signalTone(signal: EcosystemConfidence): string {
  switch (signal) {
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
      const [dealsResult, contactsResult, voiceResult, equipmentResult] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("id, name, amount, expected_close_on, closed_at, stage_id")
          .eq("company_id", accountId!)
          .is("deleted_at", null)
          .limit(500),
        supabase
          .from("crm_contacts")
          .select("id, first_name, last_name, title, email, phone")
          .eq("primary_company_id", accountId!)
          .is("deleted_at", null)
          .limit(500),
        supabase
          .from("voice_captures")
          .select("linked_contact_id, created_at, extracted_data")
          .eq("linked_company_id", accountId!)
          .limit(200),
        supabase
          .from("crm_equipment")
          .select("id, make, model, year")
          .eq("company_id", accountId!)
          .limit(500),
      ]);

      if (dealsResult.error) throw new Error(dealsResult.error.message);
      if (contactsResult.error) throw new Error(contactsResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (equipmentResult.error) throw new Error(equipmentResult.error.message);

      const dealIds = (dealsResult.data ?? []).map((row) => row.id);
      const [assessmentsResult, financeRatesResult, oemSignalsResult, auctionSignalsResult] = await Promise.all([
        dealIds.length > 0
          ? supabase
              .from("needs_assessments")
              .select("deal_id, financing_preference, monthly_payment_target, brand_preference, budget_type")
              .in("deal_id", dealIds)
              .limit(200)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("financing_rate_matrix")
          .select("lender_name, customer_type, apr, term_months, min_amount, max_amount, end_date")
          .eq("is_active", true)
          .limit(50),
        supabase
          .from("manufacturer_incentives")
          .select("oem_name, name, end_date, requires_approval, discount_type, discount_value")
          .eq("is_active", true)
          .limit(50),
        supabase
          .from("auction_results")
          .select("make, model, year, auction_date, hammer_price, location")
          .order("auction_date", { ascending: false })
          .limit(50),
      ]);

      if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
      if (financeRatesResult.error) throw new Error(financeRatesResult.error.message);
      if (oemSignalsResult.error) throw new Error(oemSignalsResult.error.message);
      if (auctionSignalsResult.error) throw new Error(auctionSignalsResult.error.message);

      return {
        assessments: (assessmentsResult.data ?? []).map((row) => ({
          dealId: row.deal_id,
          financingPreference: row.financing_preference,
          monthlyPaymentTarget: row.monthly_payment_target,
          brandPreference: row.brand_preference,
          budgetType: row.budget_type,
        })),
        financeRates: financeRatesResult.data ?? [],
        coverage: (equipmentResult.data ?? []).map((row) => ({
          equipmentId: row.id,
          label: [row.make, row.model, row.year].filter(Boolean).join(" ") || "Equipment",
          warrantyExpiry: null,
          warrantyType: null,
          nextServiceDue: null,
        })),
        transport: [],
        oemSignals: (oemSignalsResult.data ?? []).map((row) => ({
          oemName: row.oem_name,
          programName: row.name,
          endDate: row.end_date,
          requiresApproval: row.requires_approval,
          discountType: row.discount_type,
          discountValue: row.discount_value,
        })),
        auctionSignals: auctionSignalsResult.data ?? [],
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
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">This ecosystem layer surface isn&apos;t available right now.</p>
        </DeckSurface>
      </div>
    );
  }

  const account = accountQuery.data;
  const signals = signalsQuery.data;

  const board = useMemo(() => {
    if (!signals) return null;

    return buildEcosystemLayerBoard({
      accountId,
      amountAnchor: account.open_quotes[0]?.net_total ?? null,
      assessments: signals.assessments ?? [],
      financeRates: (signals.financeRates ?? []).map((row) => ({
        lenderName: row.lender_name,
        creditTier: row.customer_type ?? "standard",
        ratePct: row.apr ?? 0,
        termMonths: row.term_months ?? 0,
        minAmount: row.min_amount ?? null,
        maxAmount: row.max_amount ?? null,
        expiryDate: row.end_date ?? null,
      })),
      coverage: signals.coverage ?? [],
      transport: signals.transport ?? [],
      oemSignals: signals.oemSignals ?? [],
      auctionSignals: (signals.auctionSignals ?? []).map((row) => ({
        make: row.make,
        model: row.model,
        year: row.year,
        auctionDate: row.auction_date,
        hammerPrice: row.hammer_price,
        location: row.location ?? null,
      })),
    });
  }, [account, accountId, signals]);

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
            <Link to={buildAccountOperatingProfileHref(accountId)}>Operating Profile</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountStrategistHref(accountId)}>Customer Strategist</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountCrossDealerMirrorHref(accountId)}>Cross-Dealer Mirror</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Ecosystem Layer`}
        subtitle="Cross-account signals: what other accounts in this account&apos;s ecosystem are doing, seeing, and hearing about it."
      />
      <QrmSubNav />

      {profileQuery.isLoading || signalsQuery.isLoading ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center text-sm text-muted-foreground">Loading ecosystem layer…</DeckSurface>
      ) : profileQuery.isError || signalsQuery.isError || !board ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : signalsQuery.error instanceof Error
              ? signalsQuery.error.message
              : "Ecosystem layer is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lender Lanes</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.lenderLanes)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <CalendarSync className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Coverage Alerts</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.coverageAlerts)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Transport Moves</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.transportMoves)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Market Signals</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.marketSignals)}</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Layer framing</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cross-account signals show what this account&apos;s ecosystem is doing: deals, contacts, equipment. The strategist sees it too, and will use it to build account-specific plans.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountStrategistHref(accountId)}>
                  View strategist plan <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical route</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ecosystem Layer provides cross-account visibility but operates from signals. The command center remains the source of truth for operating work.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to={buildAccountCommandHref(accountId)}>
                  Refresh layer <Share2 className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>
        </>
      )}
    </div>
  );
}
