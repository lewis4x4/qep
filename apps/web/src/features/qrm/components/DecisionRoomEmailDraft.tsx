/**
 * DecisionRoomEmailDraft — generate a seat-targeted email from the drawer.
 * Rep types an optional goal ("address install-window concern"), clicks
 * draft, gets a ready-to-send subject + body back grounded on the seat's
 * evidence. Copy + mailto actions live on the result.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, Loader2, Mail, PenLine, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { DecisionRoomSeat } from "../lib/decision-room-simulator";

interface Props {
  seat: DecisionRoomSeat;
  dealId: string;
  dealName: string | null;
  companyName: string | null;
  repName: string | null;
}

interface DraftResult {
  subject: string;
  body: string;
  recipientEmail: string | null;
}

async function draftEmail(input: {
  seat: DecisionRoomSeat;
  dealId: string;
  dealName: string | null;
  companyName: string | null;
  repName: string | null;
  goal: string | null;
}): Promise<DraftResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-draft-email`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        dealId: input.dealId,
        seatId: input.seat.id,
        archetype: input.seat.archetype,
        seatName: input.seat.name,
        seatTitle: input.seat.title,
        seatEmail: input.seat.email,
        repName: input.repName,
        goal: input.goal,
        companyName: input.companyName,
        dealName: input.dealName,
        evidence: input.seat.evidence.map((e) => e.label),
      }),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `draft-email returned ${res.status}`);
  return {
    subject: payload.subject as string,
    body: payload.body as string,
    recipientEmail: (payload.recipientEmail as string | null) ?? null,
  };
}

export function DecisionRoomEmailDraft({ seat, dealId, dealName, companyName, repName }: Props) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      draftEmail({
        seat,
        dealId,
        dealName,
        companyName,
        repName,
        goal: goal.trim() ? goal.trim() : null,
      }),
  });

  async function handleCopy() {
    if (!mutation.data) return;
    const text = `Subject: ${mutation.data.subject}\n\n${mutation.data.body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Email draft copied to clipboard." });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select and copy manually.",
        variant: "destructive",
      });
    }
  }

  function buildMailto(): string | null {
    if (!mutation.data) return null;
    const to = mutation.data.recipientEmail ?? seat.email ?? "";
    const subject = encodeURIComponent(mutation.data.subject);
    const body = encodeURIComponent(mutation.data.body);
    return `mailto:${to}?subject=${subject}&body=${body}`;
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <PenLine className="h-3.5 w-3.5" />
        Draft an email to this seat
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-qep-deck-rule bg-qep-deck-elevated/40 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Email draft
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
          Goal (optional)
        </label>
        <Input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. surface concerns about install timing"
          maxLength={400}
          disabled={mutation.isPending}
        />
      </div>

      <Button
        type="button"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="gap-1.5"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Drafting…
          </>
        ) : (
          <>
            <Mail className="h-3.5 w-3.5" />
            {mutation.data ? "Redraft" : "Draft email"}
          </>
        )}
      </Button>

      {mutation.error ? (
        <div role="alert" className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200">
          {(mutation.error as Error).message}
        </div>
      ) : null}

      {mutation.data ? (
        <div className="space-y-2">
          <div className="rounded-md border border-qep-deck-rule bg-black/30 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Subject
            </p>
            <p className="text-sm font-medium text-foreground">{mutation.data.subject}</p>
          </div>
          <div className="rounded-md border border-qep-deck-rule bg-black/30 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Body
            </p>
            <p className="whitespace-pre-wrap text-sm text-foreground/90">{mutation.data.body}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            {seat.email || mutation.data.recipientEmail ? (
              <a
                href={buildMailto() ?? "#"}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md border border-qep-orange/40 bg-qep-orange/10 px-3 text-sm font-medium text-qep-orange",
                  "hover:bg-qep-orange/20",
                )}
              >
                <Send className="h-3.5 w-3.5" />
                Open in mail client
              </a>
            ) : (
              <span className="text-[11px] italic text-muted-foreground">
                No email on file for this seat — copy and paste into your mail client.
              </span>
            )}
          </div>
          <p className="text-[10px] italic text-muted-foreground">
            Grounded on this seat's evidence. Review before sending — the rep's voice is yours, not the model's.
          </p>
        </div>
      ) : null}
    </div>
  );
}
