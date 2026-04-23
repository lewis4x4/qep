/**
 * Decision Room — shared move-row fetcher.
 *
 * Both the team analytics page and the per-deal "Deals like this one"
 * lens need the same shape: recent moves from decision_room_moves,
 * hydrated with rep profile (for tenure), deal shape (for amount +
 * needs-assessment machine interest), and stage flags (for win/loss
 * split). Classified with the cohort tag triple at the same time.
 *
 * RLS keeps the reads workspace-scoped. Analytics and the lens share
 * the same React Query key so the network cost is paid once per
 * session.
 */
import { supabase } from "@/lib/supabase";
import {
  classifyCohort,
  type CohortTags,
} from "./decision-room-cohorts";
import type { MoveRow } from "./decision-room-analytics";

const DEFAULT_ROW_LIMIT = 500;

export const moveRowsQueryKey = (windowDays: number) =>
  ["decision-room", "moves-window", windowDays] as const;

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

interface DealView {
  name: string | null;
  amount: number | null;
  stage: StageDbRow | null | undefined;
  machineInterest: string | null;
}

/**
 * Fetch recent move rows + classify each with its cohort tag triple.
 * One entry query + three parallel hydrations. Limit defaults to 500
 * per call (React Query cache keyed on windowDays so multiple surfaces
 * share).
 */
export async function fetchMoveRows(
  windowDays: number,
  limit: number = DEFAULT_ROW_LIMIT,
): Promise<MoveRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const { data: moveData, error: moveErr } = await supabase
    .from("decision_room_moves")
    .select("id, move_text, mood, velocity_delta, created_at, user_id, deal_id")
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (moveErr) throw moveErr;
  const moves = (moveData ?? []) as MoveDbRow[];
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
  const dealById = new Map<string, DealView>(
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

  const now = new Date();

  return moves.map((row) => {
    const profile = row.user_id ? profileById.get(row.user_id) : null;
    const deal = row.deal_id ? dealById.get(row.deal_id) : null;
    const cohort: CohortTags = classifyCohort({
      machineInterest: deal?.machineInterest ?? null,
      dealName: deal?.name ?? null,
      dealAmount: deal?.amount ?? null,
      profileCreatedAt: profile?.created_at ?? null,
      now,
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
