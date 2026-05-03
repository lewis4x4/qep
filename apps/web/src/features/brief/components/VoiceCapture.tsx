/**
 * VoiceCapture — Build Hub v2.2 voice-first capture.
 *
 * Press-and-hold mic button that records audio via MediaRecorder, streams
 * live amplitude into a concentric "ring" visualiser, and on release
 * uploads the clip to the `hub-feedback-transcribe` edge function. The
 * returned transcript is handed back via `onTranscribed` so the parent
 * drops it into the feedback textarea.
 *
 * Design tenets:
 *   - Press-and-hold, not toggle. Matches voice-memo muscle memory on iOS
 *     and Android. Mouse down / pointer down starts, pointer up / cancel
 *     stops. Keyboard: Space bar when focused = start, release = stop.
 *   - Zero-blocking: if the browser refuses permission, Whisper is down,
 *     or transcription returns empty, the stakeholder still has the
 *     typed textarea — this is additive only.
 *   - Live feedback: live duration counter + animated amplitude ring so the
 *     stakeholder knows mic is hot and their voice is registering.
 *   - Safety: hard-stops at 90 s even if the user holds forever, because
 *     Whisper's cost climbs linearly and a runaway session could rack up
 *     dollars in seconds.
 *   - Accessibility: aria-label describes state, focus-visible ring,
 *     keyboard-operable via Space key.
 *
 * Audio format priority (falls back to whatever the browser supports):
 *   1. audio/webm;codecs=opus  — Chromium/Firefox, best compression
 *   2. audio/mp4               — Safari 14+
 *   3. audio/webm              — older Chromium
 *
 * The edge function's `mimeToExt()` handles all three.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { transcribeFeedbackAudio, type TranscribeResult } from "../lib/brief-api";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

// Hard cap so a forgotten press-and-hold doesn't burn Whisper budget. The
// backend also caps at 8 MB, which is ~90 s of opus @ 48 kbps.
const MAX_RECORDING_MS = 90_000;

// Amplitude sampling interval for the visualiser. 80 ms feels alive without
// blowing main-thread budget.
const VISUALISER_INTERVAL_MS = 80;

export interface VoiceCaptureResult extends TranscribeResult {
  duration_ms: number;
}

interface VoiceCaptureProps {
  /**
   * Fires when Whisper returns a (possibly empty) transcript + the upload
   * succeeded. Parent typically appends `transcript` to the textarea and
   * stashes `audio_path` / `duration_ms` for the intake call.
   */
  onTranscribed: (result: VoiceCaptureResult) => void;
  /** Disable the mic while the parent form is submitting. */
  disabled?: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "requesting" } // waiting on getUserMedia
  | { kind: "recording"; startedAt: number }
  | { kind: "processing" } // blob → edge fn round-trip
  | { kind: "denied" }
  | { kind: "unsupported" };

export function VoiceCapture({ onTranscribed, disabled }: VoiceCaptureProps) {
  const { toast } = useToast();

  const [state, setState] = useState<State>(() => {
    if (typeof window === "undefined") return { kind: "idle" };
    if (!("MediaRecorder" in window)) return { kind: "unsupported" };
    if (!navigator.mediaDevices?.getUserMedia) return { kind: "unsupported" };
    return { kind: "idle" };
  });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [amplitude, setAmplitude] = useState(0); // 0..1

  // All of these are refs rather than state because they're mutated by
  // event handlers that run outside React's render cycle (MediaRecorder
  // callbacks, rAF, pointer handlers).
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const visualiserIntervalRef = useRef<number | null>(null);
  const elapsedIntervalRef = useRef<number | null>(null);
  const hardStopTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  // Cleanup on unmount. Critical — otherwise the mic light stays on after
  // the modal closes.
  useEffect(() => {
    return () => {
      teardownMediaPipeline();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teardownMediaPipeline = useCallback(() => {
    if (visualiserIntervalRef.current !== null) {
      window.clearInterval(visualiserIntervalRef.current);
      visualiserIntervalRef.current = null;
    }
    if (elapsedIntervalRef.current !== null) {
      window.clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    if (hardStopTimerRef.current !== null) {
      window.clearTimeout(hardStopTimerRef.current);
      hardStopTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        /* no-op */
      }
    }
    recorderRef.current = null;
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          /* no-op */
        }
      }
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    chunksRef.current = [];
    setAmplitude(0);
    setElapsedMs(0);
  }, []);

  const startRecording = useCallback(async () => {
    if (disabled) return;
    if (state.kind === "recording" || state.kind === "requesting" || state.kind === "processing") {
      return;
    }
    if (state.kind === "unsupported") return;

    setState({ kind: "requesting" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Chrome returns "Permission denied", Firefox "The request is not allowed..."
      const isDenied = /denied|not allowed|permission/i.test(msg);
      setState({ kind: isDenied ? "denied" : "idle" });
      if (!isDenied) {
        toast({
          title: "Mic unavailable",
          description: msg,
          variant: "destructive",
        });
      }
      return;
    }

    mediaStreamRef.current = stream;

    // Wire the visualiser. Separate AudioContext so the MediaRecorder's
    // stream handling isn't coupled to us.
    try {
      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      }
    } catch {
      // Visualiser is nice-to-have, not load-bearing. Fall through.
    }

    const mime = pickMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    });

    recorder.addEventListener("stop", () => {
      void handleStop();
    });

    recorder.addEventListener("error", (e) => {
      const msg = mediaRecorderErrorMessage(e);
      toast({ title: "Recording failed", description: msg, variant: "destructive" });
      teardownMediaPipeline();
      setState({ kind: "idle" });
    });

    // 1-second timeslices give us chunks to salvage if the user's tab
    // dies mid-recording.
    recorder.start(1000);

    const now = Date.now();
    startedAtRef.current = now;
    setElapsedMs(0);
    setState({ kind: "recording", startedAt: now });

    elapsedIntervalRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 100);

    visualiserIntervalRef.current = window.setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255;
      // Exaggerate slightly so quiet rooms still show life. Clamp at 1.
      setAmplitude(Math.min(1, avg * 1.8));
    }, VISUALISER_INTERVAL_MS);

    hardStopTimerRef.current = window.setTimeout(() => {
      stopRecording(true);
    }, MAX_RECORDING_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, disabled, toast, teardownMediaPipeline]);

  const stopRecording = useCallback(
    (hitHardCap = false) => {
      if (state.kind !== "recording") return;
      if (hardStopTimerRef.current !== null) {
        window.clearTimeout(hardStopTimerRef.current);
        hardStopTimerRef.current = null;
      }
      if (elapsedIntervalRef.current !== null) {
        window.clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      if (visualiserIntervalRef.current !== null) {
        window.clearInterval(visualiserIntervalRef.current);
        visualiserIntervalRef.current = null;
      }
      if (hitHardCap) {
        toast({
          title: "Max length reached",
          description: "Stopped at 90 s. Send what you have.",
        });
      }
      try {
        recorderRef.current?.stop();
      } catch {
        /* no-op */
      }
      setState({ kind: "processing" });
    },
    [state.kind, toast],
  );

  const handleStop = useCallback(async () => {
    const recorder = recorderRef.current;
    const chunks = chunksRef.current;
    const durationMs = Date.now() - startedAtRef.current;

    // Release mic + context BEFORE the network round-trip so the mic light
    // turns off fast.
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          /* no-op */
        }
      }
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    analyserRef.current = null;

    if (!recorder || chunks.length === 0 || durationMs < 400) {
      // Too-short tap — probably an accidental brush. Silently reset.
      setState({ kind: "idle" });
      setElapsedMs(0);
      setAmplitude(0);
      return;
    }

    const mime = recorder.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: mime });
    chunksRef.current = [];

    if (blob.size === 0) {
      setState({ kind: "idle" });
      return;
    }

    try {
      const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `hub-feedback.${ext}`, { type: mime });
      const result = await transcribeFeedbackAudio(file);
      onTranscribed({ ...result, duration_ms: durationMs });
      if (!result.transcript) {
        toast({
          title: "No speech detected",
          description: "The clip uploaded, but we couldn't transcribe it. You can still type.",
        });
      }
    } catch (err) {
      toast({
        title: "Couldn't transcribe",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setState({ kind: "idle" });
      setElapsedMs(0);
      setAmplitude(0);
    }
  }, [onTranscribed, toast]);

  // Pointer event handlers are the canonical press-and-hold surface on
  // both touch + mouse.
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (state.kind === "recording") {
        // Treat as toggle for keyboard users — rare path.
        stopRecording();
        return;
      }
      void startRecording();
    },
    [startRecording, stopRecording, state.kind],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (state.kind === "recording") {
        stopRecording();
      }
    },
    [stopRecording, state.kind],
  );

  const onPointerCancel = useCallback(() => {
    if (state.kind === "recording") stopRecording();
  }, [stopRecording, state.kind]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === " " || e.key === "Enter") {
        if (e.repeat) return;
        e.preventDefault();
        if (state.kind === "recording") stopRecording();
        else void startRecording();
      }
    },
    [startRecording, stopRecording, state.kind],
  );

  // Visual state ───────────────────────────────────────────────────────────
  const isRecording = state.kind === "recording";
  const isBusy = state.kind === "requesting" || state.kind === "processing";
  const isDenied = state.kind === "denied";
  const isUnsupported = state.kind === "unsupported";
  const disabledBtn = disabled || isUnsupported || isDenied;

  const label = (() => {
    if (isUnsupported) return "Voice not supported in this browser";
    if (isDenied) return "Mic permission blocked";
    if (state.kind === "requesting") return "Requesting mic…";
    if (isRecording) return `Recording ${formatMs(elapsedMs)} — release to send`;
    if (state.kind === "processing") return "Transcribing…";
    return "Hold to talk";
  })();

  // 0..1 → 1.0..1.35 scale for the pulsing ring
  const ringScale = 1 + amplitude * 0.35;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={label}
        aria-pressed={isRecording}
        onPointerDown={disabledBtn ? undefined : onPointerDown}
        onPointerUp={disabledBtn ? undefined : onPointerUp}
        onPointerCancel={disabledBtn ? undefined : onPointerCancel}
        onPointerLeave={isRecording ? onPointerCancel : undefined}
        onKeyDown={disabledBtn ? undefined : onKeyDown}
        disabled={disabledBtn}
        className={[
          "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border transition",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isRecording
            ? "border-destructive bg-destructive text-destructive-foreground shadow-lg"
            : isBusy
              ? "border-border bg-muted text-muted-foreground"
              : disabledBtn
                ? "border-border bg-muted text-muted-foreground opacity-60"
                : "border-border bg-background text-foreground hover:bg-muted",
        ].join(" ")}
        style={{ touchAction: "none" }} // suppress iOS long-press menu
      >
        {/* Pulsing amplitude ring — only visible while recording */}
        {isRecording && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-[-6px] rounded-full border-2 border-destructive/60"
            style={{
              transform: `scale(${ringScale})`,
              transition: "transform 80ms linear",
            }}
          />
        )}
        {state.kind === "processing" || state.kind === "requesting" ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : isRecording ? (
          <Square className="h-5 w-5" aria-hidden fill="currentColor" />
        ) : isUnsupported || isDenied ? (
          <MicOff className="h-5 w-5" aria-hidden />
        ) : (
          <Mic className="h-5 w-5" aria-hidden />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">
          {label}
        </div>
        {(isRecording || state.kind === "processing") && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={
                isRecording
                  ? "h-full bg-destructive"
                  : "h-full animate-pulse bg-muted-foreground/40"
              }
              style={{
                width: isRecording
                  ? `${Math.min(100, (elapsedMs / MAX_RECORDING_MS) * 100)}%`
                  : "100%",
                transition: "width 120ms linear",
              }}
            />
          </div>
        )}
        {isDenied && (
          <div className="mt-1 text-xs text-muted-foreground">
            Enable the mic in your browser settings and reload.
          </div>
        )}
      </div>
    </div>
  );
}

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function mediaRecorderErrorMessage(event: Event): string {
  const maybeError = "error" in event ? event.error : null;
  if (maybeError instanceof Error && maybeError.message.trim()) return maybeError.message;
  if (typeof maybeError === "string" && maybeError.trim()) return maybeError;
  return "recorder error";
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
