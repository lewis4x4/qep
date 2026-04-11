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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
            supabase
              .from("voice_captures")
              .select("linked_contact_id, created_at, extracted_data")
              .eq("linked_company_id", accountId!)
              .limit(200),
            Promise.resolve({ data: [], error: null }),
          ]);

      if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (signaturesResult.error) throw new Error(signaturesResult.error.message);

      return buildRelationshipMapBoard({
        contacts: (contactsResult.data ?? []).map((row) => ({
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          title: row.title,
          email: row.email,
          phone: row.phone,
        })),
        deals,
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
          <p className="text-sm text-muted-foreground">This relationship map surface isn&apos;t available right now.</p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;
  const board = mapQuery.data;

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
            <Link to={buildAccountFleetIntelligenceHref(accountId)}>Fleet Intelligence</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountWhiteSpaceHref(accountId)}>White-Space Map</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Relationship Map`}
        subtitle="Who signs, influences, operates, blocks, and decides across the current account relationship."
      />
      <QrmSubNav />

      {mapQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading relationship signals…</Card>
      ) : mapQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {mapQuery.error instanceof Error ? mapQuery.error.message : "Relationship map is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <SummaryCard icon={UsersRound} label="Mapped Contacts" value={String(board.summary.contacts)} />
            <SummaryCard icon={Signature} label="Signers" value={String(board.summary.signers)} />
            <SummaryCard icon={UserCheck} label="Deciders" value={String(board.summary.deciders)} />
            <SummaryCard icon={Eye} label="Influencers" value={String(board.summary.influencers)} />
            <SummaryCard icon={Wrench} label="Operators" value={String(board.summary.operators)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Relationship roles</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Role assignment is evidence-backed from deals, needs assessments, voice captures, and signed quotes.
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={buildAccountRelationshipMapHref(accountId)}>Refresh map</Link>
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {board.contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No role-evidenced contacts are mapped yet. More deal discovery, voice capture, and signed quotes will enrich this surface.
                  </p>
                ) : (
                  board.contacts.map((contact) => (
                    <div key={contact.contactId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{contact.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {contact.title ?? "Title unknown"}
                            {contact.email ? ` · ${contact.email}` : ""}
                            {contact.phone ? ` · ${contact.phone}` : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {contact.roles.map((role) => {
                              const meta = roleMeta(role);
                              return (
                                <span
                                  key={role}
                                  className={`inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[11px] ${meta.tone}`}
                                >
                                  <meta.icon className="h-3 w-3" />
                                  {meta.label}
                                </span>
                              );
                            })}
                          </div>
                          <div className="mt-3 space-y-1">
                            {contact.evidence.slice(0, 4).map((line) => (
                              <p key={line} className="text-xs text-muted-foreground">
                                {line}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/qrm/contacts/${contact.contactId}`}>
                              Contact <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Latest signal: {formatDate(contact.lastSignalAt)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-400" />
                  <h2 className="text-sm font-semibold text-foreground">Blocker lane</h2>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {board.summary.blockers > 0
                    ? `${board.summary.blockers} mapped contact${board.summary.blockers === 1 ? "" : "s"} currently carry blocker or gatekeeper evidence.`
                    : "No blocker contacts are surfaced from current evidence."}
                </p>
              </Card>

              <Card className="p-4">
                <div className="flex items-center gap-2">
                  <Handshake className="h-4 w-4 text-qep-orange" />
                  <h2 className="text-sm font-semibold text-foreground">Unmatched stakeholders</h2>
                </div>
                <div className="mt-3 space-y-2">
                  {board.unmatchedStakeholders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Every named stakeholder signal resolved to a known CRM contact.
                    </p>
                  ) : (
                    board.unmatchedStakeholders.slice(0, 8).map((name) => (
                      <div key={name} className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-sm text-muted-foreground">
                        {name}
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Open White-Space Map to see the revenue lanes this account is still leaving uncaptured.
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={buildAccountWhiteSpaceHref(accountId)}>
                      White-space map <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </Card>
            </div>
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
