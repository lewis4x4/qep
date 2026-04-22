import { useMemo } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Eye,
  Shield,
  Siren,
  Swords,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCashflowWeatherHref,
  buildAccountCommandHref,
  buildAccountCrossDealerMirrorHref,
  buildAccountOperatingProfileHref,
  buildAccountRelationshipMapHref,
  buildAccountStrategistHref,
  buildAccountWhiteSpaceHref,
} from "../lib/account-command";
import {
  buildCustomerOperatingProfileBoard,
  type CustomerOperatingAssessment,
} from "../lib/customer-operating-profile";
import { buildRelationshipMapBoard } from "../lib/relationship-map";
import { buildWhiteSpaceMapBoard } from "../lib/white-space-map";
import { buildFleetIntelligenceBoard } from "../lib/fleet-intelligence";
import { buildCrossDealerMirrorBoard } from "../lib/cross-dealer-mirror";
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

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function makeModelKey(make: string | null | undefined, model: string | null | undefined): string | null {
  const normalizedMake = normalize(make);
  const normalizedModel = normalize(model);
  if (!normalizedMake || !normalizedModel) return null;
  return `${normalizedMake}::${normalizedModel}`;
}

export function CrossDealerMirrorPage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["cross-dealer-mirror", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["cross-dealer-mirror", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: true,
      }),
    staleTime: 30_000,
  });

  const signalsQuery = useQuery({
    queryKey: ["cross-dealer-mirror", accountId, "signals"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const [dealsResult, contactsResult, voiceResult, equipmentResult, listingsResult] = await Promise.all([
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
          .select("linked_contact_id, created_at, extracted_data, competitor_mentions")
          .eq("linked_company_id", accountId!)
          .limit(200),
        supabase
          .from("crm_equipment")
          .select("id, metadata, current_market_value, replacement_cost")
          .eq("company_id", accountId!)
          .eq("ownership", "customer_owned")
          .is("deleted_at", null)
          .limit(500),
        supabase
          .from("competitor_listings")
          .select("make, model, first_seen_at")
          .eq("is_active", true)
          .limit(1000),
      ]);

      if (dealsResult.error) throw new Error(dealsResult.error.message);
      if (contactsResult.error) throw new Error(contactsResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (listingsResult.error) throw new Error(listingsResult.error.message);

      const deals = dealsResult.data ?? [];
      const dealIds = deals.map((deal) => deal.id);

      const [assessmentsResult, signaturesResult] = dealIds.length > 0
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
          ])
        : await Promise.all([
            Promise.resolve({ data: [], error: null }),
            Promise.resolve({ data: [], error: null }),
          ]);

      if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
      if (signaturesResult.error) throw new Error(signaturesResult.error.message);

      return {
        deals,
        contacts: contactsResult.data ?? [],
        voiceSignals: voiceResult.data ?? [],
        assessments: assessmentsResult.data ?? [],
        signatures: signaturesResult.data ?? [],
        equipmentSignals: equipmentResult.data ?? [],
        listings: listingsResult.data ?? [],
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
          <p className="text-sm text-muted-foreground">
            This cross-dealer mirror surface isn&apos;t available right now.
          </p>
        </DeckSurface>
      </div>
    );
  }

  const account = accountQuery.data;

  const board = useMemo(() => {
    const signals = signalsQuery.data;
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

    const equipmentSignals = signals.equipmentSignals.map((row) => {
      const metadata = (row.metadata && typeof row.metadata === "object")
        ? row.metadata
        : {} as Record<string, unknown>;
      const attachments = Array.isArray(metadata.attachments)
        ? metadata.attachments.filter((item) => item != null)
        : [];
      return {
        equipmentId: row.id,
        attachmentCount: attachments.length,
        currentMarketValue: row.current_market_value,
        replacementCost: row.replacement_cost,
      };
    });

    const whiteSpace = buildWhiteSpaceMapBoard({
      fleet: account.fleet,
      service: account.service,
      parts: account.parts,
      profile: profileQuery.data ?? null,
      predictions: profileQuery.data?.fleet ?? [],
      equipmentSignals,
    });

    const fleet = buildFleetIntelligenceBoard({
      fleet: account.fleet,
      service: account.service,
      predictions: profileQuery.data?.fleet ?? [],
      equipmentMetadata: equipmentSignals.map((row) => ({
        equipmentId: row.equipmentId,
        attachmentCount: row.attachmentCount,
      })),
    });

    const fleetKeys = new Set(
      account.fleet
        .map((machine) => makeModelKey(machine.make, machine.model))
        .filter((value): value is string => Boolean(value)),
    );
    const matchingListings = signals.listings.filter((listing) => {
      const key = makeModelKey(listing.make, listing.model);
      return key != null && fleetKeys.has(key);
    });
    const staleListings = matchingListings.filter((listing) => {
      const firstSeen = Date.parse(listing.first_seen_at);
      return Number.isFinite(firstSeen) && firstSeen <= Date.now() - 21 * 86_400_000;
    }).length;
    const competitorMentionCount = signals.voiceSignals.reduce((sum, row) => {
      const mentions = Array.isArray(row.competitor_mentions)
        ? row.competitor_mentions.filter((entry): entry is string => typeof entry === "string")
        : [];
      return sum + mentions.length;
    }, 0);
    const expiringQuoteCount = account.open_quotes.filter((quote) => {
      if (!quote.expires_at) return false;
      const expiresAt = Date.parse(quote.expires_at);
      return Number.isFinite(expiresAt) && expiresAt <= Date.now() + 14 * 86_400_000;
    }).length;

    return buildCrossDealerMirrorBoard({
      accountId,
      operatingProfile,
      whiteSpace,
      relationships,
      fleet,
      openServiceJobs: account.service.filter((job) => !["closed", "invoiced", "cancelled"].includes(job.current_stage)).length,
      openQuoteCount: account.open_quotes.length,
      expiringQuoteCount,
      competitorMentionCount,
      matchingListings: matchingListings.length,
      staleListings,
    });
  }, [account, accountId, profileQuery.data, signalsQuery.data]);

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
            <Link to={buildAccountWhiteSpaceHref(accountId)}>White-Space Map</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountRelationshipMapHref(accountId)}>Relationship Map</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Cross-Dealer Mirror`}
        subtitle="Projected customer experience inside a competitor CRM: what they would see, how they would attack, and how we break the mirror first."
      />
      <QrmSubNav />

      {profileQuery.isLoading || signalsQuery.isLoading ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center text-sm text-muted-foreground">Loading cross-dealer mirror…</DeckSurface>
      ) : profileQuery.isError || signalsQuery.isError || !board ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : signalsQuery.error instanceof Error
              ? signalsQuery.error.message
              : "Cross-dealer mirror is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Visible Signals</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.visibleSignals)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Attack Paths</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.attackPaths)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Buyer Gaps</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.buyerGaps)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Siren className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Urgency</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{board.summary.urgencyScore}</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Mirror framing</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  This is not our internal account story. It is a cleaner, competitor-facing version of the same account as it would appear inside another dealer&apos;s CRM.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountCrossDealerMirrorHref(accountId)}>Refresh mirror</Link>
              </Button>
            </div>
          </DeckSurface>

          <div className="grid gap-4 xl:grid-cols-3">
            <MirrorColumn
              title="What They See"
              rows={board.theirView}
              emptyText="No obvious competitor-readable signal is elevated right now."
            />
            <MirrorColumn
              title="How They Attack"
              rows={board.likelyPlays}
              emptyText="No clear competitor play is visible right now."
            />
            <MirrorColumn
              title="How We Break It"
              rows={board.counterMoves}
              emptyText="No immediate counter-move is required right now."
            />
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical companion surfaces</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use the mirror to pressure-test the account plan, then move back into the operating routes that actually close gaps.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to={buildAccountStrategistHref(accountId)}>
                    Strategist <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to={buildAccountOperatingProfileHref(accountId)}>
                    Operating profile <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to={buildAccountCashflowWeatherHref(accountId)}>
                    Cashflow weather <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          </DeckSurface>
        </>
      )}
    </div>
  );
}

function MirrorColumn({
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
    <DeckSurface className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-4">
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
    </DeckSurface>
  );
}
