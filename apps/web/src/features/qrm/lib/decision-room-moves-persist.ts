/**
 * Decision Room — move history persistence.
 *
 * Reads and writes from public.decision_room_moves. RLS keeps queries
 * workspace-scoped; each row carries the user_id of the rep who ran
 * the simulation so managers can later audit-trace moves per rep.
 *
 * The frontend still keeps a localStorage cache for instant load on
 * page mount, but the DB is authoritative — the page hydrates from
 * localStorage immediately, then overlays the DB query result when it
 * arrives (React Query dedupes, so the UI never flashes).
 */
import { supabase } from "@/lib/supabase";
import type { TriedMove, MoveReaction } from "../components/DecisionRoomMoveBar";

const MOVE_HISTORY_STORAGE_VERSION = 2;
const MOVE_HISTORY_MAX_ENTRIES = 20;

function storageKey(dealId: string): string {
  return `qep:decision-room:moves:v${MOVE_HISTORY_STORAGE_VERSION}:${dealId}`;
}

interface DbRow {
  id: string;
  deal_id: string;
  move_text: string;
  reactions: unknown;
  aggregate: unknown;
  velocity_delta: number | null;
  mood: string | null;
  generated_at: string;
  created_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeMood(value: unknown): TriedMove["aggregate"]["mood"] {
  return value === "positive" || value === "negative" || value === "mixed" ? value : "mixed";
}

function normalizeSentiment(value: unknown): MoveReaction["sentiment"] {
  return value === "positive" || value === "negative" || value === "neutral" ? value : "neutral";
}

function normalizeConfidence(value: unknown): MoveReaction["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

export function normalizeMoveReaction(payload: unknown): MoveReaction | null {
  if (!isRecord(payload)) return null;
  const seatId = stringField(payload, "seatId");
  const concern = stringField(payload, "concern");
  const likelyNext = stringField(payload, "likelyNext");
  if (!seatId || !concern || !likelyNext) return null;
  return {
    seatId,
    sentiment: normalizeSentiment(payload.sentiment),
    concern,
    likelyNext,
    confidence: normalizeConfidence(payload.confidence),
  };
}

export function normalizeTriedMove(payload: unknown): TriedMove | null {
  if (!isRecord(payload)) return null;
  const moveId = stringField(payload, "moveId");
  const move = stringField(payload, "move");
  const generatedAt = stringField(payload, "generatedAt");
  if (!moveId || !move || !generatedAt || !isRecord(payload.aggregate)) return null;

  return {
    moveId,
    move,
    reactions: Array.isArray(payload.reactions)
      ? payload.reactions
          .map(normalizeMoveReaction)
          .filter((reaction): reaction is MoveReaction => reaction !== null)
      : [],
    aggregate: {
      velocityDelta: numberField(payload.aggregate.velocityDelta) ?? 0,
      mood: normalizeMood(payload.aggregate.mood),
      summary: typeof payload.aggregate.summary === "string" ? payload.aggregate.summary : "",
    },
    generatedAt,
  };
}

export function normalizeMoveDbRow(payload: unknown): DbRow | null {
  if (!isRecord(payload)) return null;
  const id = stringField(payload, "id");
  const dealId = stringField(payload, "deal_id");
  const moveText = stringField(payload, "move_text");
  const generatedAt = stringField(payload, "generated_at");
  const createdAt = stringField(payload, "created_at");
  if (!id || !dealId || !moveText || !generatedAt || !createdAt) return null;
  return {
    id,
    deal_id: dealId,
    move_text: moveText,
    reactions: payload.reactions,
    aggregate: payload.aggregate,
    velocity_delta: numberField(payload.velocity_delta),
    mood: typeof payload.mood === "string" ? payload.mood : null,
    generated_at: generatedAt,
    created_at: createdAt,
  };
}

export function rowToMove(row: DbRow): TriedMove {
  const aggregate = isRecord(row.aggregate) ? row.aggregate : {};
  const reactions = Array.isArray(row.reactions)
    ? row.reactions
        .map(normalizeMoveReaction)
        .filter((reaction): reaction is MoveReaction => reaction !== null)
    : [];
  const mood = normalizeMood(row.mood);
  return {
    moveId: row.id,
    move: row.move_text,
    reactions,
    aggregate: {
      velocityDelta: row.velocity_delta ?? numberField(aggregate.velocityDelta) ?? 0,
      mood,
      summary: typeof aggregate.summary === "string" ? aggregate.summary : "",
    },
    generatedAt: row.generated_at,
  };
}

export function loadMoveHistoryFromStorage(dealId: string): TriedMove[] {
  try {
    const raw = localStorage.getItem(storageKey(dealId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeTriedMove)
      .filter((move): move is TriedMove => move !== null)
      .slice(0, MOVE_HISTORY_MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function persistMoveHistoryToStorage(dealId: string, history: TriedMove[]): void {
  try {
    localStorage.setItem(
      storageKey(dealId),
      JSON.stringify(history.slice(0, MOVE_HISTORY_MAX_ENTRIES)),
    );
  } catch {
    // Out-of-quota or private-mode — ignore silently.
  }
}

export async function loadMoveHistoryFromDb(dealId: string): Promise<TriedMove[]> {
  const { data, error } = await supabase
    .from("decision_room_moves")
    .select("id, deal_id, move_text, reactions, aggregate, velocity_delta, mood, generated_at, created_at")
    .eq("deal_id", dealId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MOVE_HISTORY_MAX_ENTRIES);
  if (error) throw error;
  return Array.isArray(data)
    ? data
        .map(normalizeMoveDbRow)
        .filter((row): row is DbRow => row !== null)
        .map(rowToMove)
    : [];
}

export async function insertMoveToDb(dealId: string, move: TriedMove): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("decision_room_moves").insert({
    deal_id: dealId,
    user_id: user.id,
    move_text: move.move,
    reactions: move.reactions,
    aggregate: move.aggregate,
    velocity_delta: move.aggregate.velocityDelta,
    mood: move.aggregate.mood,
    generated_at: move.generatedAt,
  });
  if (error) throw error;
}
