import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Square,
  Loader2,
  Check,
  X,
  Search,
  AlertCircle,
  ArrowRight,
  Calendar,
  DollarSign,
  Truck,
  Flame,
  Trophy,
  Tag,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useCustomers } from "../hooks/useCustomers";
import { matchesRepCustomerSearch } from "../lib/customer-search";
import {
  matchCustomerInTranscript,
  type CustomerMatchResult,
} from "../lib/voice-customer-matcher";
import type { RepCustomer } from "../lib/types";
import { supabase } from "@/lib/supabase";
import { ironTranscribe } from "@/lib/iron/voice/api";
import { getWorkspaceId, searchCompaniesForPicker } from "../lib/sales-api";
import {
  extractVoiceEntities,
  EMPTY_VOICE_EXTRACTION,
  type VoiceExtractionResult,
} from "@/lib/iron/voice/extract";
import {
  formatExtractedAmount,
  isExtractionEmpty,
  pickSmartActions,
  titleCaseTopic,
  type SmartAction,
} from "../lib/voice-extraction-presentation";

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
  // selectedCustomerName is the display label for the picked customer.
  // When the rep picks a workspace company that isn't in their book,
  // allCustomers.find() returns nothing — we need the name cached here.
  const [selectedCustomerName, setSelectedCustomerName] = useState<string | null>(null);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  // initialPickerSearch — when matcher fails to find a customer in the
  // book, we seed the picker with the most-mentioned name token so the
  // workspace fallback can fire immediately.
  const [initialPickerSearch, setInitialPickerSearch] = useState("");
  const [extraction, setExtraction] = useState<VoiceExtractionResult | null>(
    null,
  );
  const [extractionLoading, setExtractionLoading] = useState(false);
  const [acceptedActionIds, setAcceptedActionIds] = useState<Set<SmartAction["id"]>>(
    () => new Set(["log_activity"]),
  );
  const navigate = useNavigate();

  // Refs we manage outside React state to avoid re-render churn.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const selectedCustomer = useMemo<{ id: string; name: string } | null>(() => {
    if (!selectedCustomerId) return null;
    const inBook = allCustomers.find((c) => c.customer_id === selectedCustomerId);
    if (inBook) return { id: inBook.customer_id, name: inBook.company_name };
    if (selectedCustomerName) return { id: selectedCustomerId, name: selectedCustomerName };
    return { id: selectedCustomerId, name: "Customer" };
  }, [allCustomers, selectedCustomerId, selectedCustomerName]);

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
  // After transcription completes, IRON entity extraction is fired off
  // in the background and lands on the review screen as soon as it
  // resolves. The review UI never blocks on it — fail-open is the rule.
  useEffect(() => {
    if (state !== "processing" || !audioBlob) return;
    let cancelled = false;
    const abortController = new AbortController();
    async function process(blob: Blob) {
      try {
        const ext = blob.type.includes("mp4") ? ".mp4" : ".webm";
        const fileName = `voice-${Date.now()}${ext}`;
        const result = await ironTranscribe(blob, fileName);
        if (cancelled) return;
        const text = result.transcript ?? "";
        setTranscript(text);

        let matchedCustomerId: string | null = null;
        let matchedCustomerName: string | null = null;
        if (!presetCustomerId) {
          const match = matchCustomerInTranscript(text, allCustomers);
          setMatchResult(match);
          if (match.confidence >= AUTO_ACCEPT_CONFIDENCE && match.top) {
            setSelectedCustomerId(match.top.customer_id);
            setSelectedCustomerName(match.top.company_name);
            matchedCustomerId = match.top.customer_id;
            matchedCustomerName = match.top.company_name;
          } else if (match.top) {
            // Seed the picker with the first word of the best (but low-
            // confidence) candidate so the workspace fallback fires on
            // open. "Beacon" hits the workspace even if Beacon Ridge
            // isn't in the rep's book yet.
            const seed = match.top.company_name.split(/\s+/)[0];
            if (seed && seed.length >= 2) setInitialPickerSearch(seed);
          } else {
            // No book match at all — seed the picker with the strongest
            // capitalized word from the transcript so the rep doesn't
            // have to type it themselves.
            const seed = pickSeedFromTranscript(text);
            if (seed) setInitialPickerSearch(seed);
          }
        } else {
          const preset = allCustomers.find((c) => c.customer_id === presetCustomerId);
          if (preset) setSelectedCustomerName(preset.company_name);
          matchedCustomerId = presetCustomerId;
          matchedCustomerName = preset?.company_name ?? null;
        }

        setState("review");

        if (text.trim().length > 0) {
          setExtractionLoading(true);
          void extractVoiceEntities(text, matchedCustomerName ?? undefined, abortController.signal)
            .then((res) => {
              if (cancelled) return;
              setExtraction(res);

              // ── Second-pass matcher: re-run with AI signals folded in.
              // Catches the "I met Frank at Beacon" cases where the
              // first pass missed because Beacon wasn't in the rep's book
              // but Frank IS the primary contact of Beacon Ridge in book.
              //
              // IMPORTANT: this fires 2–3s after the review screen
              // appeared. The rep may have already picked a customer
              // manually in that window — never overwrite their choice.
              // Use functional setters that only fill when state is null.
              let secondPassCustomerId = matchedCustomerId;
              if (!presetCustomerId) {
                const secondMatch = matchCustomerInTranscript(text, allCustomers, {
                  extracted: {
                    customer_mentions: res.customer_mentions,
                    contact_mentions: res.contact_mentions,
                    phone_mentions: res.phone_mentions,
                    location_mentions: res.location_mentions,
                    equipment_mentioned: res.equipment_mentioned,
                  },
                });
                setMatchResult(secondMatch);
                if (
                  secondMatch.confidence >= AUTO_ACCEPT_CONFIDENCE &&
                  secondMatch.top
                ) {
                  const winnerId = secondMatch.top.customer_id;
                  const winnerName = secondMatch.top.company_name;
                  setSelectedCustomerId((current) => current ?? winnerId);
                  setSelectedCustomerName((current) => current ?? winnerName);
                  secondPassCustomerId = winnerId;
                } else if (secondMatch.top) {
                  // Picker seed sharpened by extraction — only set when
                  // the rep hasn't already typed their own search.
                  const seed = res.customer_mentions[0]
                    ?? secondMatch.top.company_name.split(/\s+/)[0];
                  if (seed && seed.length >= 2) {
                    setInitialPickerSearch((current) => current || seed);
                  }
                }
              }

              setAcceptedActionIds(() => {
                const next = new Set<SmartAction["id"]>();
                const actions = pickSmartActions({
                  extraction: res,
                  selectedCustomerId: secondPassCustomerId,
                  selectedDealId: null,
                });
                for (const a of actions) if (a.defaultOn) next.add(a.id);
                return next;
              });
            })
            .catch(() => {
              if (cancelled) return;
              setExtraction({ ...EMPTY_VOICE_EXTRACTION });
            })
            .finally(() => {
              if (!cancelled) setExtractionLoading(false);
            });
        } else {
          setExtraction({ ...EMPTY_VOICE_EXTRACTION });
        }
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
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, audioBlob]);

  // ── Save: upload audio + insert row + fire accepted smart actions ──
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

      const acceptedActions = Array.from(acceptedActionIds);
      // Stamp the extraction + the actions the rep accepted onto
      // extracted_data so the next deploy can wire the not-yet-fully-wired
      // actions (schedule_follow_up, mark_deal_cooling) through to
      // their real backend touchpoints.
      const extractedData = extraction
        ? {
          extraction,
          accepted_actions: acceptedActions,
          source: "smart_voice_capture",
        }
        : {};

      const workspaceId = await getWorkspaceId();
      const { error: insertErr } = await supabase.from("voice_captures").insert({
        user_id: user.id,
        workspace_id: workspaceId,
        audio_storage_path: fileName,
        duration_seconds: duration,
        transcript: transcript || null,
        sync_status: "pending",
        linked_company_id: selectedCustomerId,
        extracted_data: extractedData,
      });
      if (insertErr) throw insertErr;

      // Fire wired side effects after the insert. Open Quote Builder is the
      // only navigation effect today — the rest store intent and complete.
      if (
        acceptedActionIds.has("open_quote_builder")
        && extraction
        && extraction.equipment_mentioned.length > 0
      ) {
        const prefill = encodeURIComponent(extraction.equipment_mentioned.join(", "));
        onComplete();
        navigate(`/sales/quotes/new?prefill_equipment=${prefill}`);
        return;
      }

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
            IRON is listening for the customer name automatically.
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
            Captured {duration}s · running IRON extractors
          </p>
        </div>
      </div>
    );
  }

  // ── Review state ──────────────────────────────────────────────
  const showAlternates =
    matchResult && matchResult.confidence < AUTO_ACCEPT_CONFIDENCE;

  const smartActions = pickSmartActions({
    extraction,
    selectedCustomerId,
    selectedDealId: null,
  });

  function toggleAction(id: SmartAction["id"]) {
    setAcceptedActionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
          bookCustomers={allCustomers}
          initialSearch={initialPickerSearch}
          onPick={(picked) => {
            setSelectedCustomerId(picked.id);
            setSelectedCustomerName(picked.name);
            setShowCustomerPicker(false);
            setInitialPickerSearch("");
          }}
          onClose={() => setShowCustomerPicker(false)}
        />
      ) : (
        <CustomerReviewBlock
          selectedCustomer={selectedCustomer}
          matchResult={matchResult}
          showAlternates={!!showAlternates && !selectedCustomer}
          onPickAlternate={(customer) => {
            setSelectedCustomerId(customer.customer_id);
            setSelectedCustomerName(customer.company_name);
          }}
          onOpenPicker={() => setShowCustomerPicker(true)}
          onClearSelection={() => {
            setSelectedCustomerId(null);
            setSelectedCustomerName(null);
          }}
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

      {/* IRON extracted block */}
      <ExtractedBlock extraction={extraction} loading={extractionLoading} />

      {/* IRON smart actions block */}
      {smartActions.length > 0 && (
        <SmartActionsBlock
          actions={smartActions}
          acceptedIds={acceptedActionIds}
          onToggle={toggleAction}
        />
      )}

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
              ? `Save to ${selectedCustomer.name.split(/\s+/)[0]}`
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
  selectedCustomer: { id: string; name: string } | null;
  matchResult: CustomerMatchResult | null;
  showAlternates: boolean;
  onPickAlternate: (customer: RepCustomer) => void;
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
          {selectedCustomer.name}
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
            Find a different customer
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
              onClick={() => onPickAlternate(alt.customer)}
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
          Find a customer
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
        Save without attaching, or find the customer manually.
      </p>
      <button
        type="button"
        onClick={onOpenPicker}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-card px-3 py-1.5 text-xs font-semibold text-foreground active:scale-95"
      >
        <Search className="h-3 w-3" />
        Find a customer
      </button>
    </section>
  );
}

// ── Sub-component: inline customer picker ───────────────────────
// Two-tier search: rep's own book (v_rep_customers) first, then a
// workspace-wide fallback via searchCompaniesForPicker when the book
// has no matches and the rep has typed at least 2 chars. Prevents the
// "Lewis Tree Services exists in the dealership but isn't in my book
// yet" dead end the rebuild introduced.
function CustomerPickerInline({
  bookCustomers,
  initialSearch,
  onPick,
  onClose,
}: {
  bookCustomers: RepCustomer[];
  initialSearch?: string;
  onPick: (picked: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState(initialSearch ?? "");
  const [debounced, setDebounced] = useState((initialSearch ?? "").trim());

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 220);
    return () => window.clearTimeout(id);
  }, [search]);

  const bookMatches = useMemo(() => {
    if (!debounced) return bookCustomers.slice(0, 12);
    return bookCustomers
      .filter((c) => matchesRepCustomerSearch(c, debounced))
      .slice(0, 12);
  }, [bookCustomers, debounced]);

  const showFallback = debounced.length >= 2 && bookMatches.length === 0;

  const fallbackQuery = useQuery({
    queryKey: ["sales", "smart-voice-capture", "ws-fallback", debounced.toLowerCase()],
    queryFn: () => searchCompaniesForPicker(debounced, 8),
    enabled: showFallback,
    staleTime: 60_000,
  });

  const fallbackRows = showFallback ? (fallbackQuery.data ?? []) : [];

  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-card p-3"
      data-testid="customer-picker-inline"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Find a customer
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
        {bookMatches.map((c) => (
          <CustomerPickerRow
            key={`book-${c.customer_id}`}
            customer={c}
            source="book"
            onPick={() => onPick({ id: c.customer_id, name: c.company_name })}
          />
        ))}
        {showFallback && fallbackQuery.isLoading && (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">
            Looking beyond your book…
          </p>
        )}
        {fallbackRows.map((c) => (
          <CustomerPickerRow
            key={`ws-${c.customer_id}`}
            customer={c}
            source="workspace"
            onPick={() => onPick({ id: c.customer_id, name: c.company_name })}
          />
        ))}
        {!showFallback && bookMatches.length === 0 && debounced.length < 2 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Start typing to find a customer.
          </p>
        )}
        {showFallback && !fallbackQuery.isLoading && fallbackRows.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No customer matches. Try a different spelling.
          </p>
        )}
      </div>
    </section>
  );
}

function CustomerPickerRow({
  customer,
  source,
  onPick,
}: {
  customer: RepCustomer;
  source: "book" | "workspace";
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-white/[0.04] active:bg-white/[0.06]"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate">{customer.company_name}</span>
        {source === "workspace" && (
          <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </span>
        )}
      </span>
      {customer.primary_contact_name && (
        <span className="block text-[11px] text-muted-foreground">
          {customer.primary_contact_name}
        </span>
      )}
    </button>
  );
}

// Pull a usable workspace-search seed out of a transcript. Prefers
// capitalized two-word tokens ("Lewis Tree"), falls back to the
// strongest capitalized single word ≥ 3 chars.
function pickSeedFromTranscript(text: string): string | null {
  if (!text) return null;
  const twoWord = text.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/);
  if (twoWord) return twoWord[0];
  const single = text.match(/\b[A-Z][a-z]{2,}\b/);
  return single ? single[0] : null;
}

// ── Sub-component: extracted entities ───────────────────────────
function ExtractedBlock({
  extraction,
  loading,
}: {
  extraction: VoiceExtractionResult | null;
  loading: boolean;
}) {
  const empty = isExtractionEmpty(extraction);
  const amount = formatExtractedAmount(extraction?.amount_cents ?? null);
  return (
    <section
      className="rounded-2xl border border-white/[0.06] bg-card p-4"
      data-testid="iron-extracted-block"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-qep-orange">
          IRON extracted
        </p>
        {loading && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-qep-orange" />
            extracting…
          </span>
        )}
      </div>

      {extraction?.summary && (
        <p className="mt-2 text-xs italic leading-relaxed text-foreground/80">
          {extraction.summary}
        </p>
      )}

      {empty && !loading ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No structured details detected.
        </p>
      ) : null}

      {!empty && (
        <ul className="mt-3 space-y-2">
          {extraction?.next_step && (
            <ExtractedRow
              icon={<Calendar className="h-3.5 w-3.5 text-qep-orange" />}
              label="Next step"
              value={
                extraction.next_step_due
                  ? `${extraction.next_step} · due ${extraction.next_step_due}`
                  : extraction.next_step
              }
            />
          )}
          {amount && (
            <ExtractedRow
              icon={<DollarSign className="h-3.5 w-3.5 text-emerald-400" />}
              label="Amount"
              value={amount}
            />
          )}
          {extraction && extraction.equipment_mentioned.length > 0 && (
            <ExtractedRow
              icon={<Truck className="h-3.5 w-3.5 text-sky-400" />}
              label="Equipment"
              value={extraction.equipment_mentioned.join(", ")}
            />
          )}
          {extraction?.sentiment && (
            <ExtractedRow
              icon={<Flame className="h-3.5 w-3.5 text-orange-400" />}
              label="Heat"
              value={titleCaseSentiment(extraction.sentiment)}
            />
          )}
          {extraction?.competitor && (
            <ExtractedRow
              icon={<Trophy className="h-3.5 w-3.5 text-amber-400" />}
              label="Competitor"
              value={extraction.competitor}
            />
          )}
          {extraction?.topic && extraction.topic !== "other" && (
            <ExtractedRow
              icon={<Tag className="h-3.5 w-3.5 text-purple-400" />}
              label="Topic"
              value={titleCaseTopic(extraction.topic)}
            />
          )}
        </ul>
      )}
    </section>
  );
}

function titleCaseSentiment(s: "warming" | "cooling" | "neutral"): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ExtractedRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.04]">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {value}
        </span>
      </div>
    </li>
  );
}

// ── Sub-component: smart actions toggle list ────────────────────
function SmartActionsBlock({
  actions,
  acceptedIds,
  onToggle,
}: {
  actions: SmartAction[];
  acceptedIds: Set<SmartAction["id"]>;
  onToggle: (id: SmartAction["id"]) => void;
}) {
  return (
    <section
      className="rounded-2xl border border-white/[0.06] bg-card p-4"
      data-testid="iron-proposed-block"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-qep-orange" />
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-qep-orange">
          IRON proposes
        </p>
      </div>
      <ul className="mt-2 space-y-2">
        {actions.map((action) => {
          const accepted = acceptedIds.has(action.id);
          return (
            <li key={action.id}>
              <button
                type="button"
                onClick={() => onToggle(action.id)}
                aria-pressed={accepted}
                data-testid={`smart-action-${action.id}`}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                  accepted
                    ? "border-qep-orange/50 bg-qep-orange/[0.08]"
                    : "border-white/[0.08] bg-background/40"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      accepted
                        ? "border-qep-orange bg-qep-orange text-white"
                        : "border-white/20 bg-transparent"
                    }`}
                  >
                    {accepted && <Check className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-semibold ${
                        accepted ? "text-foreground" : "text-foreground/80"
                      }`}
                    >
                      {action.label}
                    </p>
                    {action.detail && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {action.detail}
                      </p>
                    )}
                    {!action.wired && (
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                        intent stored
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
