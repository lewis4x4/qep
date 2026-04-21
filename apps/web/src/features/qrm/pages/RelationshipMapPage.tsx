import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Eye,
  Handshake,
  ShieldAlert,
  Signature,
  UserCheck,
  UsersRound,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountFleetIntelligenceHref,
  buildAccountGenomeHref,
  buildAccountOperatingProfileHref,
  buildAccountRelationshipMapHref,
  buildAccountWhiteSpaceHref,
} from "../lib/account-command";
import { buildRelationshipMapBoard, type RelationshipRole } from "../lib/relationship-map";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

function formatDate(value: string | null): string {
  if (!value) return "No recent signal";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No recent signal";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function roleMeta(role: RelationshipRole): { label: string; icon: ComponentType<{ className?: string }>; tone: string } {
  switch (role) {
    case "signer":
      return { label: "Signer", icon: Signature, tone: "text-emerald-400" };
    case "decider":
      return { label: "Decider", icon: UserCheck, tone: "text-qep-orange" };
    case "influencer":
      return { label: "Influencer", icon: Eye, tone: "text-blue-400" };
    case "operator":
      return { label: "Operator", icon: Wrench, tone: "text-violet-400" };
    case "blocker":
      return { label: "Blocker", icon: ShieldAlert, tone: "text-red-400" };
  }
}

export function RelationshipMapPage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["relationship-map", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const mapQuery = useQuery({
    queryKey: ["relationship-map", accountId, "data"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const [contactsResult, dealsResult] = await Promise.all([
        supabase
          .from("crm_contacts")
          .select("id, first_name, last_name, title, email, phone")
          .eq("primary_company_id", accountId!)
          .is("deleted_at", null)
          .limit(200),
        supabase
          .from("crm_deals")
          .select("id, name, primary_contact_id")
          .eq("company_id", accountId!)
          .is("deleted_at", null)
          .limit(200),
      ]);

      if (contactsResult.error) throw new Error(contactsResult.error.message);
      if (dealsResult.error) throw new Error(dealsResult.error.message);

      const deals = (dealsResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        primaryContactId: row.primary_contact_id,
      }));

      const dealIds = deals.map((deal) => deal.id);
      const [assessmentsResult, voiceResult, signaturesResult] = dealIds.length > 0
        ? await Promise.all([
            supabase
              .from("needs_assessments")
              .select("contact_id, decision_maker_name, is_decision_maker, created_at")
              .in("deal_id", dealIds)
              .limit(200),
            supabase
              .from("voice_captures")
              .select("linked_contact_id, created_at, extracted_data")
              .eq("linked_company_id", accountId!)
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
            Promise.resolve({ data: [], error: null }),
          ]);

      if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (signaturesResult.error) throw new Error(signaturesResult.error.message);

      return {
        contacts: (contactsResult.data ?? []).map((row) => ({
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          title: row.title,
          email: row.email,
          phone: row.phone,
        })),
        assessments: (assessmentsResult.data ?? []).map((row) => ({
          contactId: row.contact_id,
          decisionMakerName: row.decision_maker_name,
          isDecisionMaker: row.is_decision_maker,
          createdAt: row.created_at,
        })),
        voiceSignals: (voiceResult.data ?? []).map((row) => ({
          linkedContactId: row.linked_contact_id,
          createdAt: row.created_at,
          extractedData: (row.extracted_data ?? null) as ExtractedDealData | null,
        })),
        signatures: (signaturesResult.data ?? []).map((row) => ({
          dealId: row.deal_id,
          signerName: row.signer_name,
          signerEmail: row.signer_email,
          signedAt: row.signed_at,
        })),
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
          <p className="text-sm text-muted-foreground">This relationship map surface isn&apos;t available right now.</p>
        </DeckSurface>
      </div>
    );
  }

  const board = useMemo(
    () =>
      buildRelationshipMapBoard({
        contacts: mapQuery.data?.contacts ?? [],
        deals: mapQuery.data?.deals ?? [],
        assessments: mapQuery.data?.assessments ?? [],
        voiceSignals: mapQuery.data?.voiceSignals ?? [],
        signatures: mapQuery.data?.signatures ?? [],
      }),
    [mapQuery.data],
  );

  if (mapQuery.isLoading || board?.contacts.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (mapQuery.isError || !board) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">This relationship map surface isn&apos;t available right now.</p>
        </DeckSurface>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8">
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
            <Link to={buildAccountFleetIntelligenceHref(accountId)}>Fleet Intelligence</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountWhiteSpaceHref(accountId)}>White-Space Map</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Relationship Map`}
        subtitle="Who signs, influences, operates, blocks, and decides around this account."
      />
      <QrmSubNav />

      <DeckSurface className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Canonical route</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Relationship Map is a signal-gathering surface. The command center remains the source of truth for operating work.
            </p>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link to={buildAccountCommandHref(accountId)}>
              Refresh map <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </DeckSurface>

      {board.summary.totalContacts > 0 && (
        <DeckSurface className="p-4">
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <UsersRound className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contacts</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.totalContacts)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Account contacts linked to deals and activities.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Assessments</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.totalAssessments)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Needs assessments with decision-maker status tracking.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Signature className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quotes Signed</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.totalSignatures)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Quote signatures across all account deals.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 bg-qep-deck-elevated/40 text-center flex items-center justify-center rounded-full">
                  <span className="text-xs font-semibold text-qep-orange">{formatDate(board.summary.latestAssessment)}</span>
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Latest Activity</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">Today</p>
              <p className="mt-1 text-xs text-muted-foreground">{board.summary.todayContactCount} contacts engaged.</p>
            </DeckSurface>
          </div>
        </DeckSurface>
      )}
    </div>
  );
}
