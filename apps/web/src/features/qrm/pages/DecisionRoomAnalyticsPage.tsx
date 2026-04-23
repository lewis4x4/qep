/**
 * DecisionRoomAnalyticsPage — team-wide move intelligence.
 *
 * Now that every Try-a-move run persists to decision_room_moves under
 * RLS, managers (and reps) can see patterns across the whole workspace:
 * which moves get tried most, which reps drive the activity, and which
 * moves correlate with deals that later closed won vs lost.
 *
 * Pure reads. RLS scopes everything to the caller's workspace. The page
 * fetches up to 500 rows from the last 90 days and aggregates client-
 * side via decision-room-analytics.ts.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Award,
  BarChart3,
  Flame,
  Gauge,
  Minus,
  Target,
  ThumbsDown,
  ThumbsUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  aggregateMoves,
  type MoveCluster,
  type MoveRow,
  type MoodDistribution,
  type RepRow,
} from "../lib/decision-room-analytics";
import {
  classifyCohort,
  type CohortFilter,
  EMPTY_COHORT_FILTER,
  filterMatches,
  isEmptyFilter,
} from "../lib/decision-room-cohorts";
import {
  DecisionRoomCohortFilters,
  loadCohortFilter,
} from "../components/DecisionRoomCohortFilters";
import { DecisionRoomCohortCompare } from "../components/DecisionRoomCohortCompare";
import { cn } from "@/lib/utils";

const WINDOW_OPTIONS: Array<{ label: string; days: number }> = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];
const DEFAULT_WINDOW_DAYS = 30;
const ROW_LIMIT = 500;

interface MoveDbRow {
  id: string;
  move_text: string;
  mood: string | null;
  velocity_delta: number | null;
  created_at: string;
  user_id: string | null;
  deal_id: string | null;
}

interface ProfileDbRow {
  id: string;
  full_name: string | null;
  created_at: string | null;
}

interface DealDbRow {
  id: string;
  name: string | null;
  amount: number | null;
  stage_id: string | null;
  needs_assessment_id: string | null;
}

interface StageDbRow {
  id: string;
  is_closed_won: boolean | null;
  is_closed_lost: boolean | null;
}

interface NeedsAssessmentDbRow {
  id: string;
  machine_interest: string | null;
}

/**
 * Three parallel RLS-scoped queries, joined client-side. Intentionally
 * NOT using PostgREST embedded-relationship syntax — the FK names
 * between decision_room_moves → qrm_deals → qrm_deal_stages evolved
 * through the crm→qrm rename and any disambiguator drift would throw
 * at runtime on every page load. Flat queries + client join is robust.
 */
async function fetchAnalyticsRows(windowDays: number): Promise<MoveRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const { data: moveRows, error: moveErr } = await supabase
    .from("decision_room_moves")
    .select("id, move_text, mood, velocity_delta, created_at, user_id, deal_id")
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);
  if (moveErr) throw moveErr;
  const moves = (moveRows ?? []) as MoveDbRow[];
  if (moves.length === 0) return [];

  const userIds = Array.from(new Set(moves.map((m) => m.user_id).filter((v): v is string => !!v)));
  const dealIds = Array.from(new Set(moves.map((m) => m.deal_id).filter((v): v is string => !!v)));

  const [profilesResult, dealsResult] = await Promise.all([
    userIds.length > 0
      ? supabase.from("profiles").select("id, full_name, created_at").in("id", userIds)
      : Promise.resolve({ data: [] as ProfileDbRow[], error: null }),
    dealIds.length > 0
      ? supabase
          .from("qrm_deals")
          .select("id, name, amount, stage_id, needs_assessment_id")
          .in("id", dealIds)
      : Promise.resolve({ data: [] as DealDbRow[], error: null }),
  ]);

  const profiles = (profilesResult.error ? [] : (profilesResult.data ?? [])) as ProfileDbRow[];
  const deals = (dealsResult.error ? [] : (dealsResult.data ?? [])) as DealDbRow[];

  const stageIds = Array.from(
    new Set(deals.map((d) => d.stage_id).filter((v): v is string => !!v)),
  );
  const assessmentIds = Array.from(
    new Set(deals.map((d) => d.needs_assessment_id).filter((v): v is string => !!v)),
  );

  const [stageResult, assessmentResult] = await Promise.all([
    stageIds.length > 0
      ? supabase
          .from("qrm_deal_stages")
          .select("id, is_closed_won, is_closed_lost")
          .in("id", stageIds)
      : Promise.resolve({ data: [] as StageDbRow[], error: null }),
    assessmentIds.length > 0
      ? supabase
          .from("needs_assessments")
          .select("id, machine_interest")
          .in("id", assessmentIds)
      : Promise.resolve({ data: [] as NeedsAssessmentDbRow[], error: null }),
  ]);

  const stages = (stageResult.error ? [] : (stageResult.data ?? [])) as StageDbRow[];
  const assessments = (assessmentResult.error ? [] : (assessmentResult.data ?? [])) as NeedsAssessmentDbRow[];

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const assessmentById = new Map(assessments.map((a) => [a.id, a]));
  const dealById = new Map(
    deals.map((d) => [
      d.id,
      {
        name: d.name,
        amount: d.amount,
        stage: d.stage_id ? stageById.get(d.stage_id) ?? null : null,
        machineInterest: d.needs_assessment_id
          ? assessmentById.get(d.needs_assessment_id)?.machine_interest ?? null
          : null,
      },
    ]),
  );

  const classifiedNow = new Date();

  return moves.map((row) => {
    const profile = row.user_id ? profileById.get(row.user_id) : null;
    const deal = row.deal_id ? dealById.get(row.deal_id) : null;
    const cohort = classifyCohort({
      machineInterest: deal?.machineInterest ?? null,
      dealName: deal?.name ?? null,
      dealAmount: deal?.amount ?? null,
      profileCreatedAt: profile?.created_at ?? null,
      now: classifiedNow,
    });
    return {
      id: row.id,
      moveText: row.move_text,
      mood: (row.mood as "positive" | "mixed" | "negative" | null) ?? null,
      velocityDelta: row.velocity_delta,
      createdAt: row.created_at,
      userId: row.user_id,
      userName: profile?.full_name ?? null,
      dealId: row.deal_id,
      dealName: deal?.name ?? null,
      dealStageIsWon: deal?.stage?.is_closed_won ?? null,
      dealStageIsLost: deal?.stage?.is_closed_lost ?? null,
      cohort,
    };
  });
}

function moodPct(dist: MoodDistribution): {
  positivePct: number;
  mixedPct: number;
  negativePct: number;
  unknownPct: number;
} {
  if (dist.total === 0) return { positivePct: 0, mixedPct: 0, negativePct: 0, unknownPct: 0 };
  return {
    positivePct: Math.round((dist.positive / dist.total) * 100),
    mixedPct: Math.round((dist.mixed / dist.total) * 100),
    negativePct: Math.round((dist.negative / dist.total) * 100),
    unknownPct: Math.round((dist.unknown / dist.total) * 100),
  };
}

function MoodBar({ dist, className }: { dist: MoodDistribution; className?: string }) {
  const { positivePct, mixedPct, negativePct } = moodPct(dist);
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-white/5", className)}>
      <div className="bg-emerald-400" style={{ width: `${positivePct}%` }} />
      <div className="bg-amber-400" style={{ width: `${mixedPct}%` }} />
      <div className="bg-red-400" style={{ width: `${negativePct}%` }} />
    </div>
  );
}

function MoodChips({ dist }: { dist: MoodDistribution }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      {dist.positive > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-emerald-200">
          <ThumbsUp className="h-2.5 w-2.5" aria-hidden /> {dist.positive}
        </span>
      ) : null}
      {dist.mixed > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-amber-200">
          <Minus className="h-2.5 w-2.5" aria-hidden /> {dist.mixed}
        </span>
      ) : null}
      {dist.negative > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/10 px-1.5 py-0.5 text-red-200">
          <ThumbsDown className="h-2.5 w-2.5" aria-hidden /> {dist.negative}
        </span>
      ) : null}
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "—";
  const diffMs = Date.now() - parsed;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function ClusterList({
  clusters,
  emptyCopy,
}: {
  clusters: MoveCluster[];
  emptyCopy: string;
}) {
  if (clusters.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyCopy}</p>;
  }
  return (
    <ol className="space-y-2">
      {clusters.map((cluster, idx) => (
        <li
          key={cluster.signature}
          className="rounded-lg border border-qep-deck-rule bg-qep-deck-elevated/60 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span className="font-mono text-[11px] text-muted-foreground">{idx + 1}.</span>
                <span className="truncate">{cluster.exemplar}</span>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">
                  ×{cluster.count}
                </span>
                {cluster.medianVelocityDelta != null ? (
                  <span>
                    median velocity{" "}
                    <span
                      className={cn(
                        "font-mono",
                        cluster.medianVelocityDelta < 0
                          ? "text-emerald-300"
                          : cluster.medianVelocityDelta > 0
                            ? "text-red-300"
                            : "text-white/80",
                      )}
                    >
                      {cluster.medianVelocityDelta > 0 ? "+" : ""}
                      {cluster.medianVelocityDelta}d
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
            <MoodChips dist={cluster.mood} />
          </div>
          <MoodBar dist={cluster.mood} className="mt-2" />
        </li>
      ))}
    </ol>
  );
}

function RepLeaderboard({ reps }: { reps: RepRow[] }) {
  if (reps.length === 0) {
    return <p className="text-xs text-muted-foreground">No reps have run moves in this window yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {reps.slice(0, 10).map((rep, idx) => {
        const { positivePct } = moodPct(rep.mood);
        return (
          <li
            key={rep.userId}
            className="flex items-center gap-3 rounded-lg border border-qep-deck-rule bg-qep-deck-elevated/60 p-3"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-qep-orange/15 font-mono text-[11px] font-semibold text-qep-orange">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{rep.userName}</p>
              <p className="text-[11px] text-muted-foreground">
                {rep.moveCount} move{rep.moveCount === 1 ? "" : "s"} · {rep.dealsTouched} deal
                {rep.dealsTouched === 1 ? "" : "s"} · last {formatRelative(rep.lastMoveAt)} · {positivePct}% positive
              </p>
              <MoodBar dist={rep.mood} className="mt-1.5" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function DecisionRoomAnalyticsPage() {
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [cohortFilter, setCohortFilter] = useState<CohortFilter>(() => loadCohortFilter());

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["decision-room", "analytics", windowDays],
    queryFn: () => fetchAnalyticsRows(windowDays),
    staleTime: 60_000,
  });

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    if (isEmptyFilter(cohortFilter)) return rows;
    return rows.filter((r) => filterMatches(r.cohort, cohortFilter));
  }, [rows, cohortFilter]);

  const aggregate = useMemo(
    () => (filteredRows ? aggregateMoves(filteredRows, windowDays) : null),
    [filteredRows, windowDays],
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/qrm/deals">
            <ArrowLeft className="h-4 w-4" />
            Back to deals
          </Link>
        </Button>
        <div className="flex gap-1 rounded-full border border-qep-deck-rule bg-qep-deck-elevated/60 p-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => setWindowDays(opt.days)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors",
                windowDays === opt.days
                  ? "bg-qep-orange/20 text-qep-orange"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <QrmPageHeader
        title="Decision Room Analytics"
        subtitle="Patterns across every move your team has simulated — what gets tried, who tries it, what works, what doesn't."
      />
      <QrmSubNav />

      <DecisionRoomCohortFilters value={cohortFilter} onChange={setCohortFilter} />

      {rows && rows.length > 0 ? (
        <DecisionRoomCohortCompare rows={rows} windowDays={windowDays} />
      ) : null}

      {error ? (
        <DeckSurface className="border-red-400/40 bg-red-500/10 p-5">
          <p className="text-sm text-red-200">Couldn't load analytics. {(error as Error).message}</p>
        </DeckSurface>
      ) : null}

      {isLoading || !aggregate ? (
        <div className="grid gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <DeckSurface key={i} className="h-28 animate-pulse">
              <div className="h-full" />
            </DeckSurface>
          ))}
        </div>
      ) : aggregate.totalMoves === 0 ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No Try-a-move runs in the last {windowDays} days yet. Open any deal's Decision Room and
            try a move — it'll show up here.
          </p>
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/60 p-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-qep-orange" aria-hidden />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Moves simulated
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{aggregate.totalMoves}</p>
              <p className="text-[11px] text-muted-foreground">last {aggregate.recentDays} days</p>
            </DeckSurface>
            <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/60 p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-qep-orange" aria-hidden />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Reps active
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{aggregate.uniqueReps}</p>
              <p className="text-[11px] text-muted-foreground">running moves in this window</p>
            </DeckSurface>
            <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/60 p-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-qep-orange" aria-hidden />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Deals touched
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{aggregate.uniqueDeals}</p>
              <p className="text-[11px] text-muted-foreground">simulated against</p>
            </DeckSurface>
            <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/60 p-4">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-qep-orange" aria-hidden />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Overall mood
                </p>
              </div>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {moodPct(aggregate.overallMood).positivePct}% positive
              </p>
              <MoodBar dist={aggregate.overallMood} className="mt-2" />
            </DeckSurface>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-5">
              <div className="mb-3 flex items-center gap-2">
                <Flame className="h-4 w-4 text-qep-orange" aria-hidden />
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Top moves — what gets tried most
                </h2>
              </div>
              <ClusterList
                clusters={aggregate.topMoves}
                emptyCopy="Not enough moves yet to cluster — try a few across a couple of deals."
              />
            </DeckSurface>

            <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-5">
              <div className="mb-3 flex items-center gap-2">
                <Award className="h-4 w-4 text-qep-orange" aria-hidden />
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Rep leaderboard
                </h2>
              </div>
              <RepLeaderboard reps={aggregate.reps} />
            </DeckSurface>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <DeckSurface className="border-emerald-400/30 bg-emerald-400/[0.04] p-5">
              <div className="mb-3 flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-emerald-300" aria-hidden />
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  Winning playbook — moves on deals that closed won
                </h2>
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                {aggregate.winningPlaybook.rows.length} move
                {aggregate.winningPlaybook.rows.length === 1 ? "" : "s"} simulated against closed-won
                deals in this window.
              </p>
              <ClusterList
                clusters={aggregate.winningPlaybook.topClusters}
                emptyCopy="No moves on closed-won deals yet — every simulator run against a live deal that later closes-won counts."
              />
            </DeckSurface>

            <DeckSurface className="border-red-400/30 bg-red-500/[0.04] p-5">
              <div className="mb-3 flex items-center gap-2">
                <ThumbsDown className="h-4 w-4 text-red-300" aria-hidden />
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-200">
                  Missed-it patterns — moves on deals that closed lost
                </h2>
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                {aggregate.losingPatterns.rows.length} move
                {aggregate.losingPatterns.rows.length === 1 ? "" : "s"} simulated against closed-lost
                deals in this window.
              </p>
              <ClusterList
                clusters={aggregate.losingPatterns.topClusters}
                emptyCopy="No moves on closed-lost deals yet — these surface once losses start closing out."
              />
            </DeckSurface>
          </div>
        </>
      )}
    </div>
  );
}
