/**
 * DecisionRoomMoveBar — the Try-a-move input. The rep types a proposed
 * move; the bar POSTs to decision-room-try-move, the edge function fans
 * out persona reactions, and the page lifts the result up to render
 * reaction chips + scoreboard deltas + a growing move history.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, PlayCircle, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { DeckSurface } from "./command-deck";
import type { DecisionRoomBoard } from "../lib/decision-room-simulator";
import { normalizeTriedMove } from "../lib/decision-room-moves-persist";

export interface TriedMove {
  moveId: string;
  move: string;
  reactions: MoveReaction[];
  aggregate: {
    velocityDelta: number;
    mood: "positive" | "mixed" | "negative";
    summary: string;
  };
  generatedAt: string;
}

export interface MoveReaction {
  seatId: string;
  sentiment: "positive" | "neutral" | "negative";
  concern: string;
  likelyNext: string;
  confidence: "high" | "medium" | "low";
}

interface Props {
  board: DecisionRoomBoard;
  onMoveResult: (move: TriedMove) => void;
  prefill: string | null;
  onPrefillConsumed: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadError(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : isRecord(error) && error.name === "AbortError";
}

async function runTryMove(
  board: DecisionRoomBoard,
  move: string,
  signal: AbortSignal,
): Promise<TriedMove> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-try-move`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        dealId: board.dealId,
        move,
        companyName: board.companyName,
        dealName: board.dealName,
        seats: board.seats.map((s) => ({
          seatId: s.id,
          archetype: s.archetype,
          status: s.status,
          name: s.name,
          title: s.title,
          powerWeight: s.powerWeight,
          evidence: s.evidence.map((e) => e.label).slice(0, 10),
        })),
      }),
      signal,
    },
  );
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payloadError(payload) ?? `try-move returned ${res.status}`);
  const triedMove = normalizeTriedMove(payload);
  if (!triedMove || triedMove.reactions.length === 0) {
    throw new Error("try-move returned no reactions");
  }
  return triedMove;
}

export function DecisionRoomMoveBar({ board, onMoveResult, prefill, onPrefillConsumed }: Props) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Consume prefill from a Recommended-Moves card click.
  useEffect(() => {
    if (prefill) {
      setValue(prefill);
      onPrefillConsumed();
      inputRef.current?.focus();
    }
  }, [prefill, onPrefillConsumed]);

  useEffect(() => {
    return () => {
      inFlightRef.current?.abort();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const move = value.trim();
    if (!move || pending) return;

    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    setPending(true);
    setError(null);
    try {
      const result = await runTryMove(board, move, controller.signal);
      if (controller.signal.aborted) return;
      onMoveResult(result);
      setValue("");
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "Something went wrong running this move.");
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
      }
      setPending(false);
    }
  }

  function handleCancel() {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    setPending(false);
  }

  return (
    <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <PlayCircle className="h-4 w-4 text-qep-live" aria-hidden />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Try a move
        </h2>
        <span className="text-[10px] text-muted-foreground/70">
          Every seat reacts in parallel — grounded on their evidence, not generic.
        </span>
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. offer a 90-day deferred payment and a free maintenance plan for year one"
          maxLength={500}
          disabled={pending}
          aria-label="Propose a move to run against the decision room"
          className="flex-1"
        />
        {pending ? (
          <Button type="button" variant="outline" size="sm" onClick={handleCancel} className="gap-1.5">
            <XCircle className="h-3.5 w-3.5" />
            Cancel
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={!value.trim()} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Run
          </Button>
        )}
      </form>
      {pending ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="h-3 w-3 animate-spin" />
          Simulating {board.seats.length} seat{board.seats.length === 1 ? "" : "s"}…
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className={cn(
            "mt-2 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-200",
          )}
        >
          {error}
        </p>
      ) : null}
    </DeckSurface>
  );
}
