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

function rowToMove(row: DbRow): TriedMove {
  const aggregate = (row.aggregate ?? {}) as Record<string, unknown>;
  const reactions = Array.isArray(row.reactions) ? (row.reactions as MoveReaction[]) : [];
  const mood = (row.mood as "positive" | "negative" | "mixed" | null) ?? "mixed";
  return {
    moveId: row.id,
    move: row.move_text,
    reactions,
    aggregate: {
      velocityDelta: row.velocity_delta ?? (typeof aggregate.velocityDelta === "number" ? aggregate.velocityDelta : 0),
      mood: mood ?? "mixed",
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
    return parsed.slice(0, MOVE_HISTORY_MAX_ENTRIES) as TriedMove[];
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
  return (data ?? []).map((row) => rowToMove(row as DbRow));
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
