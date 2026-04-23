/**
 * DecisionRoomSimulatorPage — Phase 1 moonshot.
 *
 * A top-down conference-table visualization of the humans who decide every
 * equipment deal, with ghost seats for the archetypes the room expects but
 * hasn't filled yet. Four real scores (Decision Velocity, Coverage,
 * Consensus Risk, Latent Veto) replace the old count tiles; each seat has
 * an evidence chain and a persona-backed "Ask this seat" surface.
 *
 * Extension points are explicit:
 *   - Phase 2 (try-a-move): drop a chat bar at the bottom; seats get
 *     reaction bubbles via the same seat id.
 *   - Phase 3 (ghost inference): findGuidance on ghost seats is already
 *     structured for Tavily + exec title enrichment.
 *   - Phase 4 (time scrubber): buildDecisionRoomBoard takes a `now` param;
 *     swap in a selected timestamp and re-score.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";
import { fetchDealComposite } from "../lib/deal-composite-api";
import { buildDealRoomSummary, type DealRoomApproval } from "../lib/deal-room";
import {
  buildDecisionRoomBoard,
  type DecisionRoomSeat,
} from "../lib/decision-room-simulator";
import { buildRelationshipMapBoard, type RelationshipMapBoard } from "../lib/relationship-map";
import { useBlockers } from "../command-center/hooks/useBlockers";
import { groupBlockedDeals } from "../command-center/lib/blockerTypes";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DecisionRoomCanvas } from "../components/DecisionRoomCanvas";
import { DecisionRoomScoreboard } from "../components/DecisionRoomScoreboard";
import { DecisionRoomSeatDrawer } from "../components/DecisionRoomSeatDrawer";

const EMPTY_RELATIONSHIP_BOARD: RelationshipMapBoard = {
  summary: { contacts: 0, signers: 0, deciders: 0, influencers: 0, operators: 0, blockers: 0 },
  contacts: [],
  unmatchedStakeholders: [],
};

export function DecisionRoomSimulatorPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const blockers = useBlockers();
  const [selectedSeat, setSelectedSeat] = useState<DecisionRoomSeat | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
      if (!companyId) return EMPTY_RELATIONSHIP_BOARD;

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

      // One failing sub-read must not take down the whole surface.
      const contacts = contactsResult.error ? [] : (contactsResult.data ?? []);
      const voice = voiceResult.error ? [] : (voiceResult.data ?? []);
      const signatures = signaturesResult.error ? [] : (signaturesResult.data ?? []);

      return buildRelationshipMapBoard({
        contacts: contacts.map((row) => ({
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
        voiceSignals: voice.map((row) => ({
          linkedContactId: row.linked_contact_id,
          createdAt: row.created_at,
          extractedData: (row.extracted_data ?? null) as ExtractedDealData | null,
        })),
        signatures: signatures.map((row) => ({
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

  const loading = compositeQuery.isLoading;

  const board = useMemo(() => {
    if (!composite || !roomSummary) return null;
    return buildDecisionRoomBoard({
      dealId: dealId!,
      dealName: composite.deal.name ?? null,
      dealAmount: composite.deal.amount ?? null,
      expectedCloseOn: composite.deal.expectedCloseOn ?? null,
      companyName: composite.company?.name ?? null,
      relationship: relationshipQuery.data ?? EMPTY_RELATIONSHIP_BOARD,
      needsAssessment: composite.needsAssessment,
      blockerPresent: Boolean(blocker),
      openTaskCount: roomSummary?.openTaskCount ?? 0,
      overdueTaskCount: roomSummary?.overdueTaskCount ?? 0,
      pendingApprovalCount: roomSummary?.pendingApprovalCount ?? 0,
      quotePresented:
        composite.demos.some((demo) => demo.quote_presented) ||
        composite.activities.some((activity) => activity.activityType === "email"),
    });
  }, [composite, relationshipQuery.data, roomSummary, blocker, dealId]);

  if (!dealId) {
    return <Navigate to="/qrm/deals" replace />;
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-[460px] animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (!composite || !board) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Decision room simulator is unavailable right now.
          </p>
        </DeckSurface>
      </div>
    );
  }

  const namedCount = board.seats.filter((s) => s.status === "named").length;
  const ghostCount = board.seats.length - namedCount;

  function handleSelectSeat(seat: DecisionRoomSeat) {
    setSelectedSeat(seat);
    setDrawerOpen(true);
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
            <Link to={`/qrm/deals/${dealId}/coach`}>
              AI Deal Coach <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/deals/${dealId}`}>
              Open detail <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={composite?.deal.name ? `${composite.deal.name} — Decision Room` : "Decision Room"}
        subtitle={`${namedCount} named seat${namedCount === 1 ? "" : "s"} · ${ghostCount} ghost seat${ghostCount === 1 ? "" : "s"} mapped against the canonical equipment-sale decision room`}
      />
      <QrmSubNav />

      <DecisionRoomScoreboard scores={board.scores} />

      <DecisionRoomCanvas
        seats={board.seats}
        selectedSeatId={selectedSeat?.id ?? null}
        onSelectSeat={handleSelectSeat}
        companyName={board.companyName}
        dealName={board.dealName}
      />

      {/* Legend / read-me */}
      <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_hsl(150_80%_45%/0.6)]" />
            Champion
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_8px_hsl(0_80%_55%/0.6)]" />
            Blocker
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-qep-orange shadow-[0_0_8px_hsl(var(--qep-orange)/0.6)]" />
            Neutral / unknown
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-white/50" />
            Ghost seat
          </span>
          <span className="flex items-center gap-2">
            <span className="text-foreground/70">Size</span>
            <span>= decision power</span>
          </span>
          <span className="ml-auto text-[11px] italic">
            Tap any seat to see evidence and ask them a grounded question.
          </span>
        </div>
      </DeckSurface>

      <DecisionRoomSeatDrawer
        seat={selectedSeat}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        dealId={dealId}
        companyName={board.companyName}
        dealName={board.dealName}
      />
    </div>
  );
}
