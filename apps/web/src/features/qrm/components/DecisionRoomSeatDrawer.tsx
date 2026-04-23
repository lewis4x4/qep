/**
 * DecisionRoomSeatDrawer — per-seat detail + persona chat.
 *
 * Opens when a seat is clicked on the canvas. Shows role, evidence chain,
 * ghost-find guidance, and an "Ask this seat" input backed by a persona
 * agent. Grounds every persona response on the evidence list — no free
 * invention. The input is the Phase 2 beachhead: once try-a-move ships,
 * the same drawer will also show this seat's reaction to each proposed
 * move with a confidence + citation back to evidence.
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Send, Sparkles, UserPlus2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { DecisionRoomSeat } from "../lib/decision-room-simulator";

interface PersonaMessage {
  role: "rep" | "seat";
  content: string;
  at: string;
}

interface Props {
  seat: DecisionRoomSeat | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  companyName: string | null;
  dealName: string | null;
}

function evidenceKindLabel(kind: string): string {
  switch (kind) {
    case "activity": return "Activity";
    case "voice": return "Voice";
    case "signature": return "Signature";
    case "needs_assessment": return "Needs assessment";
    case "primary_contact": return "CRM";
    case "archetype_inference": return "Inference";
    case "stakeholder_mention": return "Mention";
    default: return "Evidence";
  }
}

function stanceBadge(seat: DecisionRoomSeat): { label: string; cls: string } {
  if (seat.status === "ghost") {
    return { label: "Ghost — not yet identified", cls: "border-white/20 bg-white/[0.04] text-white/70" };
  }
  switch (seat.stance) {
    case "champion":
      return { label: "Champion", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" };
    case "blocker":
      return { label: "Blocker", cls: "border-red-400/50 bg-red-500/10 text-red-200" };
    case "skeptical":
      return { label: "Skeptical", cls: "border-amber-400/40 bg-amber-400/10 text-amber-200" };
    case "neutral":
      return { label: "Neutral", cls: "border-qep-orange/40 bg-qep-orange/10 text-qep-orange" };
    default:
      return { label: "Stance unclear", cls: "border-white/20 bg-white/[0.04] text-white/70" };
  }
}

async function askSeatPersona(input: {
  dealId: string;
  seatId: string;
  archetype: string;
  seatName: string | null;
  seatTitle: string | null;
  question: string;
  companyName: string | null;
  dealName: string | null;
  evidence: string[];
}): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-seat-chat`,
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
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error ?? `seat chat returned ${res.status}`);
  }
  const text = typeof payload.reply === "string" ? payload.reply.trim() : "";
  if (!text) throw new Error("Empty persona response");
  return text;
}

export function DecisionRoomSeatDrawer({ seat, open, onOpenChange, dealId, companyName, dealName }: Props) {
  const [messages, setMessages] = useState<PersonaMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeatId = useRef<string | null>(null);

  // Reset chat when switching seats.
  useEffect(() => {
    if (seat && seat.id !== lastSeatId.current) {
      setMessages([]);
      setError(null);
      setQuestion("");
      lastSeatId.current = seat.id;
    }
  }, [seat]);

  if (!seat) return null;

  const stance = stanceBadge(seat);

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    if (!seat || !question.trim() || pending) return;
    const q = question.trim();
    const nowIso = new Date().toISOString();
    setPending(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "rep", content: q, at: nowIso }]);
    setQuestion("");

    try {
      const reply = await askSeatPersona({
        dealId,
        seatId: seat.id,
        archetype: seat.archetype,
        seatName: seat.name,
        seatTitle: seat.title,
        question: q,
        companyName,
        dealName,
        evidence: seat.evidence.map((e) => e.label),
      });
      setMessages((prev) => [...prev, { role: "seat", content: reply, at: new Date().toISOString() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong asking this seat.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[480px]">
        <SheetHeader className="space-y-2 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="truncate text-xl">
                {seat.name ?? <span className="italic text-muted-foreground">Unknown — probable {seat.archetypeLabel}</span>}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-medium text-foreground/80">{seat.archetypeLabel}</span>
                {seat.title ? <span className="text-muted-foreground">· {seat.title}</span> : null}
              </SheetDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge className={cn("border", stance.cls)}>{stance.label}</Badge>
            <Badge className="border border-white/10 bg-white/[0.04] text-white/70">
              Power {(seat.powerWeight * 100).toFixed(0)}%
            </Badge>
            <Badge className="border border-white/10 bg-white/[0.04] text-white/70">
              Veto weight {(seat.vetoWeight * 100).toFixed(0)}%
            </Badge>
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Contact info (named seats only) */}
          {seat.status === "named" && (seat.email || seat.phone) ? (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Contact
              </h3>
              <div className="space-y-1 text-sm">
                {seat.email ? (
                  <a
                    href={`mailto:${seat.email}`}
                    className="flex items-center gap-2 text-foreground hover:text-qep-orange"
                  >
                    <span className="truncate">{seat.email}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : null}
                {seat.phone ? (
                  <a
                    href={`tel:${seat.phone}`}
                    className="flex items-center gap-2 text-foreground hover:text-qep-orange"
                  >
                    <span>{seat.phone}</span>
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Ghost guidance */}
          {seat.status === "ghost" && seat.findGuidance ? (
            <section className="rounded-xl border border-qep-orange/30 bg-qep-orange/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-qep-orange">
                <UserPlus2 className="h-4 w-4" />
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                  Find this seat
                </h3>
              </div>
              <p className="text-sm text-foreground/90">{seat.findGuidance.reason}</p>
              <div className="mt-3 space-y-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Search: </span>
                  <code className="rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-foreground/90">
                    {seat.findGuidance.searchQuery}
                  </code>
                </div>
                {seat.findGuidance.emailHint ? (
                  <div>
                    <span className="text-muted-foreground">Email hint: </span>
                    <code className="rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-foreground/90">
                      {seat.findGuidance.emailHint}
                    </code>
                  </div>
                ) : null}
                <p className="text-muted-foreground">{seat.findGuidance.nextStep}</p>
              </div>
            </section>
          ) : null}

          {/* Evidence chain */}
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Evidence
            </h3>
            <ul className="space-y-2">
              {seat.evidence.map((item, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-qep-deck-rule bg-qep-deck-elevated/40 p-3 text-sm"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge className="border border-white/10 bg-white/[0.04] text-[10px] font-medium text-white/70">
                      {evidenceKindLabel(item.kind)}
                    </Badge>
                    {item.occurredAt ? (
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(item.occurredAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-foreground/90">{item.label}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* Ask this seat (persona chat) */}
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Sparkles className="h-3 w-3 text-qep-orange" />
              Ask this seat
            </h3>
            <p className="text-xs text-muted-foreground">
              Grounded persona response. Answers only from the evidence shown above — no invention.
            </p>

            {messages.length > 0 ? (
              <div className="mt-3 space-y-2">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border p-3 text-sm",
                      m.role === "rep"
                        ? "border-white/10 bg-white/[0.03] text-foreground/90"
                        : "border-qep-orange/30 bg-qep-orange/5 text-foreground",
                    )}
                  >
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {m.role === "rep" ? "You" : seat.name ?? `Probable ${seat.archetypeLabel}`}
                    </p>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {error ? (
              <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleAsk} className="mt-3 flex items-center gap-2">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  seat.archetype === "economic_buyer"
                    ? "e.g. What would you need to see to approve this this quarter?"
                    : seat.archetype === "operations"
                      ? "e.g. What's your biggest concern about the install window?"
                      : "e.g. What would move this forward for you?"
                }
                disabled={pending}
              />
              <Button type="submit" size="icon" disabled={pending || !question.trim()}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
