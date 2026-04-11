import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarRange,
  Compass,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountOperatingProfileHref,
  buildAccountRelationshipMapHref,
  buildAccountRentalConversionHref,
  buildAccountStrategistHref,
  buildAccountWhiteSpaceHref,
} from "../lib/account-command";
import {
  buildCustomerOperatingProfileBoard,
  type CustomerOperatingAssessment,
} from "../lib/customer-operating-profile";
import { buildRelationshipMapBoard } from "../lib/relationship-map";
import { buildRentalConversionBoard } from "../lib/rental-conversion";
import { buildWhiteSpaceMapBoard } from "../lib/white-space-map";
import { buildCustomerStrategistBoard, type StrategistPlan } from "../lib/customer-strategist";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

function horizonTone(horizon: StrategistPlan["horizon"]): string {
  switch (horizon) {
    case "30d":
      return "text-emerald-400";
    case "60d":
      return "text-qep-orange";
    default:
      return "text-blue-400";
  }
}

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

export function CustomerStrategistPage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["customer-strategist", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["customer-strategist", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: true,
      }),
    staleTime: 30_000,
  });

  const strategistDataQuery = useQuery({
    queryKey: ["customer-strategist", accountId, "signals"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const [dealsResult, contactsResult, voiceResult, equipmentResult] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("id, name, created_at, primary_contact_id")
          .eq("company_id", accountId!)
          .is("deleted_at", null)
          .limit(200),
        supabase
          .from("crm_contacts")
          .select("id, first_name, last_name, title, email, phone")
          .eq("primary_company_id", accountId!)
          .is("deleted_at", null)
          .limit(200),
        supabase
          .from("voice_captures")
          .select("linked_contact_id, created_at, extracted_data")
          .eq("linked_company_id", accountId!)
          .limit(200),
        supabase
          .from("crm_equipment")
          .select("id, metadata, current_market_value, replacement_cost")
          .eq("company_id", accountId!)
          .eq("ownership", "customer_owned")
          .is("deleted_at", null)
          .limit(500),
      ]);

      if (dealsResult.error) throw new Error(dealsResult.error.message);
      if (contactsResult.error) throw new Error(contactsResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (equipmentResult.error) throw new Error(equipmentResult.error.message);

      const deals = dealsResult.data ?? [];
      const dealIds = deals.map((deal) => deal.id);

      const [assessmentsResult, signaturesResult, rentalLinksResult] = dealIds.length > 0
        ? await Promise.all([
            supabase
              .from("needs_assessments")
              .select("id, deal_id, contact_id, created_at, application, work_type, terrain_material, brand_preference, budget_type, monthly_payment_target, financing_preference, next_step, completeness_pct, qrm_narrative, decision_maker_name, is_decision_maker")
              .in("deal_id", dealIds)
              .order("created_at", { ascending: false })
              .limit(200),
            supabase
              .from("quote_signatures")
              .select("deal_id, signer_name, signer_email, signed_at")
              .in("deal_id", dealIds)
              .limit(200),
            supabase
              .from("crm_deal_equipment")
              .select("deal_id, equipment_id, crm_equipment!inner(id, name, make, model, year, ownership, daily_rental_rate, current_market_value)")
              .in("deal_id", dealIds)
              .eq("role", "rental")
              .limit(200),
          ])
        : await Promise.all([
            Promise.resolve({ data: [], error: null }),
            Promise.resolve({ data: [], error: null }),
            Promise.resolve({ data: [], error: null }),
          ]);

      if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
      if (signaturesResult.error) throw new Error(signaturesResult.error.message);
      if (rentalLinksResult.error) throw new Error(rentalLinksResult.error.message);

      return {
        deals,
        contacts: contactsResult.data ?? [],
        voiceSignals: voiceResult.data ?? [],
        assessments: assessmentsResult.data ?? [],
        signatures: signaturesResult.data ?? [],
        rentalLinks: rentalLinksResult.data ?? [],
        equipment: equipmentResult.data ?? [],
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
          <p className="text-sm text-muted-foreground">This customer strategist surface isn&apos;t available right now.</p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;
  const signals = strategistDataQuery.data;

  const board = useMemo(() => {
    if (!signals) return null;

    const operatingProfile = buildCustomerOperatingProfileBoard(
      profileQuery.data ?? null,
      signals.assessments.map((row) => ({
        id: row.id,
        dealId: row.deal_id,
        dealName: signals.deals.find((deal) => deal.id === row.deal_id)?.name ?? "Deal",
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
      } satisfies CustomerOperatingAssessment)),
    );

    const whiteSpace = buildWhiteSpaceMapBoard({
      fleet: account.fleet,
      service: account.service,
      parts: account.parts,
      profile: profileQuery.data ?? null,
      predictions: profileQuery.data?.fleet ?? [],
      equipmentSignals: signals.equipment.map((row) => {
        const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
        const attachments = Array.isArray(metadata.attachments) ? metadata.attachments.filter((item) => item != null) : [];
        return {
          equipmentId: row.id,
          attachmentCount: attachments.length,
          currentMarketValue: row.current_market_value,
          replacementCost: row.replacement_cost,
        };
      }),
    });

    const relationships = buildRelationshipMapBoard({
      contacts: signals.contacts.map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        title: row.title,
        email: row.email,
        phone: row.phone,
      })),
      deals: signals.deals.map((row) => ({
        id: row.id,
        name: row.name,
        primaryContactId: row.primary_contact_id,
      })),
      assessments: signals.assessments.map((row) => ({
        contactId: row.contact_id,
        decisionMakerName: row.decision_maker_name,
        isDecisionMaker: row.is_decision_maker,
        createdAt: row.created_at,
      })),
      voiceSignals: signals.voiceSignals.map((row) => ({
        linkedContactId: row.linked_contact_id,
        createdAt: row.created_at,
        extractedData: (row.extracted_data ?? null) as ExtractedDealData | null,
      })),
      signatures: signals.signatures.map((row) => ({
        dealId: row.deal_id,
        signerName: row.signer_name,
        signerEmail: row.signer_email,
        signedAt: row.signed_at,
      })),
    });

    const rentalConversion = buildRentalConversionBoard({
      deals: signals.deals.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
      })),
      rentalLinks: signals.rentalLinks.flatMap((row) => {
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
      voiceSignals: signals.voiceSignals.map((row) => ({
        createdAt: row.created_at,
        extractedData: (row.extracted_data ?? null) as ExtractedDealData | null,
      })),
      openQuoteCount: account.open_quotes.length,
    });

    return buildCustomerStrategistBoard({
      accountId,
      operatingProfile,
      whiteSpace,
      relationships,
      rentalConversion,
    });
  }, [account, accountId, profileQuery.data, signals]);

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
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountRentalConversionHref(accountId)}>Rental Conversion</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — AI Customer Strategist`}
        subtitle="30/60/90 account plans built from live account intelligence, whitespace, relationship, and conversion signals."
      />
      <QrmSubNav />

      {profileQuery.isLoading || strategistDataQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading customer strategist plan…</Card>
      ) : profileQuery.isError || strategistDataQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : strategistDataQuery.error instanceof Error
              ? strategistDataQuery.error.message
              : "Customer strategist is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Sparkles} label="Total Plays" value={String(board.summary.totalPlays)} />
            <SummaryCard icon={CalendarRange} label="30d" value={String(board.summary.immediatePlays)} />
            <SummaryCard icon={Compass} label="60d" value={String(board.summary.expansionPlays)} />
            <SummaryCard icon={CalendarRange} label="90d" value={String(board.summary.strategicPlays)} />
          </div>

          <div className="space-y-4">
            {board.plans.map((plan) => (
              <Card key={plan.horizon} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${horizonTone(plan.horizon)}`}>{plan.horizon}</span>
                      <span className={`text-[11px] font-medium ${confidenceTone(plan.confidence)}`}>
                        {plan.confidence} confidence
                      </span>
                    </div>
                    <h2 className="mt-1 text-lg font-semibold text-foreground">{plan.headline}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.objective}</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={buildAccountStrategistHref(accountId)}>Refresh plan</Link>
                  </Button>
                </div>

                <div className="mt-4 space-y-3">
                  {plan.plays.map((play) => (
                    <div key={play.key} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{play.title}</p>
                            <span className={`text-[11px] font-medium ${confidenceTone(play.confidence)}`}>
                              {play.confidence} confidence
                            </span>
                          </div>
                          <div className="mt-3 space-y-1">
                            {play.trace.map((line) => (
                              <p key={line} className="text-xs text-muted-foreground">
                                {line}
                              </p>
                            ))}
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link to={play.href}>
                            {play.actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
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
