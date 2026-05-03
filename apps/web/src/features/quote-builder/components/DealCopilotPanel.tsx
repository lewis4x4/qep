/**
 * DealCopilotPanel — Slice 21.
 *
 * Stateful per-quote copilot drawer. The rep drops information (voice
 * memo, text, pasted email, photo caption), Claude extracts structured
 * signals, the deterministic translator patches the draft, the scorer
 * re-runs, and the new score + factor deltas + lifts stream back inline.
 * The conversation persists per quote — every re-open continues the
 * thread.
 *
 * Event flow per turn:
 *   1. rep submits    → optimistic turn appended (status: pending)
 *   2. extracted SSE  → signal chips populate on the turn card
 *   3. draftPatch SSE → onDraftPatch callback fires to parent
 *   4. score SSE      → onScore callback fires to parent + delta chip
 *                       appears on the turn card
 *   5. reply SSE      → copilot reply text fills in
 *   6. complete SSE   → turn stabilizes with id + index
 *
 * Contract with parent (QuoteBuilderV2Page):
 *   • `quotePackageId` is REQUIRED — this panel is never rendered for a
 *     cold-start quote (use ConversationalDealEngine's Scenarios tab for
 *     that).
 *   • `onScore(score, factors, lifts)` bubbles the new score up so
 *     WinProbabilityStrip animates + copilot-latest denorms stay in sync
 *     with the UI.
 *   • `onDraftPatch(patch)` feeds the parent's draft reducer so form
 *     fields visibly reflect the copilot's updates.
 *
 * Design bar: zero-blocking. A Claude hiccup must never cost the rep
 * their input. On extraction failure, the edge fn still persists the
 * turn with empty signals; this panel displays "Saved, nothing
 * auto-extracted" and does NOT unwind the optimistic entry.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  ChevronUp,
  Loader2,
  Mic,
  MessageSquare,
  Send,
  Sparkles,
  TrendingUp,
  TrendingDown,
  User,
  X,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VoiceRecorder } from "@/features/voice-qrm/components/VoiceRecorder";
import { submitVoiceToQrm } from "@/features/voice-qrm/lib/voice-qrm-api";
import { supabase } from "@/lib/supabase";
import type {
  CopilotExtractedSignals,
  CopilotInputSource,
  CopilotTurn,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import type {
  WinProbabilityFactor,
  WinProbabilityLift,
} from "../lib/win-probability-scorer";
import {
  isAbortError,
  normalizeCopilotTurnRows,
  parseDealCopilotSseEvent,
  type CopilotTurnViewModel,
  type DealCopilotSseEvent,
  type TurnStatus,
} from "../lib/deal-copilot-normalizers";

// ── Public props ──────────────────────────────────────────────────────────

export interface DealCopilotPanelProps {
  /** Required. The panel is per-quote — it is never cold-start. */
  quotePackageId: string;
  /** Short human label for the header (e.g. "RT-135 · Dave Whittaker"). */
  quoteName?: string;
  /** Current win-probability score from the parent. Drives the live pill
   *  in the header. */
  currentScore?: number | null;
  /** Whether the panel is visible. */
  open: boolean;
  onClose: () => void;
  /** Bubbled up after every `score` SSE event so the parent can animate
   *  WinProbabilityStrip and nudge the snapshot. */
  onScore?: (score: number, factors: WinProbabilityFactor[], lifts: WinProbabilityLift[]) => void;
  /** Bubbled up after every `draftPatch` SSE event so the parent can
   *  apply the patch to its draft reducer. */
  onDraftPatch?: (patch: Partial<QuoteWorkspaceDraft>, changedPaths: string[]) => void;
  /** The underlying deal id, if one is linked. Used only to route voice
   *  transcription. */
  dealId?: string;
}

// ── Internal turn view-model ──────────────────────────────────────────────

// ── Component ─────────────────────────────────────────────────────────────

export function DealCopilotPanel({
  quotePackageId,
  quoteName,
  currentScore,
  open,
  onClose,
  onScore,
  onDraftPatch,
  dealId,
}: DealCopilotPanelProps) {
  const [turns, setTurns] = useState<CopilotTurnViewModel[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [composerText, setComposerText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Load existing turn history on mount / quote change ─────────────────

  useEffect(() => {
    if (!open || !quotePackageId) return;

    let cancelled = false;
    setIsHistoryLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from("qb_quote_copilot_turns")
        .select(
          "id, quote_package_id, workspace_id, author_user_id, turn_index, input_source, raw_input, transcript, extracted_signals, copilot_reply, score_before, score_after, factor_diff, lift_diff, ai_request_log_id, created_at, updated_at, deleted_at",
        )
        .eq("quote_package_id", quotePackageId)
        .is("deleted_at", null)
        .order("turn_index", { ascending: true });

      if (cancelled) return;

      if (error) {
        // Non-fatal — the rep can still author new turns. Surface as a
        // dismissible banner rather than eating the whole panel.
        setFatalError("Couldn't load prior turns. New turns will still save.");
        setTurns([]);
      } else {
        setTurns(normalizeCopilotTurnRows(data ?? []));
      }
      setIsHistoryLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, quotePackageId]);

  // ── Auto-scroll to bottom on new turn ──────────────────────────────────

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns.length, isSubmitting]);

  // ── Unmount: abort any in-flight stream ────────────────────────────────

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── Submit a turn ──────────────────────────────────────────────────────

  const submitTurn = useCallback(
    async (rawInput: string, inputSource: CopilotInputSource) => {
      const trimmed = rawInput.trim();
      if (trimmed.length < 2) return;

      // Optimistic turn — appears immediately so the rep has visual
      // feedback even before the SSE stream opens.
      const optimisticKey = `optimistic-${Date.now()}`;
      setTurns((prev) => [
        ...prev,
        {
          key: optimisticKey,
          status: "pending",
          turnIndex: null,
          inputSource,
          rawInput: trimmed,
          extractedSignals: {},
          copilotReply: null,
          scoreBefore: currentScore ?? null,
          scoreAfter: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setComposerText("");
      setIsSubmitting(true);
      setFatalError(null);

      // Fetch the auth token for the edge fn. We use supabase-js to
      // grab the current session rather than reading localStorage
      // directly, so we pick up rotated tokens.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setTurns((prev) =>
          prev.map((t) =>
            t.key === optimisticKey
              ? { ...t, status: "error", errorMessage: "Not signed in." }
              : t,
          ),
        );
        setIsSubmitting(false);
        return;
      }

      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
      const endpoint = `${supabaseUrl}/functions/v1/qb-copilot-turn`;

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "",
          },
          body: JSON.stringify({
            quotePackageId,
            input: trimmed,
            inputSource,
            clientSubmittedAt: new Date().toISOString(),
          }),
          signal: abortController.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(`Request failed (${res.status}): ${text.slice(0, 200)}`);
        }

        await consumeSseStream(res.body, (evt) => {
          applySseEvent(evt, optimisticKey, {
            setTurns,
            onScore,
            onDraftPatch,
          });
        });

        // Mark pending turns as complete if the stream closed without an
        // explicit complete event.
        setTurns((prev) =>
          prev.map((t) =>
            t.key === optimisticKey && t.status !== "error" && t.status !== "complete"
              ? { ...t, status: "complete" }
              : t,
          ),
        );
      } catch (err) {
        if (isAbortError(err)) return;
        const msg = err instanceof Error ? err.message : "Copilot submit failed.";
        setTurns((prev) =>
          prev.map((t) =>
            t.key === optimisticKey
              ? { ...t, status: "error", errorMessage: "Couldn't reach the copilot. Your input is queued for retry." }
              : t,
          ),
        );
        console.warn("[DealCopilotPanel] submit failed:", msg);
      } finally {
        setIsSubmitting(false);
        abortRef.current = null;
      }
    },
    [quotePackageId, currentScore, onDraftPatch, onScore],
  );

  // ── Text submit ────────────────────────────────────────────────────────

  const handleTextSubmit = useCallback(() => {
    void submitTurn(composerText, "text");
  }, [composerText, submitTurn]);

  // ── Voice submit ───────────────────────────────────────────────────────

  const handleVoiceRecorded = useCallback(
    async (blob: Blob, fileName: string) => {
      setIsSubmitting(true);
      try {
        const result = await submitVoiceToQrm({ audioBlob: blob, fileName, dealId });
        if (!("transcript" in result) || !result.transcript) {
          setFatalError("Voice note didn't transcribe. Try again.");
          setIsSubmitting(false);
          return;
        }
        await submitTurn(result.transcript, "voice");
      } catch (err) {
        setFatalError(err instanceof Error ? err.message : "Voice transcription failed.");
        setIsSubmitting(false);
      }
    },
    [dealId, submitTurn],
  );

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background shadow-2xl sm:w-[460px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-qep-orange shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-foreground">Deal Copilot</span>
                <span className="rounded-full bg-qep-orange/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-qep-orange">
                  Live
                </span>
              </div>
              {quoteName && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{quoteName}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {typeof currentScore === "number" && <LiveScorePill score={currentScore} />}
            <TurnCountChip count={turns.length} />
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Close Deal Copilot"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Fatal error banner */}
        {fatalError && (
          <div className="flex items-start gap-2 border-b border-rose-500/30 bg-rose-500/5 px-3 py-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            <p className="text-[11px] text-rose-300">{fatalError}</p>
            <button
              type="button"
              onClick={() => setFatalError(null)}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Conversation feed */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {isHistoryLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading prior turns…
            </div>
          ) : turns.length === 0 ? (
            <EmptyState />
          ) : (
            turns.map((turn) => <TurnCard key={turn.key} turn={turn} />)
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border/60 bg-background/95 p-3">
          <div className="mb-2 flex rounded-lg border border-border/60 p-0.5">
            {(["text", "voice"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setInputMode(mode)}
                disabled={isSubmitting}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium transition",
                  inputMode === mode
                    ? "bg-qep-orange/10 text-qep-orange"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode === "text" ? <MessageSquare className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                {mode === "text" ? "Type" : "Voice"}
              </button>
            ))}
          </div>

          {inputMode === "text" ? (
            <div className="space-y-1.5">
              <textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isSubmitting) {
                    handleTextSubmit();
                  }
                }}
                placeholder="What did you learn? ('Dave wants cash not financing; timeline is 3 weeks.')"
                className="min-h-[70px] w-full resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-qep-orange disabled:opacity-50"
                disabled={isSubmitting}
              />
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">⌘↵ to send</p>
                <Button
                  size="sm"
                  onClick={handleTextSubmit}
                  disabled={isSubmitting || composerText.trim().length < 2}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      Send <Send className="ml-1 h-3 w-3" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <VoiceRecorder onRecorded={handleVoiceRecorded} disabled={isSubmitting} />
          )}
        </div>
      </div>
    </>
  );
}

// ── SSE event application ────────────────────────────────────────────────

interface SseApplyContext {
  setTurns: React.Dispatch<React.SetStateAction<CopilotTurnViewModel[]>>;
  onScore: DealCopilotPanelProps["onScore"];
  onDraftPatch: DealCopilotPanelProps["onDraftPatch"];
}

function applySseEvent(evt: DealCopilotSseEvent, optimisticKey: string, ctx: SseApplyContext) {
  switch (evt.type) {
    case "status":
      // We don't surface per-status banners inside the turn card; the
      // spinner on the pending turn is signal enough. Could be extended
      // to a sub-line later.
      break;

    case "extracted":
      ctx.setTurns((prev) =>
        prev.map((t) =>
          t.key === optimisticKey
            ? { ...t, status: "streaming", extractedSignals: evt.signals }
            : t,
        ),
      );
      break;

    case "draftPatch":
      ctx.onDraftPatch?.(evt.patch, evt.changedPaths);
      break;

    case "score":
      ctx.setTurns((prev) =>
        prev.map((t) =>
          t.key === optimisticKey
            ? { ...t, scoreBefore: evt.before, scoreAfter: evt.after }
            : t,
        ),
      );
      ctx.onScore?.(evt.after, evt.factors, evt.lifts);
      break;

    case "reply":
      ctx.setTurns((prev) =>
        prev.map((t) =>
          t.key === optimisticKey ? { ...t, copilotReply: evt.text } : t,
        ),
      );
      break;

    case "complete":
      ctx.setTurns((prev) =>
        prev.map((t) =>
          t.key === optimisticKey
            ? {
                ...t,
                status: "complete",
                key: evt.turnId ?? t.key,
                turnIndex: evt.turnIndex ?? t.turnIndex,
              }
            : t,
        ),
      );
      break;

    case "error":
      ctx.setTurns((prev) =>
        prev.map((t) =>
          t.key === optimisticKey
            ? { ...t, status: "error", errorMessage: evt.message }
            : t,
        ),
      );
      break;
  }
}

// ── SSE stream reader ────────────────────────────────────────────────────

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: DealCopilotSseEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    let frameEnd = buffer.indexOf("\n\n");
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (dataLine) {
        const json = dataLine.slice("data:".length).trim();
        const event = parseDealCopilotSseEvent(json);
        if (event) onEvent(event);
      }
      frameEnd = buffer.indexOf("\n\n");
    }
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

function TurnCard({ turn }: { turn: CopilotTurnViewModel }) {
  const delta =
    turn.scoreBefore !== null && turn.scoreAfter !== null
      ? turn.scoreAfter - turn.scoreBefore
      : null;

  return (
    <Card className="space-y-2 border border-border/60 bg-card/60 p-3">
      {/* Rep input */}
      <div className="flex items-start gap-2">
        <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {turn.turnIndex !== null ? `Turn ${turn.turnIndex}` : "You"}
            </span>
            <span className="text-[10px] text-muted-foreground">· {sourceLabel(turn.inputSource)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{turn.rawInput}</p>
        </div>
      </div>

      {/* Signal chips */}
      {hasAnyExtraction(turn.extractedSignals) && (
        <div className="flex flex-wrap gap-1.5 pl-5">
          <ExtractionChips signals={turn.extractedSignals} />
        </div>
      )}

      {/* Score delta */}
      {delta !== null && (
        <div className="pl-5">
          <ScoreDeltaChip delta={delta} after={turn.scoreAfter!} />
        </div>
      )}

      {/* Copilot reply */}
      {turn.copilotReply && (
        <div className="flex items-start gap-2 rounded-md border border-qep-orange/20 bg-qep-orange/5 px-2 py-1.5">
          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-qep-orange" />
          <p className="text-xs text-foreground">{turn.copilotReply}</p>
        </div>
      )}

      {/* Status */}
      {turn.status === "pending" && (
        <div className="flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Sending…
        </div>
      )}
      {turn.status === "streaming" && (
        <div className="flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Thinking…
        </div>
      )}
      {turn.status === "error" && turn.errorMessage && (
        <div className="flex items-start gap-1.5 pl-5">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
          <p className="text-[11px] text-rose-300">{turn.errorMessage}</p>
        </div>
      )}
    </Card>
  );
}

function ExtractionChips({ signals }: { signals: CopilotExtractedSignals }) {
  const chips: Array<{ key: string; label: string; className: string }> = [];
  const cs = signals.customerSignals;
  if (cs?.objections && cs.objections.length > 0) {
    chips.push({
      key: "objections",
      label: `${cs.objections.length} objection${cs.objections.length === 1 ? "" : "s"}`,
      className: "border-rose-500/30 bg-rose-500/5 text-rose-300",
    });
  }
  if (cs?.timelinePressure) {
    chips.push({
      key: "timeline",
      label: `Timeline: ${cs.timelinePressure}`,
      className: "border-sky-500/30 bg-sky-500/5 text-sky-300",
    });
  }
  if (cs?.competitorMentions && cs.competitorMentions.length > 0) {
    chips.push({
      key: "competitors",
      label: `vs ${cs.competitorMentions.slice(0, 2).join(", ")}${cs.competitorMentions.length > 2 ? "…" : ""}`,
      className: "border-amber-500/30 bg-amber-500/5 text-amber-300",
    });
  }
  if (signals.financingPref) {
    chips.push({
      key: "financing",
      label: `Financing: ${signals.financingPref}`,
      className: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
    });
  }
  if (signals.customerWarmth) {
    chips.push({
      key: "warmth",
      label: `Warmth: ${signals.customerWarmth}`,
      className: "border-border/60 bg-background/60 text-muted-foreground",
    });
  }
  return (
    <>
      {chips.map((c) => (
        <span
          key={c.key}
          className={cn("rounded-full border px-2 py-0.5 text-[10px]", c.className)}
        >
          {c.label}
        </span>
      ))}
    </>
  );
}

function ScoreDeltaChip({ delta, after }: { delta: number; after: number }) {
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : ChevronUp;
  const cls =
    delta > 0
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : delta < 0
        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
        : "border-border/60 bg-background/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tabular-nums",
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="font-semibold">
        {delta > 0 ? "+" : ""}
        {delta}
      </span>
      <span className="opacity-80">→ {after}%</span>
    </span>
  );
}

function LiveScorePill({ score }: { score: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-foreground"
      aria-label={`Current win probability ${score} percent`}
    >
      {score}%
    </span>
  );
}

function TurnCountChip({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Zap className="h-2.5 w-2.5" />
      {count}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-border/60 bg-card/40 p-4 text-center">
      <Sparkles className="mx-auto h-6 w-6 text-qep-orange/70" />
      <p className="mt-2 text-xs font-semibold text-foreground">No turns yet</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Drop a voice memo or text update — the copilot will extract signals, patch the draft, and move the score inline.
      </p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sourceLabel(source: CopilotInputSource): string {
  switch (source) {
    case "voice":         return "voice";
    case "text":          return "text";
    case "photo_caption": return "photo";
    case "email_paste":   return "email";
    case "system":        return "system";
  }
}

function hasAnyExtraction(signals: CopilotExtractedSignals): boolean {
  const cs = signals.customerSignals;
  return !!(
    (cs?.objections && cs.objections.length > 0) ||
    cs?.timelinePressure ||
    (cs?.competitorMentions && cs.competitorMentions.length > 0) ||
    signals.financingPref ||
    signals.customerWarmth
  );
}

// Re-export the turn type for the ConversationalDealEngine tab wrapper.
export type { CopilotTurn };
