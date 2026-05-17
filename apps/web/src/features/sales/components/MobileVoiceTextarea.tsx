/**
 * WAVE quote-builder polish (Slice 2).
 *
 * Drop-in replacement for <textarea> that overlays a thumb-sized voice
 * dictation button in the bottom-right corner on mobile viewports.
 * Voice input uses the browser SpeechRecognition / webkitSpeechRecognition
 * API (Chrome / Safari, including iOS) so we don't need a backend
 * transcription round-trip for inline field dictation. The component
 * gracefully no-ops when the API is unavailable — the textarea still
 * works as a plain textarea.
 *
 * Form-friendly:
 *   - forwardRef on the underlying <textarea>
 *   - all native textarea props pass through
 *   - voice transcript appends to the current `value` via a synthetic
 *     React.ChangeEvent so react-hook-form (or any controlled flow)
 *     reads the new value through the same onChange contract.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from "react";
import { Mic, Loader2, AlertCircle, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobileViewport } from "../hooks/useIsMobileViewport";

type SpeechRecognitionResultEvent = Event & {
  readonly resultIndex: number;
  readonly results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechRecognitionErrorEvent = Event & { error?: string };

interface MinimalSpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

type MicState = "idle" | "recording" | "processing" | "error" | "unsupported";

export interface MobileVoiceTextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Disable the mic affordance even on mobile. Default true. */
  voiceEnabled?: boolean;
  /** Optional callback fired with the raw transcript appended this turn. */
  onTranscriptAppend?: (transcript: string) => void;
}

export const MobileVoiceTextarea = forwardRef<
  HTMLTextAreaElement,
  MobileVoiceTextareaProps
>(function MobileVoiceTextarea(
  { className, voiceEnabled = true, onChange, onTranscriptAppend, value, name, ...rest },
  ref,
) {
  const isMobile = useIsMobileViewport();
  const SpeechCtor = getSpeechRecognitionCtor();
  const supported = SpeechCtor !== null;
  const showMic = voiceEnabled && isMobile;
  const [state, setState] = useState<MicState>(
    supported ? "idle" : "unsupported",
  );
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const appendTranscript = useCallback(
    (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed) return;
      const current = typeof valueRef.current === "string" ? valueRef.current : "";
      const next = current ? `${current.trimEnd()} ${trimmed}`.trim() : trimmed;
      // Synthesize a textarea ChangeEvent that controlled-form callers
      // (and react-hook-form's register()) can consume as if the user
      // typed the dictated text.
      const event = {
        target: { value: next, name },
        currentTarget: { value: next, name },
      } as unknown as ChangeEvent<HTMLTextAreaElement>;
      onChange?.(event);
      onTranscriptAppend?.(trimmed);
    },
    [onChange, onTranscriptAppend, name],
  );

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore — recognition may already be stopped
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      stopRecognition();
      recognitionRef.current = null;
    };
  }, [stopRecognition]);

  const startRecognition = useCallback(() => {
    if (!SpeechCtor) {
      setState("unsupported");
      return;
    }
    try {
      const rec = new SpeechCtor();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = false;
      rec.continuous = false;
      rec.onresult = (event) => {
        const turn: string[] = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const alt = event.results[i]?.[0];
          if (alt?.transcript) turn.push(alt.transcript);
        }
        if (turn.length > 0) {
          appendTranscript(turn.join(" "));
        }
      };
      rec.onerror = () => {
        setState("error");
      };
      rec.onend = () => {
        recognitionRef.current = null;
        setState((prev) => (prev === "recording" ? "idle" : prev));
      };
      recognitionRef.current = rec;
      setState("recording");
      rec.start();
    } catch {
      setState("error");
    }
  }, [SpeechCtor, appendTranscript]);

  const handleMicClick = useCallback(() => {
    if (state === "recording") {
      stopRecognition();
      setState("processing");
      return;
    }
    if (state === "error" || state === "idle") {
      startRecognition();
    }
  }, [state, startRecognition, stopRecognition]);

  const micIcon =
    state === "recording" ? (
      <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
    ) : state === "processing" ? (
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    ) : state === "error" ? (
      <AlertCircle className="h-4 w-4" aria-hidden />
    ) : (
      <Mic className="h-4 w-4" aria-hidden />
    );

  const micLabel =
    state === "recording"
      ? "Stop dictation"
      : state === "processing"
        ? "Processing"
        : state === "error"
          ? "Retry dictation"
          : state === "unsupported"
            ? "Dictation unavailable"
            : "Dictate into this field";

  return (
    <div className="relative">
      <textarea
        ref={ref}
        name={name}
        className={cn(
          "w-full rounded-md border border-input bg-card px-3 py-2 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-qep-orange/40",
          showMic && "pr-12",
          className,
        )}
        value={value}
        onChange={onChange}
        {...rest}
      />
      {showMic && state !== "unsupported" && (
        <button
          type="button"
          aria-label={micLabel}
          aria-pressed={state === "recording"}
          aria-busy={state === "processing"}
          disabled={state === "processing"}
          onClick={handleMicClick}
          className={cn(
            "absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border transition-all shadow-sm",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange/50",
            state === "recording"
              ? "border-red-400 bg-red-500 text-white animate-pulse"
              : state === "error"
                ? "border-amber-400 bg-amber-500/90 text-white"
                : state === "processing"
                  ? "border-white/20 bg-foreground/[0.08] text-muted-foreground cursor-wait"
                  : "border-qep-orange/40 bg-qep-orange text-white",
          )}
          data-mobile-voice-mic
          data-state={state}
        >
          {micIcon}
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {state === "recording"
          ? "Listening"
          : state === "processing"
            ? "Processing dictation"
            : state === "error"
              ? "Dictation failed, tap mic to retry"
              : ""}
      </span>
    </div>
  );
});
