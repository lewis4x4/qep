/**
 * DecisionRoomEmailDraft — generate a seat-targeted email from the drawer.
 * Rep types an optional goal ("address install-window concern"), clicks
 * draft, gets a gated subject + body back grounded on the seat's evidence.
 * Copy + mailto actions require a human edit before use.
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

interface VoiceComplianceGate {
  required: boolean;
  status: string;
  policy?: string;
}

interface DraftResult {
  subject: string;
  body: string;
  recipientEmail: string | null;
  voiceCompliance: VoiceComplianceGate | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadError(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function normalizeVoiceCompliance(value: unknown): VoiceComplianceGate | null {
  if (!isRecord(value)) return null;
  return {
    required: value.required === true,
    status: typeof value.status === "string" ? value.status : "requires_human_edit",
    policy: typeof value.policy === "string" ? value.policy : undefined,
  };
}

function normalizeDraftResult(payload: unknown): DraftResult | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.subject !== "string" || typeof payload.body !== "string") return null;
  return {
    subject: payload.subject,
    body: payload.body,
    recipientEmail: typeof payload.recipientEmail === "string" ? payload.recipientEmail : null,
    voiceCompliance: normalizeVoiceCompliance(payload.voice_compliance ?? payload.voiceCompliance),
  };
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
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payloadError(payload) ?? `draft-email returned ${res.status}`);
  const draft = normalizeDraftResult(payload);
  if (!draft) throw new Error("draft-email returned an invalid draft");
  return draft;
}

export function DecisionRoomEmailDraft({ seat, dealId, dealName, companyName, repName }: Props) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
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
    onSuccess: (draft) => {
      setEditedSubject(draft.subject);
      setEditedBody(draft.body);
    },
  });

  const humanEditComplete = mutation.data
    ? editedSubject.trim() !== mutation.data.subject.trim() || editedBody.trim() !== mutation.data.body.trim()
    : false;
  const voiceGateRequired = mutation.data?.voiceCompliance?.required !== false;
  const voiceGateSatisfied = mutation.data?.voiceCompliance?.status === "email_voice_passed" ||
    mutation.data?.voiceCompliance?.status === "human_edited";
  const actionsAllowed = Boolean(mutation.data) && (!voiceGateRequired || voiceGateSatisfied || humanEditComplete);

  async function handleCopy() {
    if (!mutation.data) return;
    if (!actionsAllowed) {
      toast({
        title: "Edit required",
        description: "E2.2 voice gate requires a human edit before copying this generated draft.",
        variant: "destructive",
      });
      return;
    }
    const text = `Subject: ${editedSubject}\n\n${editedBody}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Edited email draft copied to clipboard." });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select and copy manually.",
        variant: "destructive",
      });
    }
  }

  function buildMailto(): string | null {
    if (!mutation.data || !actionsAllowed) return null;
    const to = mutation.data.recipientEmail ?? seat.email ?? "";
    const subject = encodeURIComponent(editedSubject);
    const body = encodeURIComponent(editedBody);
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
          {errorMessage(mutation.error)}
        </div>
      ) : null}

      {mutation.data ? (
        <div className="space-y-2">
          <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-100">
            <p className="font-semibold">E2.2 voice gate: human edit required</p>
            <p className="mt-1">
              Edit this generated draft before copy/send, or run an email-voice pass outside this repo.
              Status: {mutation.data.voiceCompliance?.status ?? "requires_human_edit"}.
            </p>
          </div>

          <div className="rounded-md border border-qep-deck-rule bg-black/30 p-3">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Subject
            </label>
            <Input
              value={editedSubject}
              onChange={(e) => setEditedSubject(e.target.value)}
              aria-label="Editable email subject"
            />
          </div>
          <div className="rounded-md border border-qep-deck-rule bg-black/30 p-3">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Body
            </label>
            <textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              aria-label="Editable email body"
              rows={8}
              className={cn(
                "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCopy}
              disabled={!actionsAllowed}
              className="gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy edited draft
            </Button>
            {seat.email || mutation.data.recipientEmail ? (
              <a
                href={buildMailto() ?? "#"}
                aria-disabled={!actionsAllowed}
                onClick={(event) => {
                  if (!actionsAllowed) event.preventDefault();
                }}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md border border-qep-orange/40 bg-qep-orange/10 px-3 text-sm font-medium text-qep-orange",
                  actionsAllowed ? "hover:bg-qep-orange/20" : "pointer-events-none cursor-not-allowed opacity-50",
                )}
              >
                <Send className="h-3.5 w-3.5" />
                Open edited draft in mail client
              </a>
            ) : (
              <span className="text-[11px] italic text-muted-foreground">
                No email on file for this seat — copy and paste into your mail client after editing.
              </span>
            )}
          </div>
          {!actionsAllowed ? (
            <p className="text-[10px] font-medium text-amber-200">
              Copy and mail client actions unlock after you change the generated subject or body.
            </p>
          ) : voiceGateSatisfied ? (
            <p className="text-[10px] font-medium text-emerald-200">
              Email-voice gate already satisfied; copy/mailto uses the text shown here.
            </p>
          ) : null}
          <p className="text-[10px] italic text-muted-foreground">
            Grounded on this seat's evidence. The rep's voice is yours, not the model's.
          </p>
        </div>
      ) : null}
    </div>
  );
}
