/**
 * Wave 7 Iron Companion — IronBar (command palette + chat input).
 *
 * Built on cmdk + Radix Dialog (already in the repo). Pressing Cmd+I (or
 * Ctrl+I on Windows/Linux) opens the bar. Typing or speaking sends the
 * intent to iron-orchestrator. On FLOW_DISPATCH the bar closes and
 * FlowEngineUI mounts to walk slot fills.
 *
 * Cmd+K is intentionally NOT used because the existing QrmGlobalSearchCommand
 * already binds it. Cmd+I = "Iron".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Command } from "cmdk";
import { Loader2, Send, Sparkles, Bot, AlertCircle, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ironOrchestrate } from "./api";
import { useIronStore } from "./store";
import { useIronVoiceRecorder } from "./voice/useIronVoiceRecorder";
import { ironTranscribe } from "./voice/api";
import { ironSpeak, cancelIronSpeech } from "./voice/tts";

export function IronBar() {
  const { state, openBar, closeBar, startFlow, setAvatar, setError, setNarrationEnabled, setLastInputMode } = useIronStore();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const recorder = useIronVoiceRecorder();
  const [voicePending, setVoicePending] = useState(false);
  // Track whether spacebar PTT is currently engaged so we don't double-fire
  const pttActiveRef = useRef(false);

  // v1.2 narration helper: speak text iff narration is enabled OR last input
  // was voice. Always cancel any in-flight speech first (barge-in semantics).
  const narrate = useCallback(
    (text: string, force?: boolean) => {
      if (!text) return;
      if (!force && !state.narrationEnabled) return;
      cancelIronSpeech();
      setAvatar("speaking");
      void ironSpeak(text, {
        onEnd: () => setAvatar("idle"),
        onError: () => setAvatar("idle"),
      });
    },
    [state.narrationEnabled, setAvatar],
  );

  // Cmd+I / Ctrl+I shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (!cmd) return;
      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        if (state.barOpen) {
          closeBar();
        } else {
          openBar();
        }
      } else if (e.key === "Escape" && state.barOpen) {
        closeBar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.barOpen, openBar, closeBar]);

  // Auto-focus input when bar opens
  useEffect(() => {
    if (state.barOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      // Reset on close
      setInput("");
      setResponse(null);
      setPending(false);
    }
  }, [state.barOpen]);

  const submit = useCallback(async (explicitText?: string, mode: "text" | "voice" = "text") => {
    const text = (explicitText ?? input).trim();
    if (!text || pending) return;
    // v1.2: cancel any in-flight narration before kicking off a new turn
    cancelIronSpeech();
    setLastInputMode(mode);
    setPending(true);
    setResponse(null);
    setError(null);
    setAvatar("thinking");
    // Local helper: set the response text and decide whether to narrate it.
    // Voice-input turns auto-narrate; text-input turns only narrate when the
    // user has explicitly toggled narration on.
    const finishWithMessage = (message: string, alert?: boolean) => {
      setResponse(message);
      const shouldNarrate = mode === "voice" || state.narrationEnabled;
      if (shouldNarrate) {
        narrate(message, true);
      } else {
        setAvatar(alert ? "alert" : "idle");
      }
    };
    try {
      const res = await ironOrchestrate({
        text,
        conversation_id: state.conversationId ?? undefined,
        input_mode: mode,
        route: location.pathname,
      });
      if (!res.ok) {
        finishWithMessage(res.message ?? `Iron declined: ${res.category ?? "unknown"}`, true);
        return;
      }
      const cls = res.classification;
      if (!cls) {
        finishWithMessage("Iron returned no classification.", true);
        return;
      }

      if (cls.category === "FLOW_DISPATCH" && res.flow_definition && res.conversation_id) {
        startFlow({
          flow: res.flow_definition,
          conversationId: res.conversation_id,
          prefilled: cls.prefilled_slots ?? {},
        });
        return;
      }

      if (cls.category === "CLARIFY") {
        finishWithMessage(cls.clarification_needed ?? "Could you rephrase?");
        return;
      }

      if (cls.category === "READ_ANSWER") {
        finishWithMessage(
          `I can answer that — try asking it on the dashboard. (${cls.answer_query ?? ""})`,
        );
        return;
      }

      if (cls.category === "AGENTIC_TASK") {
        finishWithMessage(`Logged for follow-up: ${cls.agentic_brief ?? "(no brief)"}`);
        return;
      }

      if (cls.category === "HUMAN_ESCALATION") {
        finishWithMessage(
          `Flagged for a manager: ${cls.escalation_reason ?? "human help requested"}`,
          true,
        );
        return;
      }

      finishWithMessage(`Iron returned: ${cls.category}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Iron call failed";
      setResponse(message);
      setError(message);
      setAvatar("alert");
    } finally {
      setPending(false);
    }
  }, [input, pending, state.conversationId, state.narrationEnabled, location.pathname, setAvatar, setError, setLastInputMode, narrate, startFlow]);

  // ── Voice flow: record → transcribe → submit ─────────────────────────
  const startVoice = useCallback(async () => {
    if (recorder.state === "recording" || pending || voicePending) return;
    // v1.2 barge-in: starting to speak cancels any in-flight Iron narration
    cancelIronSpeech();
    setResponse(null);
    setAvatar("listening");
    await recorder.start();
  }, [recorder, pending, voicePending, setAvatar]);

  const stopAndTranscribe = useCallback(async () => {
    if (recorder.state !== "recording") return;
    setVoicePending(true);
    setAvatar("thinking");
    try {
      const result = await recorder.stop();
      if (!result) {
        setResponse("Didn't catch that — try again?");
        setAvatar("idle");
        return;
      }
      const transcribed = await ironTranscribe(result.blob, result.fileName);
      if (!transcribed.ok || !transcribed.transcript) {
        setResponse(transcribed.message ?? "No speech detected.");
        setAvatar("idle");
        return;
      }
      setInput(transcribed.transcript);
      // Hand off to the orchestrator with input_mode='voice'. The avatar will
      // flip to 'thinking' inside submit().
      await submit(transcribed.transcript, "voice");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Voice transcription failed";
      setResponse(message);
      setAvatar("alert");
    } finally {
      setVoicePending(false);
    }
  }, [recorder, setAvatar, submit]);

  const handleMicClick = useCallback(() => {
    if (recorder.state === "recording") {
      void stopAndTranscribe();
    } else {
      void startVoice();
    }
  }, [recorder.state, stopAndTranscribe, startVoice]);

  // Push-to-hold spacebar (only when bar is open + input field is empty so
  // we don't fight with the user's typing).
  useEffect(() => {
    if (!state.barOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (input.length > 0) return;
      // Don't fire when an interactive element other than our input is focused
      const active = document.activeElement;
      const isOurInput = active === inputRef.current;
      const isOtherInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isOtherInput && !isOurInput) return;
      e.preventDefault();
      pttActiveRef.current = true;
      void startVoice();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (!pttActiveRef.current) return;
      pttActiveRef.current = false;
      e.preventDefault();
      void stopAndTranscribe();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [state.barOpen, input, startVoice, stopAndTranscribe]);

  // If the bar closes mid-recording, cancel cleanly. Also cancel any
  // in-flight TTS narration so Iron doesn't keep speaking after the user
  // closed the panel.
  useEffect(() => {
    if (!state.barOpen) {
      if (recorder.state === "recording") recorder.cancel();
      cancelIronSpeech();
    }
  }, [state.barOpen, recorder]);

  return (
    <Dialog open={state.barOpen} onOpenChange={(open) => (open ? openBar() : closeBar())}>
      <DialogContent className="max-w-2xl gap-3 p-0">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-qep-orange" /> Iron
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Type, speak, or hold space — Cmd+I toggles. Voice runs through Whisper.
          </DialogDescription>
        </DialogHeader>

        <Command className="bg-transparent">
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={pending || voicePending}
              placeholder={
                recorder.state === "recording"
                  ? "Listening… release space or tap stop"
                  : "Type, speak, or hold space — pull a part, log service…"
              }
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            <button
              type="button"
              onClick={() => {
                const next = !state.narrationEnabled;
                setNarrationEnabled(next);
                if (!next) cancelIronSpeech();
              }}
              className={`rounded-md p-1.5 transition-colors ${
                state.narrationEnabled
                  ? "bg-qep-orange/10 text-qep-orange"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
              aria-label={state.narrationEnabled ? "Mute Iron narration" : "Let Iron speak"}
              title={state.narrationEnabled ? "Iron will speak responses (click to mute)" : "Iron is silent (click to enable narration)"}
            >
              {state.narrationEnabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleMicClick}
              disabled={pending || voicePending}
              className={`rounded-md p-1.5 transition-colors disabled:opacity-30 ${
                recorder.state === "recording"
                  ? "bg-red-500/15 text-red-400 animate-pulse"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
              aria-label={recorder.state === "recording" ? "Stop recording" : "Start recording"}
            >
              {recorder.state === "error" ? (
                <MicOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={pending || voicePending || input.trim().length === 0}
              className="rounded-md bg-qep-orange/10 p-1.5 text-qep-orange hover:bg-qep-orange/20 disabled:opacity-30"
              aria-label="Send to Iron"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Voice level meter — only shown while recording */}
          {recorder.state === "recording" && (
            <div className="mx-3 my-1 h-1 overflow-hidden rounded-full bg-muted/30">
              <div
                className="h-full bg-red-400 transition-[width] duration-75"
                style={{ width: `${Math.round(recorder.level * 100)}%` }}
              />
            </div>
          )}
          {recorder.errorMessage && (
            <div className="mx-3 my-1 flex items-center gap-1.5 text-[10px] text-red-400">
              <MicOff className="h-3 w-3" /> {recorder.errorMessage}
            </div>
          )}

          {response && (
            <div className="mx-3 my-2 rounded border border-border/60 bg-muted/20 p-2 text-[12px] text-foreground">
              {response.includes("declined") || response.includes("failed") ? (
                <span className="flex items-start gap-1.5 text-amber-400">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  {response}
                </span>
              ) : (
                response
              )}
            </div>
          )}

          <div className="border-t border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Try:&nbsp;
            <span className="text-foreground">"pull part 4521 for Anderson"</span>&nbsp;·&nbsp;
            <span className="text-foreground">"log a service call"</span>&nbsp;·&nbsp;
            <span className="text-foreground">"draft a follow-up to John"</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
