import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  Check,
  X,
  Search,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { useCustomers } from "../hooks/useCustomers";
import { matchesRepCustomerSearch } from "../lib/customer-search";
import {
  matchCustomerInTranscript,
  type CustomerMatchResult,
} from "../lib/voice-customer-matcher";
import type { RepCustomer } from "../lib/types";
import { supabase } from "@/lib/supabase";
import { ironTranscribe } from "@/lib/iron/voice/api";

type CaptureState =
  | "starting"
  | "recording"
  | "processing"
  | "review"
  | "saving"
  | "error";

const MAX_DURATION_SECONDS = 60;
const AUTO_ACCEPT_CONFIDENCE = 0.7;
const WAVEFORM_BARS = 32;

export interface SmartVoiceCaptureProps {
  /** Called after the capture has been saved successfully. */
  onComplete: () => void;
  /** Called when the rep cancels before saving. */
  onCancel?: () => void;
  /** Optional pre-attached customer (skips the AI match + review confirm). */
  presetCustomerId?: string;
}

export function SmartVoiceCapture({
  onComplete,
  onCancel,
  presetCustomerId,
}: SmartVoiceCaptureProps) {
  const { allCustomers } = useCustomers();
  const [state, setState] = useState<CaptureState>("starting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [levels, setLevels] = useState<number[]>(
    Array(WAVEFORM_BARS).fill(0.05),
  );
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState("");
  const [matchResult, setMatchResult] = useState<CustomerMatchResult | null>(
    null,
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    presetCustomerId ?? null,
  );
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  // Refs we manage outside React state to avoid re-render churn.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const selectedCustomer = useMemo<RepCustomer | null>(() => {
    if (!selectedCustomerId) return null;
    return (
      allCustomers.find((c) => c.customer_id === selectedCustomerId) ?? null
    );
  }, [allCustomers, selectedCustomerId]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return allCustomers.slice(0, 12);
    return allCustomers
      .filter((c) => matchesRepCustomerSearch(c, customerSearch))
      .slice(0, 12);
  }, [allCustomers, customerSearch]);

  // ── Cleanup helper ─────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // ── Live waveform sampling ─────────────────────────────────────
  const sampleLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    // RMS-style level — sum of deviation from midpoint, normalized 0..1.
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.min(1, Math.sqrt(sum / data.length) * 2.5);
    setLevels((prev) => {
      const next = prev.slice(1);
      next.push(Math.max(0.05, level));
      return next;
    });
    animationFrameRef.current = requestAnimationFrame(sampleLevel);
  }, []);

  // ── Start recording (on mount) ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Audio analyser for waveform
        const AudioCtor: typeof AudioContext =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audioContext = new AudioCtor();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        animationFrameRef.current = requestAnimationFrame(sampleLevel);

        // MediaRecorder
        const mimeType = MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";
        const recorder = new MediaRecorder(stream, { mimeType });
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          setAudioBlob(blob);
        };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;
        setState("recording");

        // Timer
        timerRef.current = window.setInterval(() => {
          setDuration((d) => {
            if (d + 1 >= MAX_DURATION_SECONDS) {
              stopRecording();
              return MAX_DURATION_SECONDS;
            }
            return d + 1;
          });
        }, 1000);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message.includes("Permission")
              ? "Microphone access was denied. Enable mic permission and try again."
              : err.message
            : "Microphone unavailable.";
        setErrorMsg(message);
        setState("error");
      }
    }
    void start();
    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stop recording — moves into processing ─────────────────────
  function stopRecording() {
    if (state !== "recording") return;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setState("processing");
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  // ── Once we have the blob, transcribe + match in parallel ──────
  useEffect(() => {
    if (state !== "processing" || !audioBlob) return;
    let cancelled = false;
    async function process(blob: Blob) {
      try {
        const ext = blob.type.includes("mp4") ? ".mp4" : ".webm";
        const fileName = `voice-${Date.now()}${ext}`;
        const result = await ironTranscribe(blob, fileName);
        if (cancelled) return;
        const text = result.transcript ?? "";
        setTranscript(text);
        if (!presetCustomerId) {
          const match = matchCustomerInTranscript(text, allCustomers);
          setMatchResult(match);
          if (match.confidence >= AUTO_ACCEPT_CONFIDENCE && match.top) {
            setSelectedCustomerId(match.top.customer_id);
          }
        }
        setState("review");
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Transcription failed.";
        setErrorMsg(message);
        setState("error");
      }
    }
    void process(audioBlob);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, audioBlob]);

  // ── Save: upload audio + insert row ────────────────────────────
  async function handleSave() {
    if (!audioBlob) return;
    setState("saving");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const ext = audioBlob.type.includes("mp4") ? ".mp4" : ".webm";
      const fileName = `${user.id}/voice-note-${Date.now()}${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("voice-recordings")
        .upload(fileName, audioBlob, { contentType: audioBlob.type });
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await supabase.from("voice_captures").insert({
        user_id: user.id,
        audio_storage_path: fileName,
        duration_seconds: duration,
        transcript: transcript || null,
        sync_status: "transcribed",
        customer_id: selectedCustomerId,
      });
      if (insertErr) throw insertErr;
      onComplete();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save voice note.";
      setErrorMsg(message);
      setState("error");
    }
  }

  function handleCancel() {
    cleanup();
    onCancel?.();
  }

  // ── Render branches ────────────────────────────────────────────
  if (state === "error") {
    return (
      <div className="space-y-4 p-2" data-testid="smart-voice-capture-error">
        <div className="flex items-start gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Something went wrong
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {errorMsg ?? "Unknown error."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCancel}
          className="w-full rounded-xl border border-white/10 bg-card py-3 text-sm font-semibold text-foreground"
        >
          Close
        </button>
      </div>
    );
  }

  if (state === "starting" || state === "recording") {
    return (
      <div
        className="space-y-5 p-2"
        data-testid="smart-voice-capture-recording"
        data-recording-state={state}
      >
        <div className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-qep-orange">
            {state === "starting" ? "Starting microphone…" : "Recording"}
          </p>
          <p className="mt-1 text-5xl font-mono font-extrabold tabular-nums text-foreground">
            {String(Math.floor(duration / 60)).padStart(1, "0")}:
            {String(duration % 60).padStart(2, "0")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            JARVIS is listening for the customer name automatically.
          </p>
        </div>

        {/* Real waveform from audio levels */}
        <div className="flex h-20 items-center justify-center gap-[3px]">
          {levels.map((level, i) => (
            <div
              key={i}
              className="w-1.5 rounded-full bg-qep-orange"
              style={{
                height: `${Math.max(8, level * 80)}px`,
                opacity: state === "recording" ? 0.9 : 0.35,
                transition: "height 80ms ease-out",
              }}
            />
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={stopRecording}
            disabled={state !== "recording"}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-6 py-4 text-base font-bold text-white shadow-lg active:scale-[0.98] disabled:opacity-50"
            aria-label="Stop recording"
          >
            <Square className="h-5 w-5" />
            Stop & review
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground active:scale-[0.98]"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (state === "processing") {
    return (
      <div className="space-y-4 p-2" data-testid="smart-voice-capture-processing">
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="h-10 w-10 animate-spin text-qep-orange" />
          <p className="text-sm font-semibold text-foreground">
            Transcribing & matching customer…
          </p>
          <p className="text-xs text-muted-foreground">
            Captured {duration}s · running JARVIS extractors
          </p>
        </div>
      </div>
    );
  }

  // ── Review state ──────────────────────────────────────────────
  const showAlternates =
    matchResult && matchResult.confidence < AUTO_ACCEPT_CONFIDENCE;

  return (
    <div className="space-y-4 p-2" data-testid="smart-voice-capture-review">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20">
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Captured</p>
            <p className="text-[11px] text-muted-foreground">
              {duration}s · {Math.ceil((audioBlob?.size ?? 0) / 1024)} KB
            </p>
          </div>
        </div>
        {state === "saving" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Customer block */}
      {showCustomerPicker ? (
        <CustomerPickerInline
          customers={filteredCustomers}
          search={customerSearch}
          setSearch={setCustomerSearch}
          onPick={(id) => {
            setSelectedCustomerId(id);
            setShowCustomerPicker(false);
            setCustomerSearch("");
          }}
          onClose={() => setShowCustomerPicker(false)}
        />
      ) : (
        <CustomerReviewBlock
          selectedCustomer={selectedCustomer}
          matchResult={matchResult}
          showAlternates={!!showAlternates && !selectedCustomer}
          onPickAlternate={(id) => setSelectedCustomerId(id)}
          onOpenPicker={() => setShowCustomerPicker(true)}
          onClearSelection={() => setSelectedCustomerId(null)}
        />
      )}

      {/* Transcript block */}
      <section className="rounded-2xl border border-white/[0.06] bg-card p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          What you said
        </p>
        {transcript ? (
          <p className="mt-2 text-sm leading-relaxed text-foreground/95">
            {transcript}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            (No transcript — saving audio only.)
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleCancel}
          disabled={state === "saving"}
          className="rounded-2xl border border-white/[0.08] bg-card px-4 py-3 text-sm font-semibold text-muted-foreground active:scale-[0.98] disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={state === "saving"}
          className="rounded-2xl bg-qep-orange px-4 py-3 text-sm font-bold text-white shadow-lg active:scale-[0.98] disabled:opacity-50"
        >
          {state === "saving"
            ? "Saving…"
            : selectedCustomer
              ? `Save to ${selectedCustomer.company_name.split(/\s+/)[0]}`
              : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Sub-component: customer review block ────────────────────────
function CustomerReviewBlock({
  selectedCustomer,
  matchResult,
  showAlternates,
  onPickAlternate,
  onOpenPicker,
  onClearSelection,
}: {
  selectedCustomer: RepCustomer | null;
  matchResult: CustomerMatchResult | null;
  showAlternates: boolean;
  onPickAlternate: (id: string) => void;
  onOpenPicker: () => void;
  onClearSelection: () => void;
}) {
  if (selectedCustomer) {
    const confidencePct = matchResult
      ? Math.round(matchResult.confidence * 100)
      : null;
    return (
      <section
        className="rounded-2xl border border-qep-orange/40 bg-qep-orange/[0.08] p-4"
        data-testid="customer-review-block"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-qep-orange">
          Customer
        </p>
        <p className="mt-1 text-base font-bold text-foreground">
          {selectedCustomer.company_name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {confidencePct !== null && (
            <span className="font-semibold text-qep-orange">
              {confidencePct}% confident
            </span>
          )}
          {matchResult?.reasoning && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{matchResult.reasoning}</span>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenPicker}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-card px-3 py-1.5 text-xs font-semibold text-foreground active:scale-95"
          >
            <Search className="h-3 w-3" />
            Different customer
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-transparent px-3 py-1.5 text-xs font-semibold text-muted-foreground active:scale-95"
          >
            <X className="h-3 w-3" />
            No customer
          </button>
        </div>
      </section>
    );
  }

  if (showAlternates && matchResult) {
    const all = [
      ...(matchResult.top ? [{ customer: matchResult.top, score: 0 }] : []),
      ...matchResult.alternates,
    ];
    return (
      <section
        className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4"
        data-testid="customer-review-block"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
          Not sure which customer
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick one or search the full book.
        </p>
        <div className="mt-3 space-y-2">
          {all.slice(0, 3).map((alt) => (
            <button
              key={alt.customer.customer_id}
              type="button"
              onClick={() => onPickAlternate(alt.customer.customer_id)}
              className="w-full flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-card px-3 py-2.5 text-left active:scale-[0.98]"
            >
              <span className="text-sm font-semibold text-foreground">
                {alt.customer.company_name}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenPicker}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-card px-3 py-1.5 text-xs font-semibold text-foreground active:scale-95"
        >
          <Search className="h-3 w-3" />
          Search the book
        </button>
      </section>
    );
  }

  // No match found at all
  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-card p-4"
      data-testid="customer-review-block"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Customer
      </p>
      <p className="mt-1 text-sm text-foreground">
        No customer name detected.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        You can save without attaching, or pick one manually.
      </p>
      <button
        type="button"
        onClick={onOpenPicker}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-card px-3 py-1.5 text-xs font-semibold text-foreground active:scale-95"
      >
        <Search className="h-3 w-3" />
        Pick a customer
      </button>
    </section>
  );
}

// ── Sub-component: inline customer picker ───────────────────────
function CustomerPickerInline({
  customers,
  search,
  setSearch,
  onPick,
  onClose,
}: {
  customers: RepCustomer[];
  search: string;
  setSearch: (s: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-card p-3"
      data-testid="customer-picker-inline"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Search your book
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-semibold text-qep-orange"
        >
          Cancel
        </button>
      </div>
      <input
        autoFocus
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Customer name…"
        className="w-full rounded-xl bg-background border border-white/[0.08] px-3 py-2 text-sm outline-none focus:border-qep-orange/60"
      />
      <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
        {customers.map((c) => (
          <button
            key={c.customer_id}
            type="button"
            onClick={() => onPick(c.customer_id)}
            className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-white/[0.04] active:bg-white/[0.06]"
          >
            {c.company_name}
            {c.primary_contact_name && (
              <span className="block text-[11px] text-muted-foreground">
                {c.primary_contact_name}
              </span>
            )}
          </button>
        ))}
        {customers.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No matches in your book.
          </p>
        )}
      </div>
    </section>
  );
}
