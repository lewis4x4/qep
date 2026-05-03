/**
 * DecisionRoomCompetitorCounter — a small popover-ish panel that shows
 * three counter-positioning lines for a named competitor. Fetched on
 * demand from decision-room-competitor-counter; cached 24h by workspace
 * + competitor on the server so repeat clicks are free.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, ShieldAlert, Swords, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface Props {
  dealId: string;
  competitor: string;
  companyName: string | null;
  lossReasonHint: string | null;
}

interface Packet {
  headline: string;
  counters: string[];
  watchOuts: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function payloadError(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function normalizePacket(value: unknown): Packet | null {
  if (!isRecord(value) || typeof value.headline !== "string") return null;
  return {
    headline: value.headline,
    counters: stringArray(value.counters),
    watchOuts: stringArray(value.watchOuts),
  };
}

async function fetchCounter(input: {
  dealId: string;
  competitor: string;
  companyName: string | null;
  lossReasonHint: string | null;
}): Promise<{ packet: Packet; source: "cache" | "fresh" }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-competitor-counter`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(input),
    },
  );
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payloadError(payload) ?? `counter returned ${res.status}`);
  if (!isRecord(payload)) throw new Error("empty counter packet");
  const packet = normalizePacket(payload.packet);
  if (!packet) throw new Error("empty counter packet");
  return { packet, source: payload.source === "cache" ? "cache" : "fresh" };
}

export function DecisionRoomCompetitorCounter({ dealId, competitor, companyName, lossReasonHint }: Props) {
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => fetchCounter({ dealId, competitor, companyName, lossReasonHint }),
  });

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
          if (!mutation.data) mutation.mutate();
        }}
        className="h-6 gap-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-amber-200 hover:bg-amber-400/10"
      >
        <Swords className="h-3 w-3" />
        Counter
      </Button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-400/30 bg-black/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
          <Swords className="h-3 w-3" />
          Counter {competitor}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      {mutation.isPending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="h-3 w-3 animate-spin" />
          Building counter-positioning…
        </p>
      ) : mutation.error ? (
        <div role="alert" className="rounded-md border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200">
          {errorMessage(mutation.error)}
          <button
            type="button"
            onClick={() => mutation.mutate()}
            className="ml-2 underline"
          >
            Retry
          </button>
        </div>
      ) : mutation.data ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-amber-400/20 bg-amber-400/[0.05] p-2">
            <Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
            <p className="text-xs text-foreground/90">{mutation.data.packet.headline}</p>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Counter angles
            </p>
            <ul className="space-y-1">
              {mutation.data.packet.counters.map((line, i) => (
                <li key={i} className={cn("flex gap-1.5 text-xs text-foreground/90")}>
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] text-emerald-300">{i + 1}.</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          {mutation.data.packet.watchOuts.length > 0 ? (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldAlert className="h-3 w-3" />
                Watch-outs
              </p>
              <ul className="space-y-1">
                {mutation.data.packet.watchOuts.map((line, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-foreground/80">
                    <span className="mt-0.5 shrink-0 text-red-300">›</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-[10px] italic text-muted-foreground">
            Generic competitive dynamics — pressure-test against your account's specific history before using verbatim.
          </p>
        </div>
      ) : null}
    </div>
  );
}
