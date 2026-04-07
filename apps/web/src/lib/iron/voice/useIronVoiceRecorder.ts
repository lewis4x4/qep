/**
 * Wave 7 Iron Companion v1.1 — headless voice recorder hook.
 *
 * Wraps getUserMedia + MediaRecorder + AudioContext + AnalyserNode behind
 * a small React hook. Two reasons it's headless (no UI):
 *   1. IronBar wants a single mic button, FlowEngineUI wants per-slot mic
 *      buttons. They render different UI but need the same recording state.
 *   2. Push-to-hold spacebar (start on keydown, stop on keyup) requires
 *      imperative start/stop calls separate from any visual component.
 *
 * The hook also feeds the AnalyserNode output into a SpeakerFingerprint
 * accumulator, so the fingerprint of the just-recorded utterance is
 * available immediately when stop() resolves. Iron compares it to the
 * canonical fingerprint stored in the conversation state.
 *
 * Browser compat: same MediaRecorder approach as the existing
 * VoiceRecorder.tsx — works on Safari, Chrome, Firefox, Edge. iOS requires
 * HTTPS + a user gesture to grant getUserMedia (handled by mounting in
 * direct response to a button click).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createFingerprintAccumulator,
  FINGERPRINT_FFT_SIZE,
  type FingerprintAccumulator,
  type SpeakerFingerprint,
} from "./voiceFingerprint";

export type IronRecorderState = "idle" | "requesting" | "recording" | "processing" | "error";

export interface IronVoiceRecorderApi {
  state: IronRecorderState;
  /** 0..1 RMS level. Updated ~30Hz while recording. */
  level: number;
  errorMessage: string | null;
  start: () => Promise<void>;
  /** Stops the recording and returns the audio + fingerprint. Resolves to null on failure. */
  stop: () => Promise<{ blob: Blob; fileName: string; fingerprint: SpeakerFingerprint } | null>;
  cancel: () => void;
}

interface PendingRecording {
  resolve: (value: { blob: Blob; fileName: string; fingerprint: SpeakerFingerprint } | null) => void;
}

function pickMimeType(): { mimeType: string; fileName: string } {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", fileName: "iron-utterance.webm" },
    { mimeType: "audio/webm", fileName: "iron-utterance.webm" },
    { mimeType: "audio/mp4", fileName: "iron-utterance.m4a" },
    { mimeType: "audio/ogg;codecs=opus", fileName: "iron-utterance.ogg" },
  ];
  for (const c of candidates) {
    const ok =
      typeof MediaRecorder !== "undefined" &&
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(c.mimeType);
    if (ok) return c;
  }
  return { mimeType: "", fileName: "iron-utterance.webm" };
}

export function useIronVoiceRecorder(): IronVoiceRecorderApi {
  const [state, setState] = useState<IronRecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const accumulatorRef = useRef<FingerprintAccumulator | null>(null);
  const pendingRef = useRef<PendingRecording | null>(null);
  const mimeRef = useRef<string>("");
  const fileNameRef = useRef<string>("iron-utterance.webm");

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        /* noop */
      }
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        /* noop */
      }
      analyserRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    accumulatorRef.current = null;
    setLevel(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (state === "recording" || state === "requesting") return;
    setErrorMessage(null);
    setState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Audio analysis path
      // deno-lint-ignore no-explicit-any
      const AudioCtor: typeof AudioContext | undefined =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioCtor) {
        const audioCtx = new AudioCtor();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = FINGERPRINT_FFT_SIZE;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);
        analyserRef.current = analyser;

        const fftBuffer = new Float32Array(analyser.frequencyBinCount);
        const accumulator = createFingerprintAccumulator();
        accumulatorRef.current = accumulator;

        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getFloatFrequencyData(fftBuffer);
          // Convert dBFS to a 0..1 magnitude approximation for fingerprint
          const linearBuffer = new Float32Array(fftBuffer.length);
          for (let i = 0; i < fftBuffer.length; i++) {
            // dBFS is typically -100..0; map to 0..1
            linearBuffer[i] = Math.max(0, (fftBuffer[i] + 100) / 100);
          }
          accumulator.add(linearBuffer);

          // RMS level for the UI bar
          let sum = 0;
          for (let i = 0; i < linearBuffer.length; i++) sum += linearBuffer[i];
          const avgLevel = sum / linearBuffer.length;
          setLevel(Math.min(1, avgLevel * 1.6));

          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }

      // MediaRecorder path
      const { mimeType, fileName } = pickMimeType();
      mimeRef.current = mimeType;
      fileNameRef.current = fileName;
      chunksRef.current = [];
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
        const fingerprint = accumulatorRef.current?.toFingerprint() ?? {
          bands: new Float32Array(8),
          sampleCount: 0,
        };
        cleanup();
        setState("idle");
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) {
          if (blob.size === 0) {
            pending.resolve(null);
          } else {
            pending.resolve({ blob, fileName: fileNameRef.current, fingerprint });
          }
        }
      };

      recorder.start();
      setState("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied";
      setErrorMessage(message);
      setState("error");
      cleanup();
    }
  }, [state, cleanup]);

  const stop = useCallback((): Promise<{ blob: Blob; fileName: string; fingerprint: SpeakerFingerprint } | null> => {
    if (!recorderRef.current || recorderRef.current.state === "inactive") {
      return Promise.resolve(null);
    }
    setState("processing");
    return new Promise((resolve) => {
      pendingRef.current = { resolve };
      recorderRef.current?.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      // Resolve the pending promise with null so the caller doesn't hang
      const pending = pendingRef.current;
      pendingRef.current = null;
      try {
        recorderRef.current.stop();
      } catch {
        /* noop */
      }
      pending?.resolve(null);
    }
    cleanup();
    setState("idle");
  }, [cleanup]);

  return { state, level, errorMessage, start, stop, cancel };
}
