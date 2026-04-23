/**
 * DecisionRoomDialogue — from a seat drawer, pick another seat in the
 * room and watch the two of them argue about the deal. Each speaker
 * stays grounded on their own evidence packet (the edge function
 * enforces this). The output is a short transcript with a one-line
 * read at the bottom on where the room lands.
 *
 * UX: the rep picks a counterparty from a dropdown of every OTHER seat
 * in the room (named or ghost). Optional topic input anchors the
 * conversation. One click runs it.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, MessagesSquare, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { DecisionRoomSeat } from "../lib/decision-room-simulator";

interface Props {
  seat: DecisionRoomSeat;
  otherSeats: DecisionRoomSeat[];
  dealId: string;
  companyName: string | null;
  dealName: string | null;
}

interface DialogueTurn {
  speaker: "A" | "B";
  text: string;
}

interface DialogueResult {
  turns: DialogueTurn[];
  summary: string;
}

function seatLabel(s: DecisionRoomSeat): string {
  if (s.name) return `${s.name}${s.title ? ` (${s.title})` : ""}`;
  return `Probable ${s.archetypeLabel}`;
}

async function runDialogue(input: {
  seatA: DecisionRoomSeat;
  seatB: DecisionRoomSeat;
  dealId: string;
  companyName: string | null;
  dealName: string | null;
  topic: string | null;
}): Promise<DialogueResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-seat-dialogue`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        dealId: input.dealId,
        companyName: input.companyName,
        dealName: input.dealName,
        topic: input.topic,
        seatA: {
          seatId: input.seatA.id,
          archetype: input.seatA.archetype,
          name: input.seatA.name,
          title: input.seatA.title,
          evidence: input.seatA.evidence.map((e) => e.label).slice(0, 12),
        },
        seatB: {
          seatId: input.seatB.id,
          archetype: input.seatB.archetype,
          name: input.seatB.name,
          title: input.seatB.title,
          evidence: input.seatB.evidence.map((e) => e.label).slice(0, 12),
        },
      }),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `dialogue returned ${res.status}`);
  if (!Array.isArray(payload.turns) || payload.turns.length === 0) {
    throw new Error("dialogue returned no turns");
  }
  return { turns: payload.turns as DialogueTurn[], summary: payload.summary ?? "" };
}

export function DecisionRoomDialogue({ seat, otherSeats, dealId, companyName, dealName }: Props) {
  const [open, setOpen] = useState(false);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");

  const partner = otherSeats.find((s) => s.id === partnerId) ?? null;

  const mutation = useMutation({
    mutationFn: () => {
      if (!partner) throw new Error("Pick another seat first");
      return runDialogue({
        seatA: seat,
        seatB: partner,
        dealId,
        companyName,
        dealName,
        topic: topic.trim() ? topic.trim() : null,
      });
    },
  });

  if (otherSeats.length === 0) return null;

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <MessagesSquare className="h-3.5 w-3.5" />
        Simulate a conversation with another seat
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-qep-deck-rule bg-qep-deck-elevated/40 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-qep-live" />
          Simulate a conversation
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="space-y-2">
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
          Have {seat.name ?? seat.archetypeLabel} talk to:
        </label>
        <select
          value={partnerId ?? ""}
          onChange={(e) => setPartnerId(e.target.value || null)}
          className="h-9 w-full rounded-md border border-qep-deck-rule bg-black/30 px-3 text-sm text-foreground"
        >
          <option value="" disabled>
            Pick another seat…
          </option>
          {otherSeats.map((s) => (
            <option key={s.id} value={s.id}>
              {seatLabel(s)}
              {s.status === "ghost" ? " · ghost" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
          Topic (optional)
        </label>
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. the install window, or the payment terms"
          maxLength={280}
          disabled={mutation.isPending}
        />
      </div>

      <Button
        type="button"
        size="sm"
        disabled={!partner || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="gap-1.5"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Simulating…
          </>
        ) : (
          <>
            <MessagesSquare className="h-3.5 w-3.5" />
            Run dialogue
          </>
        )}
      </Button>

      {mutation.error ? (
        <div role="alert" className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200">
          {(mutation.error as Error).message}
        </div>
      ) : null}

      {mutation.data && partner ? (
        <div className="space-y-2" aria-live="polite">
          <ol className="space-y-2">
            {mutation.data.turns.map((turn, i) => {
              const isA = turn.speaker === "A";
              const speaker = isA ? seat : partner;
              return (
                <li
                  key={i}
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    isA
                      ? "border-qep-orange/30 bg-qep-orange/[0.06]"
                      : "border-white/15 bg-white/[0.03]",
                  )}
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {speaker.name ?? `Probable ${speaker.archetypeLabel}`}
                    {speaker.title ? <span className="normal-case tracking-normal"> · {speaker.title}</span> : null}
                  </p>
                  <p className="text-foreground/95">{turn.text}</p>
                </li>
              );
            })}
          </ol>
          {mutation.data.summary ? (
            <div className="rounded-md border border-qep-live/30 bg-qep-live/[0.06] p-3 text-xs text-foreground/90">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-live">
                Where the room lands
              </span>
              <span>{mutation.data.summary}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
