/**
 * DecisionRoomLiveCoaching — Phase 6. A mic toggle on the simulator
 * that captures ~20-second audio chunks during a live rep call, posts
 * each to decision-room-voice-chunk for transcription + stakeholder
 * extraction, and materializes detected humans as "live ghost" chips
 * alongside the canvas.
 *
 * Detected stakeholders accumulate across chunks (dedup by lowercase
 * name). Each one has a one-click "Save as contact" that inserts into
 * crm_contacts, invalidates the relationship query, and lights the
 * seat on the canvas as the simulator re-builds.
 *
 * MediaRecorder lives for the duration of the session. Chunks are
 * emitted every CHUNK_MS; each upload is fire-and-forget from the UI's
 * perspective, merged into state on response. The rep can stop any
 * time — no save-on-stop data loss because each chunk is independently
 * persisted via its stakeholder detections once the rep confirms.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Loader2,
  Mic,
  MicOff,
  UserPlus,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { DeckSurface } from "./command-deck";

interface Props {
  dealId: string;
  companyId: string | null;
  companyName: string | null;
  dealName: string | null;
}

type Archetype =
  | "champion"
  | "economic_buyer"
  | "operations"
  | "procurement"
  | "operator"
  | "maintenance"
  | "executive_sponsor";

interface DetectedStakeholder {
  name: string;
  archetypeHint: Archetype | null;
  confidence: "high" | "medium" | "low";
  snippet: string;
  firstSeenAt: string;
}

interface ChunkResponse {
  transcript: string;
  detectedStakeholders: Array<{
    name: string;
    archetypeHint: Archetype | null;
    confidence: "high" | "medium" | "low";
    snippet: string;
  }>;
  chunkIndex: number;
}

const CHUNK_MS = 20_000;
const MIN_CHUNK_BYTES = 2_000;
const ARCHETYPE_LABELS: Record<Archetype, string> = {
  champion: "Champion",
  economic_buyer: "Economic Buyer",
  operations: "Operations",
  procurement: "Procurement",
  operator: "Operator",
  maintenance: "Maintenance",
  executive_sponsor: "Executive Sponsor",
};

function archetypeTone(archetype: Archetype | null): string {
  if (!archetype) return "border-white/15 bg-white/[0.03] text-white/80";
  switch (archetype) {
    case "economic_buyer":
      return "border-qep-orange/50 bg-qep-orange/10 text-qep-orange";
    case "operations":
      return "border-amber-400/40 bg-amber-400/[0.08] text-amber-200";
    case "champion":
      return "border-emerald-400/40 bg-emerald-400/[0.06] text-emerald-200";
    default:
      return "border-qep-live/40 bg-qep-live/[0.08] text-qep-live";
  }
}

function confidenceLabel(c: DetectedStakeholder["confidence"]): string {
  if (c === "high") return "confident";
  if (c === "medium") return "likely";
  return "maybe";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("blob read failed"));
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("blob read returned non-string"));
        return;
      }
      // result is a data URL "data:<mime>;base64,<payload>"
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "audio/webm";
}

async function postChunk(input: {
  dealId: string;
  audioBase64: string;
  mimeType: string;
  chunkIndex: number;
  priorTranscript: string;
  companyName: string | null;
  dealName: string | null;
}): Promise<ChunkResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-voice-chunk`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(input),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `voice-chunk returned ${res.status}`);
  return payload as ChunkResponse;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function DecisionRoomLiveCoaching({ dealId, companyId, companyName, dealName }: Props) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<"idle" | "starting" | "listening" | "processing" | "stopped">("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [stakeholders, setStakeholders] = useState<DetectedStakeholder[]>([]);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [savingName, setSavingName] = useState<string | null>(null);
  const [chunkInFlight, setChunkInFlight] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const transcriptRef = useRef("");
  const stoppingRef = useRef(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Keep transcriptRef in sync so async chunk handlers see the latest.
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const handleChunkBlob = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (blob.size < MIN_CHUNK_BYTES) return;
      const idx = chunkIndexRef.current;
      chunkIndexRef.current = idx + 1;
      setChunkInFlight((n) => n + 1);
      try {
        const audioBase64 = await blobToBase64(blob);
        const response = await postChunk({
          dealId,
          audioBase64,
          mimeType,
          chunkIndex: idx,
          priorTranscript: transcriptRef.current.slice(-3_500),
          companyName,
          dealName,
        });
        if (response.transcript) {
          setTranscript((prev) =>
            prev.length === 0 ? response.transcript : `${prev} ${response.transcript}`.trim(),
          );
        }
        if (response.detectedStakeholders.length > 0) {
          setStakeholders((prev) => {
            const seen = new Set(prev.map((s) => s.name.toLowerCase()));
            const fresh: DetectedStakeholder[] = [];
            for (const s of response.detectedStakeholders) {
              const key = s.name.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              fresh.push({ ...s, firstSeenAt: new Date().toISOString() });
            }
            return [...prev, ...fresh];
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "chunk upload failed");
      } finally {
        setChunkInFlight((n) => Math.max(0, n - 1));
      }
    },
    [dealId, companyName, dealName],
  );

  const stop = useCallback(() => {
    if (!recording) return;
    stoppingRef.current = true;
    setStatus("processing");
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      // ignore — state may already be inactive
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
  }, [recording]);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    },
    [],
  );

  const start = useCallback(async () => {
    if (recording) return;
    setError(null);
    setStatus("starting");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Microphone isn't available in this browser.");
      setStatus("idle");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMime();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          void handleChunkBlob(event.data, mimeType);
        }
      });
      recorder.addEventListener("stop", () => {
        setStatus((prev) => (prev === "processing" ? "stopped" : "idle"));
        stoppingRef.current = false;
      });
      recorder.addEventListener("error", (event) => {
        console.error("[decision-room-live] MediaRecorder error", event);
        setError("Microphone error — stop and try again.");
      });

      chunkIndexRef.current = 0;
      setTranscript("");
      setStakeholders([]);
      setSavedNames(new Set());
      recorder.start(CHUNK_MS);
      setRecording(true);
      setStatus("listening");
    } catch (err) {
      const message = err instanceof Error ? err.message : "mic permission denied";
      setError(message);
      setStatus("idle");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [recording, handleChunkBlob]);

  async function handleSaveContact(stakeholder: DetectedStakeholder) {
    if (!companyId) {
      toast({
        title: "No company on this deal",
        description: "Attach a company before saving live-detected contacts.",
        variant: "destructive",
      });
      return;
    }
    if (savingName) return;
    setSavingName(stakeholder.name);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { firstName, lastName } = splitName(stakeholder.name);
      const { error: insertErr } = await supabase.from("crm_contacts").insert({
        first_name: firstName || stakeholder.name,
        last_name: lastName || "(unknown)",
        primary_company_id: companyId,
        assigned_rep_id: user?.id ?? null,
        metadata: {
          decision_room_live: {
            source: "live_mic",
            archetype_hint: stakeholder.archetypeHint,
            confidence: stakeholder.confidence,
            snippet: stakeholder.snippet,
            deal_id: dealId,
            first_seen_at: stakeholder.firstSeenAt,
          },
        },
      });
      if (insertErr) throw insertErr;
      setSavedNames((prev) => new Set([...prev, stakeholder.name]));
      toast({
        title: "Saved to CRM",
        description: `${stakeholder.name} added. The decision room will refresh.`,
      });
      await queryClient.invalidateQueries({
        queryKey: ["decision-room-simulator", dealId, "relationship"],
        refetchType: "active",
      });
    } catch (err) {
      toast({
        title: "Couldn't save contact",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingName(null);
    }
  }

  const statusChip = useMemo(() => {
    switch (status) {
      case "listening":
        return {
          label: "Listening",
          cls: "border-qep-live/50 bg-qep-live/10 text-qep-live",
          icon: <Radio className="h-3 w-3 animate-pulse" />,
        };
      case "starting":
        return {
          label: "Opening mic…",
          cls: "border-amber-400/40 bg-amber-400/10 text-amber-200",
          icon: <Loader2 className="h-3 w-3 animate-spin" />,
        };
      case "processing":
        return {
          label: "Processing final chunks",
          cls: "border-amber-400/40 bg-amber-400/10 text-amber-200",
          icon: <Loader2 className="h-3 w-3 animate-spin" />,
        };
      case "stopped":
        return {
          label: "Session complete",
          cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
          icon: <CheckCircle2 className="h-3 w-3" />,
        };
      default:
        return null;
    }
  }, [status]);

  return (
    <DeckSurface className="border-qep-live/30 bg-qep-live/[0.04] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-qep-live" aria-hidden />
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-live">
            Live coaching — mic-on
          </h2>
          {statusChip ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                statusChip.cls,
              )}
            >
              {statusChip.icon}
              {statusChip.label}
            </span>
          ) : null}
          {chunkInFlight > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {chunkInFlight} chunk{chunkInFlight === 1 ? "" : "s"} transcribing
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {recording ? (
            <Button type="button" size="sm" variant="outline" onClick={stop} className="gap-1.5">
              <MicOff className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={start} className="gap-1.5">
              <CircleDot className="h-3.5 w-3.5" />
              {status === "stopped" ? "Start a new session" : "Start listening"}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Capture the room while you're on the call. Every ~20 seconds we transcribe a chunk and surface any new
        stakeholder we hear named. Nothing saves to CRM without your click.
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {stakeholders.length > 0 ? (
        <section className="mt-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Detected this session
          </h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {stakeholders.map((s) => {
              const saved = savedNames.has(s.name);
              const saving = savingName === s.name;
              return (
                <li
                  key={s.name}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border p-3",
                    archetypeTone(s.archetypeHint),
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.archetypeHint
                          ? ARCHETYPE_LABELS[s.archetypeHint]
                          : "Role unclear"}{" "}
                        · {confidenceLabel(s.confidence)}
                      </p>
                      {s.snippet ? (
                        <p className="mt-1 italic text-[11px] text-muted-foreground">"{s.snippet}"</p>
                      ) : null}
                    </div>
                    {saved ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Saved
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving || !companyId}
                        onClick={() => handleSaveContact(s)}
                        className="h-7 gap-1 text-[11px]"
                      >
                        {saving ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Saving
                          </>
                        ) : (
                          <>
                            <UserPlus className="h-3 w-3" />
                            Save
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {transcript ? (
        <details className="mt-4 rounded-md border border-qep-deck-rule bg-black/20 p-2">
          <summary className="cursor-pointer text-[11px] font-medium text-foreground/90">
            Transcript so far ({transcript.length} chars)
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/80">{transcript}</p>
        </details>
      ) : null}
    </DeckSurface>
  );
}
