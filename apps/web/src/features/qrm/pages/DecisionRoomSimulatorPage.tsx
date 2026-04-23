import { useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
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
    enabled: Boolean(dealId) && Boolean(compositeQuery.data?.deal.companyId),
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
          .eq("deal_id", dealId)
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
        deals: compositeQuery.data ? [{
          id: compositeQuery.data.deal.id,
          name: compositeQuery.data.deal.name,
          primaryContactId: compositeQuery.data.deal.primaryContactId,
        }] : [],
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

  const composite = compositeQuery.data;
  const blocker = blockers.data
    ? groupBlockedDeals(blockers.data.deals, blockers.data.deposits, blockers.data.anomalies).groups
        .flatMap((group) => group.deals)
        .find((item) => item.dealId === dealId)
    : null;

  const roomSummary = composite
    ? buildDealRoomSummary({
        activities: composite.activities,
        demos: composite.demos,
        approvals: approvalsQuery.data ?? [],
      })
    : null;

  const loading =
    compositeQuery.isLoading ||
    relationshipQuery.isLoading ||
    approvalsQuery.isLoading ||
    blockers.isLoading;

  const errorMessage =
    compositeQuery.error instanceof Error
      ? compositeQuery.error.message
      : relationshipQuery.error instanceof Error
        ? relationshipQuery.error.message
        : approvalsQuery.error instanceof Error
          ? approvalsQuery.error.message
          : blockers.error instanceof Error
            ? blockers.error.message
            : null;

  const board = useMemo(
    () =>
      composite && relationshipQuery.data && roomSummary
        ? buildDecisionRoomBoard({
            dealId: dealId!,
            relationship: relationshipQuery.data,
            needsAssessment: composite.needsAssessment,
            blockerPresent: Boolean(blocker),
            openTaskCount: roomSummary?.openTaskCount ?? 0,
            overdueTaskCount: roomSummary?.overdueTaskCount ?? 0,
            pendingApprovalCount: roomSummary?.pendingApprovalCount ?? 0,
            quotePresented:
              composite.demos.some((demo) => demo.quote_presented) ||
              composite.activities.some((activity) => activity.activityType === "email"),
          })
        : null,
    [blocker, composite, dealId, relationshipQuery.data, approvalsQuery.data, roomSummary],
  );

  if (!dealId) {
    return <Navigate to="/qrm/deals" replace />;
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (errorMessage || !composite) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">{errorMessage ?? "Decision room simulator is unavailable right now."}</p>
        </DeckSurface>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={`/qrm/deals/${dealId}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to deal
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}/room`}>Deal Room</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}/decision-room`}>Decision Room Simulator</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}`}>
              Open detail <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={composite?.deal.name ? `${composite.deal.name} — Decision Room Simulator` : "Decision Room Simulator"}
        subtitle="Literal humans in the room, chairs they occupy, and most likely paths room takes before deal moves."
      />
      <QrmSubNav />

      {loading ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center text-sm text-muted-foreground">Loading decision room simulator…</DeckSurface>
      ) : errorMessage || !composite || !board ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {errorMessage ?? "Decision room simulator is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Named Participants</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.namedParticipants)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <UserRoundX className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ghost Participants</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.ghostParticipants)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Blockers</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.blockerCount)}</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <MessagesSquare className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Scenarios</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.scenarioCount)}</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Seats in the room</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Named humans and chair they appear to occupy from live CRM, assessment, voice, and signature evidence.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={`/qrm/deals/${dealId}/coach`}>
                  AI Deal Coach <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Simulated paths</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The likely ways this human room moves from the current evidence, with explicit confidence labels and working traces so rep can see why it is being suggested.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={`/qrm/deals/${dealId}/room`}>
                  Deal Room <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open Deal Room to run actual scenarios and see how blockers, tasks, and approvals respond to the live decision process.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={`/qrm/deals/${dealId}/room`}>
                  Deal Room <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical route</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use Decision Room Simulator for scenario testing before field execution, then move back into AI Deal Coach for active coaching.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to={`/qrm/deals/${dealId}/coach`}>
                  Refresh simulator <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>
        </>
      )}
    </div>
  );
}
