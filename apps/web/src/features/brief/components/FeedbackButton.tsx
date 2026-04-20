/**
 * Floating "Got feedback?" button + modal for the Stakeholder Build Hub.
 *
 * Anchored bottom-right across every /brief route. Opens a minimal dialog
 * with a textarea, a type picker, and a submit that calls
 * `hub-feedback-intake`. Voice/screenshot capture arrives in a later slice.
 */
import { useState } from "react";
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

interface FeedbackButtonProps {
  buildItemId?: string | null;
}

export function FeedbackButton({ buildItemId }: FeedbackButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [type, setType] = useState<FeedbackType | "">("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
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
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-slate-900/25 transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:bottom-8 sm:right-8"
        aria-label="Send feedback"
      >
        <MessageCirclePlus className="h-4 w-4" aria-hidden />
        Got feedback?
      </button>

      <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
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
                    onClick={() => setType(type === opt.value ? "" : opt.value)}
                    disabled={submitting}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
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
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
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
