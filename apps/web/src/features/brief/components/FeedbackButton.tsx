/**
 * Floating "Got feedback?" button + modal for the Stakeholder Build Hub.
 *
 * Anchored bottom-right across every /brief route. Opens a minimal dialog
 * with a textarea, a type picker, press-and-hold voice capture, and a
 * submit that calls `hub-feedback-intake`.
 *
 * Build Hub v2.2:
 *   - VoiceCapture mounts above the textarea. On stop, the transcript is
 *     appended to whatever's already typed (so a user can type, then
 *     speak, then type more without stomping their earlier content).
 *   - Page context (path, title, build_item_id data-attr, screen size,
 *     dark mode, UA shorthand) is captured at submit time and passed to
 *     intake so Claude's triage summary references where the stakeholder
 *     was.
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
import {
  submitHubFeedback,
  type FeedbackType,
  type SubmissionContext,
} from "../lib/brief-api";
import { VoiceCapture, type VoiceCaptureResult } from "./VoiceCapture";

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

  // Voice capture side-channel: we don't inline audio path/duration into
  // the body, but we do forward them to the intake call so the DB row
  // records them alongside the typed body.
  const voiceStateRef = useRef<{
    audio_path: string | null;
    duration_ms: number | null;
    transcript: string | null;
  }>({ audio_path: null, duration_ms: null, transcript: null });

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

  const onVoiceTranscribed = useCallback((result: VoiceCaptureResult) => {
    // Keep the audio path + duration around to forward to the intake call.
    voiceStateRef.current = {
      audio_path: result.audio_path,
      duration_ms: result.duration_ms,
      transcript: result.transcript || null,
    };
    if (!result.transcript) return;
    // Append the transcript onto whatever the user has typed so they can
    // dictate + refine in the same session without losing prior text.
    setBody((prev) => {
      const joiner = prev.trim().length === 0 ? "" : prev.endsWith("\n") ? "" : "\n";
      return `${prev}${joiner}${result.transcript}`.slice(0, 4000);
    });
  }, []);

  const onSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const context = captureSubmissionContext(buildItemId);
      const voice = voiceStateRef.current;
      const result = await submitHubFeedback({
        body: trimmed,
        feedback_type: type || undefined,
        build_item_id: buildItemId ?? undefined,
        submission_context: context,
        voice_audio_url: voice.audio_path ?? undefined,
        voice_transcript: voice.transcript ?? undefined,
        voice_duration_ms: voice.duration_ms ?? undefined,
      });
      toast({
        title: "Thanks — Claude triaged it.",
        description: result.feedback.ai_summary ?? "Brian will see this next.",
      });
      submittedCleanlyRef.current = true;
      writeDraft({ body: "", type: "" });
      setBody("");
      setType("");
      voiceStateRef.current = { audio_path: null, duration_ms: null, transcript: null };
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
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              Type or hold the mic. Claude will triage in about a second —
              you'll hear back in the Build Hub (and email if it's urgent).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <VoiceCapture onTranscribed={onVoiceTranscribed} disabled={submitting} />
            </div>

            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What's on your mind?
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type what you noticed — or hold the mic above and speak."
              rows={5}
              maxLength={4000}
              disabled={submitting}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-foreground hover:bg-muted"
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

/**
 * Capture the page + device context to attach to the intake call so the
 * triage prompt knows where the stakeholder was when they submitted.
 *
 *   - `path`: window.location.pathname — omit hostname (we know the
 *     workspace) but keep query/hash off for privacy (tokens land in query).
 *   - `title`: document.title for breadcrumb context.
 *   - `build_item_id`: read from a `data-build-item-id` attr on the nearest
 *     ancestor of the active element, when the modal was opened from
 *     within a build-item card. Falls back to the explicit prop if none.
 *   - `screen`: {w, h} at time of capture — Claude uses this to notice
 *     mobile-vs-desktop class bugs.
 *   - `dark_mode`: reflected from `prefers-color-scheme` + the `.dark`
 *     class the theme toggle sets on <html>.
 *   - `ua_short`: one-line UA summary ("Chrome 128 on macOS"), enough for
 *     the prompt without inviting fingerprint leakage.
 */
function captureSubmissionContext(
  explicitBuildItemId?: string | null,
): SubmissionContext | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return undefined;
  try {
    const path = window.location.pathname;
    const title = document.title;
    const buildItemId = explicitBuildItemId ?? findAncestorBuildItemId();
    const w = Math.round(window.innerWidth);
    const h = Math.round(window.innerHeight);
    const darkByClass = document.documentElement.classList.contains("dark");
    const darkByPref = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const dark_mode = darkByClass || darkByPref;
    const ua_short = summariseUa(window.navigator.userAgent);

    const ctx: SubmissionContext = {
      path,
      title,
      build_item_id: buildItemId,
      screen: { w, h },
      dark_mode,
      ua_short,
    };
    return ctx;
  } catch {
    return undefined;
  }
}

function findAncestorBuildItemId(): string | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  const start = active && active instanceof HTMLElement ? active : document.body;
  const match = start.closest?.("[data-build-item-id]") as HTMLElement | null;
  const attr = match?.dataset.buildItemId ?? null;
  return attr && attr.length === 36 ? attr : null;
}

/**
 * Distil a navigator.userAgent into "Chrome 128 on macOS"-style shorthand.
 * The full UA is privacy-hostile; the shorthand is enough for triage.
 */
function summariseUa(ua: string): string {
  const u = ua || "";
  let browser = "Browser";
  const browserMatchers: Array<[RegExp, string]> = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Version\/(\d+).*Safari\//, "Safari"],
  ];
  for (const [re, name] of browserMatchers) {
    const m = u.match(re);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  let os = "Unknown OS";
  if (/iPhone|iPad|iPod/.test(u)) os = "iOS";
  else if (/Android/.test(u)) os = "Android";
  else if (/Mac OS X/.test(u)) os = "macOS";
  else if (/Windows/.test(u)) os = "Windows";
  else if (/Linux/.test(u)) os = "Linux";
  return `${browser} on ${os}`;
}
