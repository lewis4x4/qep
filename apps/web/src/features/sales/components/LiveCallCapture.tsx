import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mic, MicOff, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const CHUNK_MS = 10_000;
const MIN_CHUNK_BYTES = 512;

type LiveCallState =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "finalizing"
  | "saved"
  | "error";

interface StreamStartResponse {
  session_id: string;
  client_session_id: string;
  status: string;
}

interface StreamChunkResponse {
  session_id: string;
  chunk_index: number;
  client_chunk_id: string | null;
  status: "done" | "processing" | "skipped";
  duplicate: boolean;
  transcript: string;
}

interface StreamFinalizeResponse {
  capture_id: string;
  crm_activity_id: string | null;
  transcript: string;
}

interface FailedChunk {
  blob: Blob;
  mimeType: string;
}

export interface LiveCallCaptureProps {
  companyId: string;
  companyName: string;
  onSaved: (result: {
    captureId: string;
    crmActivityId: string | null;
    transcript: string;
  }) => void;
  onCancel: () => void;
}

function makeClientSessionId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `live-call-${random}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read audio chunk."));
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Audio chunk read returned an invalid result."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "audio/webm";
}

async function postStream<T>(payload: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in before using live call capture.");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-capture-stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof body.error === "string" ? body.error : `voice-capture-stream returned ${res.status}`;
    throw new Error(error);
  }
  return body as T;
}

export function LiveCallCapture({ companyId, companyName, onSaved, onCancel }: LiveCallCaptureProps) {
  const [state, setState] = useState<LiveCallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [chunkInFlight, setChunkInFlight] = useState(0);
  const [savedChunks, setSavedChunks] = useState(0);
  const [transcript, setTranscript] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const clientSessionIdRef = useRef(makeClientSessionId());
  const sessionIdRef = useRef<string | null>(null);
  const chunkPromisesRef = useRef<Promise<void>[]>([]);
  const failedChunksRef = useRef<Map<number, FailedChunk>>(new Map());
  const transcriptChunksRef = useRef<Map<number, string>>(new Map());

  const orderedTranscript = useCallback(() => {
    return [...transcriptChunksRef.current.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, text]) => text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }, []);

  const refreshTranscript = useCallback(() => {
    setTranscript(orderedTranscript());
  }, [orderedTranscript]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const resetClientSession = useCallback(() => {
    clientSessionIdRef.current = makeClientSessionId();
    sessionIdRef.current = null;
    chunkPromisesRef.current = [];
    failedChunksRef.current.clear();
    transcriptChunksRef.current.clear();
    chunkIndexRef.current = 0;
  }, []);

  useEffect(
    () => () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // Recorder may already be inactive during unmount.
      }
      stopTracks();
    },
    [stopTracks],
  );

  const uploadChunk = useCallback(
    async (chunkIndex: number, blob: Blob, mimeType: string) => {
      if (!sessionIdRef.current || blob.size < MIN_CHUNK_BYTES) return;
      setChunkInFlight((count) => count + 1);
      try {
        const audioBase64 = await blobToBase64(blob);
        const response = await postStream<StreamChunkResponse>({
          action: "chunk",
          sessionId: sessionIdRef.current,
          clientSessionId: clientSessionIdRef.current,
          clientChunkId: `${clientSessionIdRef.current}:chunk:${chunkIndex}`,
          chunkIndex,
          audioBase64,
          mimeType,
          durationMs: CHUNK_MS,
        });
        if (response.status === "processing") {
          throw new Error("Chunk is still processing. Retry before finalizing.");
        }
        failedChunksRef.current.delete(chunkIndex);
        if (response.transcript) {
          transcriptChunksRef.current.set(chunkIndex, response.transcript);
          refreshTranscript();
        }
        setSavedChunks(transcriptChunksRef.current.size);
      } catch (err) {
        failedChunksRef.current.set(chunkIndex, { blob, mimeType });
        setError(err instanceof Error ? err.message : "Chunk upload failed.");
      } finally {
        setChunkInFlight((count) => Math.max(0, count - 1));
      }
    },
    [refreshTranscript],
  );

  const queueChunk = useCallback(
    (blob: Blob, mimeType: string) => {
      if (blob.size < MIN_CHUNK_BYTES) return;
      const chunkIndex = chunkIndexRef.current;
      chunkIndexRef.current = chunkIndex + 1;
      const promise = uploadChunk(chunkIndex, blob, mimeType);
      chunkPromisesRef.current.push(promise);
    },
    [uploadChunk],
  );

  const start = useCallback(async () => {
    if (state === "recording" || state === "starting") return;
    setState("starting");
    setError(null);
    resetClientSession();
    setSavedChunks(0);
    setTranscript("");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError("Microphone isn't available in this browser.");
      return;
    }

    try {
      const started = await postStream<StreamStartResponse>({
        action: "start",
        clientSessionId: clientSessionIdRef.current,
        companyId,
      });
      sessionIdRef.current = started.session_id;

      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = mediaStream;
      const mimeType = pickMime();
      const recorder = new MediaRecorder(mediaStream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          queueChunk(event.data, mimeType);
        }
      });
      recorder.addEventListener("error", () => {
        setState("error");
        setError("Microphone error — stop and try again.");
      });

      recorder.start(CHUNK_MS);
      setState("recording");
    } catch (err) {
      stopTracks();
      setState("error");
      setError(err instanceof Error ? err.message : "Could not start live capture.");
    }
  }, [companyId, queueChunk, resetClientSession, state, stopTracks]);

  const waitForRecorderStop = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      try {
        recorder.requestData();
      } catch {
        // requestData is best-effort; stop still flushes the final chunk.
      }
      recorder.stop();
    });
  }, []);

  const finalize = useCallback(async () => {
    if (!sessionIdRef.current) return;
    setState("finalizing");
    setError(null);
    await Promise.allSettled(chunkPromisesRef.current);
    if (failedChunksRef.current.size > 0) {
      setState("error");
      setError("Some chunks failed to upload. Retry failed chunks before finalizing.");
      return;
    }

    const response = await postStream<StreamFinalizeResponse>({
      action: "finalize",
      sessionId: sessionIdRef.current,
      clientSessionId: clientSessionIdRef.current,
      expectedChunkCount: chunkIndexRef.current,
      durationSeconds: Math.ceil((chunkIndexRef.current * CHUNK_MS) / 1000),
    });
    setState("saved");
    resetClientSession();
    onSaved({
      captureId: response.capture_id,
      crmActivityId: response.crm_activity_id,
      transcript: response.transcript,
    });
  }, [onSaved, resetClientSession]);

  const stopAndFinalize = useCallback(async () => {
    if (state !== "recording") return;
    setState("stopping");
    setError(null);
    try {
      await waitForRecorderStop();
      stopTracks();
      await finalize();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Could not finalize live capture.");
    }
  }, [finalize, state, stopTracks, waitForRecorderStop]);

  const retryFailedChunks = useCallback(async () => {
    const failed = [...failedChunksRef.current.entries()];
    if (failed.length === 0) return;
    setError(null);
    await Promise.allSettled(
      failed.map(([chunkIndex, failedChunk]) =>
        uploadChunk(chunkIndex, failedChunk.blob, failedChunk.mimeType),
      ),
    );
    if (failedChunksRef.current.size === 0) {
      setError(null);
    }
  }, [uploadChunk]);

  const cancel = useCallback(async () => {
    try {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // best-effort cancellation
    }
    stopTracks();
    if (sessionIdRef.current) {
      void postStream({
        action: "cancel",
        sessionId: sessionIdRef.current,
        clientSessionId: clientSessionIdRef.current,
      }).catch(() => undefined);
    }
    resetClientSession();
    onCancel();
  }, [onCancel, resetClientSession, stopTracks]);

  const failedCount = failedChunksRef.current.size;
  const statusLabel = useMemo(() => {
    switch (state) {
      case "starting":
        return "Opening mic…";
      case "recording":
        return "Recording";
      case "stopping":
        return "Stopping recorder…";
      case "finalizing":
        return "Finalizing receipt…";
      case "saved":
        return "Saved";
      case "error":
        return "Needs attention";
      default:
        return "Ready";
    }
  }, [state]);

  const busy = state === "starting" || state === "stopping" || state === "finalizing";

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-qep-orange">
            Live call capture
          </p>
          <h2 className="mt-1 text-lg font-black text-foreground">{companyName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Record with consent before using live call capture. Chunks upload every ~10 seconds.
            Do not close this sheet until finalizing completes.
          </p>
        </div>
        <button
          type="button"
          onClick={cancel}
          className="rounded-full p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          aria-label="Close live capture"
          disabled={busy}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-[hsl(var(--card))] p-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
              state === "recording"
                ? "border-red-400/40 bg-red-500/10 text-red-200"
                : state === "saved"
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-white/[0.04] text-muted-foreground",
            )}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "saved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {statusLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            {savedChunks} chunk{savedChunks === 1 ? "" : "s"} transcribed
            {chunkInFlight > 0 ? ` · ${chunkInFlight} uploading` : ""}
          </span>
        </div>

        {error ? (
          <div role="alert" className="mt-3 flex gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {transcript ? (
          <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Transcript so far
            </p>
            <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
              {transcript}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {state === "recording" ? (
            <Button type="button" variant="outline" onClick={stopAndFinalize} className="gap-2">
              <MicOff className="h-4 w-4" />
              Stop & save call
            </Button>
          ) : (
            <Button
              type="button"
              onClick={start}
              disabled={busy || state === "saved" || (state === "error" && Boolean(sessionIdRef.current))}
              className="gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              Start live capture
            </Button>
          )}
          {failedCount > 0 ? (
            <Button type="button" variant="outline" onClick={retryFailedChunks} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Retry failed chunks ({failedCount})
            </Button>
          ) : null}
          {failedCount === 0 && state === "error" && sessionIdRef.current ? (
            <Button type="button" variant="outline" onClick={finalize} className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Finalize saved chunks
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
