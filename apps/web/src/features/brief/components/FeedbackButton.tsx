/**
 * Floating "Got feedback?" button + modal for the Stakeholder Build Hub.
 *
 * Anchored bottom-right across every /brief route. Opens a minimal dialog
 * with a textarea, a type picker, and a submit that calls
 * `hub-feedback-intake`. Voice/screenshot capture arrives in a later slice.
 *
 * Non-trapping submit policy: Escape and close always work, even while the
 * request is in flight. The mutation continues in the background so the
 * stakeholder never stares at a spinner they can't escape. The textarea
 * contents are persisted to localStorage on close so an accidental dismiss
 * doesn't throw away typed content.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { MessageCirclePlus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { submitHubFeedback, type FeedbackType } from "../lib/brief-api";

const TYPE_OPTIONS: { value: FeedbackType; label: string; hint: string }[] = [
  { value: "bug", label: "Bug", hint: "Something is broken" },
  { value: "suggestion", label: "Suggestion", hint: "Idea or improvement" },
  { value: "question", label: "Question", hint: "Needs an answer" },
  { value: "approval", label: "Approval", hint: "Looks good / confirming" },
  { value: "concern", label: "Concern", hint: "Worried about something" },
];

const DRAFT_STORAGE_KEY = "hub:feedback-draft";

interface DraftShape {
  body: string;
  type: FeedbackType | "";
}

function readDraft(): DraftShape {
  if (typeof window === "undefined") return { body: "", type: "" };
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return { body: "", type: "" };
    const parsed = JSON.parse(raw) as Partial<DraftShape>;
    return {
      body: typeof parsed.body === "string" ? parsed.body : "",
      type:
        parsed.type === "bug" ||
        parsed.type === "suggestion" ||
        parsed.type === "question" ||
        parsed.type === "approval" ||
        parsed.type === "concern"
          ? parsed.type
          : "",
    };
  } catch {
    return { body: "", type: "" };
  }
}

function writeDraft(draft: DraftShape): void {
  if (typeof window === "undefined") return;
  try {
    if (!draft.body && !draft.type) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // quota / private mode — silent fallback is fine
  }
}

interface FeedbackButtonProps {
  buildItemId?: string | null;
}

export function FeedbackButton({ buildItemId }: FeedbackButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [type, setType] = useState<FeedbackType | "">("");
  const [submitting, setSubmitting] = useState(false);

  // Track whether a submit completed cleanly — if so, don't save its body
  // back to localStorage when the modal unmounts / closes.
  const submittedCleanlyRef = useRef(false);

  // Load any saved draft exactly once when the modal opens for the first time.
  useEffect(() => {
    if (!open) return;
    const draft = readDraft();
    if (draft.body || draft.type) {
      setBody((prev) => (prev ? prev : draft.body));
      setType((prev) => (prev ? prev : draft.type));
    }
  }, [open]);

  // Persist draft whenever body/type change, debounced by React's batching.
  useEffect(() => {
    if (submittedCleanlyRef.current) return;
    writeDraft({ body, type });
  }, [body, type]);

  const onChipClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const value = event.currentTarget.dataset.value as FeedbackType | undefined;
    if (!value) return;
    setType((prev) => (prev === value ? "" : value));
  }, []);

  const onOpenChange = useCallback((next: boolean) => {
    // Non-trapping: allow close even mid-submit. The mutation keeps running;
    // a toast still fires when it resolves.
    setOpen(next);
  }, []);

  const onCancel = useCallback(() => {
    setOpen(false);
  }, []);

  const onSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const result = await submitHubFeedback({
        body: trimmed,
        feedback_type: type || undefined,
        build_item_id: buildItemId ?? undefined,
      });
      toast({
        title: "Thanks — Claude triaged it.",
        description: result.feedback.ai_summary ?? "Brian will see this next.",
      });
      submittedCleanlyRef.current = true;
      writeDraft({ body: "", type: "" });
      setBody("");
      setType("");
      setOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't send that",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
      // Reset the clean-submit flag so the next attempt persists again.
      submittedCleanlyRef.current = false;
    }
  }, [body, type, buildItemId, toast]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex min-h-11 min-w-11 items-center gap-2 rounded-full bg-slate-900 px-5 py-3.5 text-sm font-medium text-white shadow-lg shadow-slate-900/25 transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:bottom-8 sm:right-8"
        aria-label="Send feedback"
      >
        <MessageCirclePlus className="h-4 w-4" aria-hidden />
        Got feedback?
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Claude will triage this in about a second. You'll hear back via
              the Build Hub (and email if it's urgent).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              What's on your mind?
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type what you noticed. Short is fine."
              rows={5}
              maxLength={4000}
              disabled={submitting}
              className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:opacity-60"
            />

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Type (optional — Claude will infer)
              </div>
              <div className="flex flex-wrap gap-2">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-value={opt.value}
                    onClick={onChipClick}
                    disabled={submitting}
                    aria-pressed={type === opt.value}
                    className={`min-h-9 rounded-full border px-4 py-2 text-xs transition ${
                      type === opt.value
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
                    }`}
                    title={opt.hint}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={submitting || !body.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Sending…
                </>
              ) : (
                "Send"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
