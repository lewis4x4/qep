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
import type { Mood, MoveRow } from "./decision-room-analytics";

const DEFAULT_ROW_LIMIT = 500;

export const moveRowsQueryKey = (windowDays: number) =>
  ["decision-room", "moves-window", windowDays] as const;

interface MoveDbRow {
  id: string;
  move_text: string;
  mood: Mood | null;
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
}

interface StageDbRow {
  id: string;
  is_closed_won: boolean | null;
  is_closed_lost: boolean | null;
}

interface NeedsAssessmentDbRow {
  deal_id: string;
  machine_interest: string | null;
}

interface DealView {
  name: string | null;
  amount: number | null;
  stage: StageDbRow | null | undefined;
  machineInterest: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function nullableNumberField(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nullableBooleanField(row: Record<string, unknown>, key: string): boolean | null {
  const value = row[key];
  return typeof value === "boolean" ? value : null;
}

function normalizeMood(value: unknown): Mood | null {
  return value === "positive" || value === "mixed" || value === "negative" ? value : null;
}

export function normalizeMoveDbRow(payload: unknown): MoveDbRow | null {
  if (!isRecord(payload)) return null;
  const id = stringField(payload, "id");
  const moveText = stringField(payload, "move_text");
  const createdAt = stringField(payload, "created_at");
  if (!id || !moveText || !createdAt) return null;

  return {
    id,
    move_text: moveText,
    mood: normalizeMood(payload.mood),
    velocity_delta: nullableNumberField(payload, "velocity_delta"),
    created_at: createdAt,
    user_id: nullableStringField(payload, "user_id"),
    deal_id: nullableStringField(payload, "deal_id"),
  };
}

export function normalizeProfileDbRow(payload: unknown): ProfileDbRow | null {
  if (!isRecord(payload)) return null;
  const id = stringField(payload, "id");
  if (!id) return null;
  return {
    id,
    full_name: nullableStringField(payload, "full_name"),
    created_at: nullableStringField(payload, "created_at"),
  };
}

export function normalizeDealDbRow(payload: unknown): DealDbRow | null {
  if (!isRecord(payload)) return null;
  const id = stringField(payload, "id");
  if (!id) return null;
  return {
    id,
    name: nullableStringField(payload, "name"),
    amount: nullableNumberField(payload, "amount"),
    stage_id: nullableStringField(payload, "stage_id"),
  };
}

export function normalizeStageDbRow(payload: unknown): StageDbRow | null {
  if (!isRecord(payload)) return null;
  const id = stringField(payload, "id");
  if (!id) return null;
  return {
    id,
    is_closed_won: nullableBooleanField(payload, "is_closed_won"),
    is_closed_lost: nullableBooleanField(payload, "is_closed_lost"),
  };
}

export function normalizeNeedsAssessmentDbRow(payload: unknown): NeedsAssessmentDbRow | null {
  if (!isRecord(payload)) return null;
  const dealId = stringField(payload, "deal_id");
  if (!dealId) return null;
  return {
    deal_id: dealId,
    machine_interest: nullableStringField(payload, "machine_interest"),
  };
}

function normalizeRows<T>(rows: unknown, normalize: (row: unknown) => T | null): T[] {
  return Array.isArray(rows) ? rows.map(normalize).filter((row): row is T => row !== null) : [];
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
  const moves = normalizeRows(moveData, normalizeMoveDbRow);
  if (moves.length === 0) return [];

  const userIds = Array.from(
    new Set(moves.map((m) => m.user_id).filter((v): v is string => !!v)),
  );
  const dealIds = Array.from(
    new Set(moves.map((m) => m.deal_id).filter((v): v is string => !!v)),
  );

  const [profilesResult, dealsResult] = await Promise.all([
    userIds.length > 0
      ? supabase.from("profiles").select("id, full_name, created_at").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    dealIds.length > 0
      ? supabase
          .from("crm_deals")
          .select("id, name, amount, stage_id")
          .in("id", dealIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const profiles = profilesResult.error
    ? []
    : normalizeRows(profilesResult.data, normalizeProfileDbRow);
  const deals = dealsResult.error ? [] : normalizeRows(dealsResult.data, normalizeDealDbRow);

  const stageIds = Array.from(
    new Set(deals.map((d) => d.stage_id).filter((v): v is string => !!v)),
  );

  // needs_assessments has a `deal_id` FK, not the other way around, so we
  // pull assessments by deal_id and key the resulting map the same way.
  // When a deal has multiple assessments we keep the first one — order
  // doesn't matter for cohort classification; any recent signal is fine.
  const [stageResult, assessmentResult] = await Promise.all([
    stageIds.length > 0
      ? supabase
          .from("crm_deal_stages")
          .select("id, is_closed_won, is_closed_lost")
          .in("id", stageIds)
      : Promise.resolve({ data: [], error: null }),
    dealIds.length > 0
      ? supabase
          .from("needs_assessments")
          .select("deal_id, machine_interest")
          .in("deal_id", dealIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const stages = stageResult.error ? [] : normalizeRows(stageResult.data, normalizeStageDbRow);
  const assessments = assessmentResult.error
    ? []
    : normalizeRows(assessmentResult.data, normalizeNeedsAssessmentDbRow);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const assessmentByDealId = new Map<string, NeedsAssessmentDbRow>();
  for (const a of assessments) {
    // Keep the first assessment per deal; skip later ones so the map
    // stays stable across reruns.
    if (!assessmentByDealId.has(a.deal_id)) assessmentByDealId.set(a.deal_id, a);
  }
  const dealById = new Map<string, DealView>(
    deals.map((d) => [
      d.id,
      {
        name: d.name,
        amount: d.amount,
        stage: d.stage_id ? stageById.get(d.stage_id) ?? null : null,
        machineInterest: assessmentByDealId.get(d.id)?.machine_interest ?? null,
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
      mood: row.mood,
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
