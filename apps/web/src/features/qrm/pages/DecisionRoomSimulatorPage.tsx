/**
 * DecisionRoomSimulatorPage — Phase 1 + Phase 2 moonshot.
 *
 * Top-down conference-table view of the humans who decide every equipment
 * deal. Surfaces:
 *   - Coach's Read — one tight paragraph from the model, grounded on the
 *     board state. Cached per (dealId, seat-stance hash).
 *   - Real scores — Decision Velocity, Coverage, Consensus Risk, Latent
 *     Veto. Velocity tile animates a delta chip after each tried move.
 *   - Conference-table canvas — named seats + archetype ghost seats,
 *     roving-tabindex keyboard nav, click opens the seat drawer.
 *   - Recommended Moves — three concrete ranked next actions; clicking
 *     one pre-fills the Try-a-move bar.
 *   - Try-a-move — the simulator that simulates. Rep types a move, edge
 *     function fans out parallel persona reactions, page animates to the
 *     new velocity and grows the Move History panel.
 *   - Seat drawer — per-seat evidence + ghost find-guidance + persona chat.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, BarChart3 } from "lucide-react";
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
import { buildRecommendedMoves, type RecommendedMove } from "../lib/decision-room-moves";
import { projectAllHorizons } from "../lib/decision-room-future";
import { useBlockers } from "../command-center/hooks/useBlockers";
import { groupBlockedDeals } from "../command-center/lib/blockerTypes";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DecisionRoomCanvas } from "../components/DecisionRoomCanvas";
import { DecisionRoomScoreboard } from "../components/DecisionRoomScoreboard";
import { DecisionRoomSeatDrawer } from "../components/DecisionRoomSeatDrawer";
import {
  DecisionRoomCoachRead,
  coachReadQueryKey,
  fetchCoachRead,
} from "../components/DecisionRoomCoachRead";
import { DecisionRoomRecommendedMoves } from "../components/DecisionRoomRecommendedMoves";
import { DecisionRoomMoveBar, type TriedMove } from "../components/DecisionRoomMoveBar";
import { DecisionRoomMoveHistory } from "../components/DecisionRoomMoveHistory";
import { DecisionRoomFuturePulse } from "../components/DecisionRoomFuturePulse";
import { DecisionRoomLossLens } from "../components/DecisionRoomLossLens";
import { DecisionRoomWinFormula } from "../components/DecisionRoomWinFormula";
import { DecisionRoomBriefExport } from "../components/DecisionRoomBriefExport";
import { DecisionRoomGymPicker } from "../components/DecisionRoomGymPicker";
import { DecisionRoomReplayBanner } from "../components/DecisionRoomReplayBanner";
import {
  insertMoveToDb,
  loadMoveHistoryFromDb,
  loadMoveHistoryFromStorage,
  persistMoveHistoryToStorage,
} from "../lib/decision-room-moves-persist";

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
  const [moveHistory, setMoveHistory] = useState<TriedMove[]>([]);
  const [movePrefill, setMovePrefill] = useState<string | null>(null);

  // Hydrate from localStorage immediately (instant flash-free render),
  // then let the DB query authoritative-overlay once it resolves.
  useEffect(() => {
    if (!dealId) return;
    const cached = loadMoveHistoryFromStorage(dealId);
    if (cached.length > 0) setMoveHistory(cached);
  }, [dealId]);

  const dbMoveHistoryQuery = useQuery({
    queryKey: ["decision-room-simulator", dealId, "moves"],
    queryFn: () => loadMoveHistoryFromDb(dealId!),
    enabled: Boolean(dealId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!dbMoveHistoryQuery.data) return;
    setMoveHistory(dbMoveHistoryQuery.data);
  }, [dbMoveHistoryQuery.data]);

  // Mirror to localStorage so the next page mount gets the instant hydrate.
  useEffect(() => {
    if (!dealId) return;
    persistMoveHistoryToStorage(dealId, moveHistory);
  }, [dealId, moveHistory]);

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
          .select("id, first_name, last_name, title, email, phone, metadata")
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
        contacts: contacts.map((row) => {
          // Pull the rep-authored archetype override out of metadata.
          // We accept unknown shapes defensively — this field is optional
          // and can be absent, null, or legacy objects.
          const meta = (row.metadata as Record<string, unknown> | null) ?? null;
          const override = meta && typeof meta === "object"
            ? (meta.decision_room_override as Record<string, unknown> | null)?.archetype
            : null;
          return {
            id: row.id,
            firstName: row.first_name,
            lastName: row.last_name,
            title: row.title,
            email: row.email,
            phone: row.phone,
            archetypeOverride: typeof override === "string" ? override : null,
          };
        }),
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

  const recommendedMoves = useMemo(
    () => (board ? buildRecommendedMoves(board) : []),
    [board],
  );

  // Share the coach-read cache with the brief export so both the top-of-
  // page paragraph and the downloadable markdown stay in sync.
  const coachReadQuery = useQuery({
    queryKey: board ? coachReadQueryKey(board) : ["decision-room", "coach-read", "pending"],
    queryFn: () => fetchCoachRead(board!),
    enabled: Boolean(board),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const futureTicks = useMemo(
    () => (board ? projectAllHorizons(board) : []),
    [board],
  );

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
  const latestMove = moveHistory[0] ?? null;
  const velocityDelta = latestMove?.aggregate.velocityDelta ?? null;

  function handleSelectSeat(seat: DecisionRoomSeat) {
    setSelectedSeat(seat);
    setDrawerOpen(true);
  }

  function handlePickRecommendedMove(move: RecommendedMove) {
    if (move.seatId) {
      const seat = board!.seats.find((s) => s.id === move.seatId) ?? null;
      if (seat) {
        setSelectedSeat(seat);
        setDrawerOpen(true);
      }
    }
    if (move.tryMovePrompt) {
      setMovePrefill(move.tryMovePrompt);
    }
  }

  function handleMoveResult(result: TriedMove) {
    setMoveHistory((prev) => [result, ...prev].slice(0, 20));
    // Persist to DB in the background — local state already updated, so the
    // UI doesn't block on the round-trip. Best-effort on failure: the
    // localStorage mirror still covers the happy path.
    void insertMoveToDb(dealId!, result).catch((err) => {
      console.warn("[decision-room] move persist failed", err);
    });
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
            <Link to="/qrm/decision-room/analytics" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              Team analytics
            </Link>
          </Button>
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

      <DecisionRoomReplayBanner
        lossReason={composite.lossFields?.lossReason ?? null}
        competitor={composite.lossFields?.competitor ?? null}
        dealName={board.dealName}
      />

      <DecisionRoomCoachRead board={board} />

      <DecisionRoomScoreboard scores={board.scores} velocityDelta={velocityDelta} />

      <DecisionRoomCanvas
        seats={board.seats}
        selectedSeatId={selectedSeat?.id ?? null}
        onSelectSeat={handleSelectSeat}
        companyName={board.companyName}
        dealName={board.dealName}
      />

      <DecisionRoomRecommendedMoves
        moves={recommendedMoves}
        onPickMove={handlePickRecommendedMove}
      />

      {futureTicks.length > 0 ? <DecisionRoomFuturePulse ticks={futureTicks} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <DecisionRoomWinFormula
          dealId={dealId}
          companyId={composite.company?.id ?? null}
          companyName={board.companyName}
          dealAmount={composite.deal.amount ?? null}
        />
        <DecisionRoomLossLens
          dealId={dealId}
          companyId={composite.company?.id ?? null}
          companyName={board.companyName}
          dealAmount={composite.deal.amount ?? null}
        />
      </div>

      <DecisionRoomBriefExport
        board={board}
        coachRead={coachReadQuery.data?.read ?? null}
        recommendedMoves={recommendedMoves}
        futureTicks={futureTicks}
        moveHistory={moveHistory}
      />

      <DecisionRoomGymPicker currentDealId={dealId} />

      <DecisionRoomMoveBar
        board={board}
        onMoveResult={handleMoveResult}
        prefill={movePrefill}
        onPrefillConsumed={() => setMovePrefill(null)}
      />

      <DecisionRoomMoveHistory
        history={moveHistory}
        seats={board.seats}
        onPickSeat={handleSelectSeat}
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
            Tap any seat to see evidence and ask them a grounded question. Use arrow keys to cycle seats.
          </span>
        </div>
      </DeckSurface>

      <DecisionRoomSeatDrawer
        seat={selectedSeat}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        dealId={dealId}
        companyId={composite.company?.id ?? null}
        companyName={board.companyName}
        dealName={board.dealName}
        repName={null}
        allSeats={board.seats}
      />
    </div>
  );
}
