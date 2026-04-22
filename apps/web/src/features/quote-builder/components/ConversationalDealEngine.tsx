/**
 * ConversationalDealEngine — AI-powered deal scenario panel (Slice 05)
 *
 * Collapsible side panel (desktop) / bottom sheet (mobile) that lets a sales rep
 * describe a customer opportunity in plain language (typed or spoken) and get back
 * 2–4 deal scenario cards in under 60 seconds.
 *
 * Voice path:
 *   1. Rep taps mic → VoiceRecorder captures audio blob.
 *   2. Audio sent to voice-to-qrm edge function (existing transcription path).
 *   3. Transcript passed to qb-ai-scenarios SSE stream.
 *
 * Text path:
 *   1. Rep types in the textarea → submits.
 *   2. Prompt sent directly to qb-ai-scenarios SSE stream.
 *
 * On scenario select → calls onScenarioSelect(scenario, resolvedModelId, brandId)
 * so the parent (QuoteBuilderV2Page) can pre-populate form state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MessageSquare, X, Zap, Loader2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VoiceRecorder } from "@/features/voice-qrm/components/VoiceRecorder";
import { submitVoiceToQrm } from "@/features/voice-qrm/lib/voice-qrm-api";
import { ScenarioCard } from "./ScenarioCard";
import {
  streamScenarios,
  type SseEvent,
  type SseResolvedEvent,
  type ScenarioSession,
} from "../lib/scenario-orchestrator";
import type { QuoteScenario } from "@/features/quote-builder/lib/programs-types";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScenarioSelection {
  scenario: QuoteScenario;
  resolvedModelId: string | null;
  resolvedBrandId: string | null;
  deliveryState: string | null;
  customerType: "standard" | "gmu";
  /** The prompt that produced this selection (for voiceSummary) */
  prompt: string;
  /** Slice 09: qb_ai_request_log id from the SSE complete event. Used to
   *  link the resulting quote back to the originating AI request so the
   *  admin AI Request Log can show real time-to-quote. */
  originatingLogId: string | null;
}

interface ConversationalDealEngineProps {
  /** Called when rep clicks "Use this scenario →" */
  onScenarioSelect: (selection: ScenarioSelection) => void;
  /** Whether the panel is visible */
  open: boolean;
  onClose: () => void;
  /** If the quote is tied to a deal, pass the deal ID for voice routing */
  dealId?: string;
  /** Drawer inside Quote Builder vs embedded card on the dedicated Voice Quote page */
  variant?: "drawer" | "embedded";
  /** Voice Quote should land directly in recording mode instead of text mode */
  defaultInputMode?: InputMode;
}

type InputMode = "text" | "voice";

type PanelState =
  | { phase: "idle" }
  | { phase: "transcribing" }
  | { phase: "running"; statusMessage: string; resolved: SseResolvedEvent | null }
  | { phase: "done"; scenarios: QuoteScenario[]; resolved: SseResolvedEvent | null; latencyMs: number }
  | { phase: "error"; message: string; candidates?: SseResolvedEvent[] };

// ── Component ─────────────────────────────────────────────────────────────────

export function ConversationalDealEngine({
  onScenarioSelect,
  open,
  onClose,
  dealId,
  variant = "drawer",
  defaultInputMode = "text",
}: ConversationalDealEngineProps) {
  const [inputMode, setInputMode]       = useState<InputMode>(defaultInputMode);
  const [textPrompt, setTextPrompt]     = useState("");
  const [panelState, setPanelState]     = useState<PanelState>({ phase: "idle" });
  const [scenarios, setScenarios]       = useState<QuoteScenario[]>([]);
  const [selectedIdx, setSelectedIdx]   = useState<number | null>(null);
  const [resolved, setResolved]         = useState<SseResolvedEvent | null>(null);
  // Slice 09: capture logId from SSE complete event so we can thread it
  // into the quote draft when the rep selects a scenario
  const [originatingLogId, setOriginatingLogId] = useState<string | null>(null);

  // Track the active SSE session for cancellation on unmount / close
  const sessionRef = useRef<ScenarioSession | null>(null);

  // Cancel any running stream on unmount
  useEffect(() => {
    return () => { sessionRef.current?.cancel(); };
  }, []);

  const reset = useCallback(() => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setPanelState({ phase: "idle" });
    setScenarios([]);
    setSelectedIdx(null);
    setResolved(null);
    setOriginatingLogId(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // ── Run the AI scenario stream ─────────────────────────────────────────────

  const runStream = useCallback(async (prompt: string, promptSource: "text" | "voice") => {
    reset();
    setPanelState({ phase: "running", statusMessage: "Starting…", resolved: null });

    const collectedScenarios: QuoteScenario[] = [];
    let resolvedEvent: SseResolvedEvent | null = null;
    const start = Date.now();

    const session = streamScenarios({ prompt, promptSource, supabase });
    sessionRef.current = session;

    for await (const event of session) {
      switch (event.type) {
        case "status":
          setPanelState((prev) =>
            prev.phase === "running"
              ? { ...prev, statusMessage: event.message }
              : prev
          );
          break;

        case "resolved":
          resolvedEvent = event;
          setResolved(event);
          setPanelState((prev) =>
            prev.phase === "running"
              ? { ...prev, resolved: event }
              : prev
          );
          break;

        case "scenario":
          collectedScenarios.push(event.scenario);
          setScenarios([...collectedScenarios]);
          // Transition to "done" style early so cards appear as they stream
          setPanelState({
            phase: "done",
            scenarios: [...collectedScenarios],
            resolved: resolvedEvent,
            latencyMs: Date.now() - start,
          });
          break;

        case "error":
          if (event.fatal) {
            setPanelState({ phase: "error", message: event.message });
            return;
          }
          // Non-fatal: show warning but keep going
          setPanelState({ phase: "error", message: event.message });
          return;

        case "complete":
          // Slice 09: persist logId so a subsequent scenario select can
          // thread it into the resulting quote's originating_log_id.
          setOriginatingLogId(event.logId ?? null);
          setPanelState({
            phase:     "done",
            scenarios: collectedScenarios,
            resolved:  resolvedEvent,
            latencyMs: event.latencyMs,
          });
          break;
      }
    }
  }, [reset]);

  // ── Text submit ────────────────────────────────────────────────────────────

  const handleTextSubmit = useCallback(() => {
    const p = textPrompt.trim();
    if (p.length < 10) return;
    void runStream(p, "text");
  }, [textPrompt, runStream]);

  // ── Voice submit ───────────────────────────────────────────────────────────

  const handleVoiceRecorded = useCallback(async (blob: Blob, fileName: string) => {
    setPanelState({ phase: "transcribing" });
    try {
      const result = await submitVoiceToQrm({ audioBlob: blob, fileName, dealId });
      if (!("transcript" in result) || !result.transcript) {
        setPanelState({ phase: "error", message: "Voice note didn't produce a usable transcript. Try again." });
        return;
      }
      // Pre-fill the text box with the transcript so the rep can review/edit
      setTextPrompt(result.transcript);
      void runStream(result.transcript, "voice");
    } catch (err) {
      setPanelState({
        phase:   "error",
        message: err instanceof Error ? err.message : "Voice transcription failed.",
      });
    }
  }, [dealId, runStream]);

  // ── Scenario select ────────────────────────────────────────────────────────

  const handleScenarioSelect = useCallback((scenario: QuoteScenario, idx: number) => {
    setSelectedIdx(idx);
    onScenarioSelect({
      scenario,
      resolvedModelId: resolved?.model.id ?? null,
      resolvedBrandId: resolved?.model.brandCode
        ? null // brandId not directly in resolved event; parent uses modelId to look up
        : null,
      deliveryState: resolved?.deliveryState ?? null,
      customerType:  resolved?.customerType ?? "standard",
      prompt:        textPrompt,
      originatingLogId,
    });
  }, [resolved, textPrompt, onScenarioSelect, originatingLogId]);

  if (!open) return null;

  const isRunning = panelState.phase === "running" || panelState.phase === "transcribing";
  const hasDone   = panelState.phase === "done" || (panelState.phase === "running" && scenarios.length > 0);
  const isDrawer = variant === "drawer";
  const surfaceClassName = isDrawer
    ? "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background shadow-2xl sm:w-[440px]"
    : "flex min-h-[620px] w-full flex-col overflow-hidden rounded-[28px] border border-border/60 bg-background/95 shadow-[0_32px_100px_rgba(15,23,42,0.28)]";
  const bodyClassName = isDrawer
    ? "flex-1 space-y-4 overflow-y-auto p-4"
    : "flex-1 space-y-4 overflow-y-auto p-5";

  return (
    <>
      {isDrawer && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={handleClose}
          aria-hidden="true"
        />
      )}

      <div className={surfaceClassName}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-qep-orange" />
            <span className="text-sm font-semibold text-foreground">Deal Assistant</span>
            <span className="rounded-full bg-qep-orange/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-qep-orange">
              AI
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close Deal Assistant"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className={bodyClassName}>

          {/* Input mode toggle */}
          {panelState.phase === "idle" && (
            <div className="flex rounded-lg border border-border/60 p-0.5">
              {(["text", "voice"] as InputMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setInputMode(mode)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition ${
                    inputMode === mode
                      ? "bg-qep-orange/10 text-qep-orange"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "text" ? <MessageSquare className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                  {mode === "text" ? "Type" : "Voice"}
                </button>
              ))}
            </div>
          )}

          {/* Text input */}
          {panelState.phase === "idle" && inputMode === "text" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Describe the opportunity. Include the machine type, brand, customer situation, and any budget constraints.
              </p>
              <textarea
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleTextSubmit();
                }}
                placeholder="Example: Customer needs an ASV RT-135 for land clearing in Lake City. Has about $100k budget, prefers monthly payments under $2,500."
                className="min-h-[110px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-qep-orange resize-none"
                disabled={isRunning}
              />
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">⌘↵ to submit</p>
                <Button
                  size="sm"
                  onClick={handleTextSubmit}
                  disabled={textPrompt.trim().length < 10}
                >
                  Get scenarios <Zap className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          {/* Voice input */}
          {panelState.phase === "idle" && inputMode === "voice" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Record the customer need. Mention the machine, brand, location, and budget — the AI extracts the structure.
              </p>
              <VoiceRecorder
                onRecorded={handleVoiceRecorded}
                disabled={isRunning}
              />
            </div>
          )}

          {/* Running state */}
          {panelState.phase === "transcribing" && (
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-3">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-qep-orange" />
              <p className="text-sm text-muted-foreground">Transcribing voice note…</p>
            </div>
          )}

          {(panelState.phase === "running" || (panelState.phase === "done" && scenarios.length === 0)) && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-qep-orange" />
                <p className="text-sm text-muted-foreground">
                  {panelState.phase === "running" ? panelState.statusMessage : "Building scenarios…"}
                </p>
              </div>

              {/* Show resolved model early if available */}
              {panelState.phase === "running" && panelState.resolved && (
                <MatchedModelBadge model={panelState.resolved.model} />
              )}
            </div>
          )}

          {/* Error state */}
          {panelState.phase === "error" && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <p className="text-sm text-red-400">{panelState.message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={reset} className="w-full">
                Try again
              </Button>
            </div>
          )}

          {/* Resolved model badge + scenarios */}
          {hasDone && scenarios.length > 0 && (
            <div className="space-y-3">
              {resolved && <MatchedModelBadge model={resolved.model} />}

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
                  {scenarios.length} scenario{scenarios.length !== 1 ? "s" : ""} ready
                  {panelState.phase === "done" && "latencyMs" in panelState && (
                    <span className="ml-2 font-normal normal-case">
                      ({(panelState.latencyMs / 1000).toFixed(1)}s)
                    </span>
                  )}
                </p>

                <div className="space-y-3">
                  {scenarios.map((scenario, i) => (
                    <ScenarioCard
                      key={scenario.label}
                      scenario={scenario}
                      index={i}
                      selected={selectedIdx === i}
                      onSelect={(s) => handleScenarioSelect(s, i)}
                      showMargin
                    />
                  ))}
                </div>
              </div>

              {panelState.phase === "done" && (
                <Button variant="outline" size="sm" onClick={reset} className="w-full text-xs">
                  Start over with a new description
                </Button>
              )}
            </div>
          )}

        </div>

        {/* Footer hint */}
        <div className="border-t border-border/40 px-4 py-2">
          <p className="text-[11px] text-muted-foreground text-center">
            Pick a scenario to pre-fill the quote form. Review all details before saving.
          </p>
        </div>
      </div>
    </>
  );
}

// ── Matched model badge ───────────────────────────────────────────────────────

function MatchedModelBadge({
  model,
}: {
  model: SseResolvedEvent["model"];
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Machine matched</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{model.nameDisplay}</p>
          <p className="text-xs text-muted-foreground">
            {model.brandName} · {model.modelCode}
            {model.modelYear ? ` · ${model.modelYear}` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">List price</p>
          <p className="text-sm font-semibold text-foreground">
            ${(model.listPriceCents / 100).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Trigger button (used in QuoteBuilderV2Page) ────────────────────────────────

export function DealAssistantTrigger({
  onClick,
  active,
}: {
  onClick: () => void;
  active: boolean;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className="gap-1.5"
    >
      <Zap className="h-3 w-3" />
      Deal Assistant
    </Button>
  );
}
