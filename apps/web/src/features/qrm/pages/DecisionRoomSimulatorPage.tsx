import { useMemo } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  MessagesSquare,
  ShieldAlert,
  Users,
  UserRoundX,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";
import { fetchDealComposite } from "../lib/deal-composite-api";
import { buildDealRoomSummary, type DealRoomApproval } from "../lib/deal-room";
import { buildDecisionRoomBoard } from "../lib/decision-room-simulator";
import { buildRelationshipMapBoard } from "../lib/relationship-map";
import { useBlockers } from "../command-center/hooks/useBlockers";
import { groupBlockedDeals } from "../command-center/lib/blockerTypes";
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

export function DecisionRoomSimulatorPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const blockers = useBlockers();

  const compositeQuery = useQuery({
    queryKey: ["decision-room-simulator", dealId, "composite"],
    queryFn: () => fetchDealComposite(dealId!),
    enabled: Boolean(dealId),
    staleTime: 30_000,
  });

  const relationshipQuery = useQuery({
    queryKey: ["decision-room-simulator", dealId, "relationship"],
    enabled: Boolean(dealId && compositeQuery.data?.deal.companyId),
    queryFn: async () => {
      const companyId = compositeQuery.data?.deal.companyId;
      if (!companyId) return null;

      const [contactsResult, voiceResult, signaturesResult] = await Promise.all([
        supabase
          .from("crm_contacts")
          .select("id, first_name, last_name, title, email, phone")
          .eq("primary_company_id", companyId)
          .is("deleted_at", null)
          .limit(200),
        supabase
          .from("voice_captures")
          .select("linked_contact_id, created_at, extracted_data")
          .eq("linked_company_id", companyId)
          .limit(200),
        supabase
          .from("quote_signatures")
          .select("deal_id, signer_name, signer_email, signed_at")
          .eq("deal_id", dealId!)
          .limit(100),
      ]);

      if (contactsResult.error) throw new Error(contactsResult.error.message);
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
        deals: compositeQuery.data
          ? [{
              id: compositeQuery.data.deal.id,
              name: compositeQuery.data.deal.name,
              primaryContactId: compositeQuery.data.deal.primaryContactId,
            }]
          : [],
        assessments: compositeQuery.data?.needsAssessment
          ? [{
              contactId: compositeQuery.data.deal.primaryContactId,
              decisionMakerName: compositeQuery.data.needsAssessment.decision_maker_name,
              isDecisionMaker: compositeQuery.data.needsAssessment.is_decision_maker,
              createdAt: compositeQuery.data.deal.updatedAt,
            }]
          : [],
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

  const approvalsQuery = useQuery({
    queryKey: ["decision-room-simulator", dealId, "approvals"],
    enabled: Boolean(dealId),
    queryFn: async (): Promise<DealRoomApproval[]> => {
      try {
        const { data, error } = await supabase
          .from("flow_approvals")
          .select("id, subject, status")
          .in("status", ["pending", "escalated"])
          .contains("context_summary", { entity_id: dealId });
        if (error) throw error;
        return (data ?? []) as DealRoomApproval[];
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });

  if (!dealId) {
    return <Navigate to="/qrm/deals" replace />;
  }

  const composite = compositeQuery.data;
  const blocker = blockers.data
    ? groupBlockedDeals(blockers.data.deals, blockers.data.deposits, blockers.data.anomalies).groups
        .flatMap((group) => group.deals)
        .find((item) => item.dealId === dealId) ?? null
    : null;
  const roomSummary = composite
    ? buildDealRoomSummary({
        activities: composite.activities,
        demos: composite.demos,
        approvals: approvalsQuery.data ?? [],
      })
    : null;

  const board = useMemo(() => {
    if (!composite || !relationshipQuery.data || !roomSummary) return null;
    return buildDecisionRoomBoard({
      dealId,
      relationship: relationshipQuery.data,
      needsAssessment: composite.needsAssessment,
      blockerPresent: Boolean(blocker),
      openTaskCount: roomSummary.openTaskCount,
      overdueTaskCount: roomSummary.overdueTaskCount,
      pendingApprovalCount: roomSummary.pendingApprovalCount,
      quotePresented: composite.demos.some((demo) => demo.quote_presented) || composite.activities.some((activity) => activity.activityType === "email"),
    });
  }, [blocker, composite, dealId, relationshipQuery.data, roomSummary]);

  const loading =
    compositeQuery.isLoading ||
    relationshipQuery.isLoading ||
    approvalsQuery.isLoading ||
    blockers.isLoading;
  const error =
    compositeQuery.error ||
    relationshipQuery.error ||
    approvalsQuery.error ||
    blockers.error;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={`/qrm/deals/${dealId}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to deal
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}/room`}>Deal Room</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}/coach`}>AI Deal Coach</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={composite?.deal.name ? `${composite.deal.name} — Decision Room Simulator` : "Decision Room Simulator"}
        subtitle="Literal humans in the room, the chair they occupy, and the most likely paths the room takes before the deal moves."
      />
      <QrmSubNav />

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading decision room simulator…</Card>
      ) : error || !composite || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {error instanceof Error ? error.message : "Decision room simulator is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Users} label="Named Participants" value={String(board.summary.namedParticipants)} />
            <SummaryCard icon={UserRoundX} label="Ghost Participants" value={String(board.summary.ghostParticipants)} tone={board.summary.ghostParticipants > 0 ? "warn" : "default"} />
            <SummaryCard icon={ShieldAlert} label="Blockers" value={String(board.summary.blockerCount)} tone={board.summary.blockerCount > 0 ? "warn" : "default"} />
            <SummaryCard icon={MessagesSquare} label="Scenarios" value={String(board.summary.scenarioCount)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Seats in the room</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Named humans and the chair they appear to occupy from live CRM, assessment, voice, and signature evidence.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {board.seats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No named participants are resolved yet.</p>
                ) : (
                  board.seats.map((seat) => (
                    <div key={seat.key} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{seat.label}</p>
                        <span className={`text-[11px] font-medium ${confidenceTone(seat.confidence)}`}>
                          {seat.confidence} confidence
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{seat.roleSummary}</p>
                      <div className="mt-3 space-y-1">
                        {seat.trace.map((line) => (
                          <p key={line} className="text-xs text-muted-foreground">
                            {line}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))
                )}
                {relationshipQuery.data && relationshipQuery.data.unmatchedStakeholders.length > 0 ? (
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <p className="text-sm font-semibold text-foreground">Unresolved chairs</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {relationshipQuery.data.unmatchedStakeholders.join(", ")}
                    </p>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Simulated paths</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The likely ways this human room moves from the current evidence, with explicit confidence labels and working trace.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {board.scenarios.map((scenario) => (
                  <div key={scenario.key} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{scenario.title}</p>
                          <span className={`text-[11px] font-medium ${confidenceTone(scenario.confidence)}`}>
                            {scenario.confidence} confidence
                          </span>
                        </div>
                        <div className="mt-3 space-y-1">
                          {scenario.trace.map((line) => (
                            <p key={line} className="text-xs text-muted-foreground">
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link to={scenario.href}>
                          {scenario.actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
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
