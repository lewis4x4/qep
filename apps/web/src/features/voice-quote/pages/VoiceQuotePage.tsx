import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardList,
  DollarSign,
  Edit3,
  FileText,
  Globe2,
  HelpCircle,
  Languages,
  Loader2,
  MapPin,
  Mic,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Search,
  Signal,
  SlidersHorizontal,
  Sparkles,
  Square,
  Timer,
  UserRound,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  getMicrophoneProblemFromError,
  getMicrophoneSupportProblem,
  type MicrophoneProblem,
} from "@/lib/microphone-access";
import { supabase } from "@/lib/supabase";
import {
  isIdeaBacklogResponse,
  submitVoiceToQrm,
  type VoiceQrmResponse,
} from "@/features/voice-qrm/lib/voice-qrm-api";
import {
  streamScenarios,
  type ScenarioSession,
  type SseResolvedEvent,
} from "@/features/quote-builder/lib/scenario-orchestrator";
import type { ScenarioSelection } from "@/features/quote-builder/components/ConversationalDealEngine";
import type { QuoteScenario } from "@/features/quote-builder/lib/programs-types";

export const VOICE_QUOTE_HANDOFF_KEY = "qep.voiceQuote.pendingSelection";

type RecordingPhase = "idle" | "recording" | "paused" | "transcribing" | "generating" | "ready" | "error";
type ConfidenceLevel = "High" | "Medium" | "Low";

interface ExtractedDetail {
  id: string;
  icon: typeof UserRound;
  label: string;
  value: string;
  confidence: ConfidenceLevel;
  edited?: boolean;
}

interface RecentVoiceQuote {
  id: string;
  title: string;
  summary: string;
  customer: string;
  location: string;
  duration: string;
  createdAt: string;
  statusLabel: string;
  statusDetail: string;
  statusTone: "success" | "warning" | "info" | "draft" | "offline";
  action: string;
}

interface InProgressVoiceCapture {
  id: string;
  transcript: string | null;
  extracted_data: unknown;
  sync_status: string | null;
  duration_seconds: number | null;
  created_at: string;
}

const MAX_DURATION_MS = 600_000;

const EXAMPLE_TRANSCRIPTS = [
  "Amanda at Red River Demolition needs a compact track loader for land clearing in Tyler. Budget is around $50k, prefers Bobcat, and has a 2019 CAT 320 to trade.",
  "Marcus at Hill Country Landscaping wants a skid steer under forty thousand dollars with pallet forks, delivery in Georgetown before the end of next week.",
  "Lone Star Rentals is expanding their Austin fleet and asked for a mini excavator quote with two financing options and a rental conversion path.",
];

const RECENT_QUOTES: RecentVoiceQuote[] = [];

function formatCurrency(cents?: number) {
  if (typeof cents !== "number") return "TBD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatMonthly(cents?: number) {
  if (typeof cents !== "number") return "TBD";
  return `${formatCurrency(cents)} /mo`;
}

function confidenceFromScore(score: number | null | undefined): ConfidenceLevel {
  if (typeof score !== "number") return "Medium";
  if (score >= 0.85) return "High";
  if (score >= 0.6) return "Medium";
  return "Low";
}

function confidenceClass(confidence: ConfidenceLevel) {
  if (confidence === "High") return "border-lime-500/25 bg-lime-500/15 text-lime-300";
  if (confidence === "Medium") return "border-amber-500/25 bg-amber-500/15 text-amber-300";
  return "border-red-500/25 bg-red-500/15 text-red-300";
}

function statusToneClass(tone: RecentVoiceQuote["statusTone"]) {
  switch (tone) {
    case "success":
      return "border-lime-500/25 bg-lime-500/15 text-lime-300";
    case "warning":
      return "border-amber-500/25 bg-amber-500/15 text-amber-300";
    case "info":
      return "border-sky-500/25 bg-sky-500/15 text-sky-300";
    case "draft":
      return "border-violet-500/25 bg-violet-500/15 text-violet-300";
    default:
      return "border-slate-500/25 bg-slate-500/15 text-slate-300";
  }
}

function getLeadTime(scenario: QuoteScenario) {
  return scenario.pros.find((item) => item.toLowerCase().startsWith("lead time:"))?.replace(/^Lead time:\s*/i, "") ?? "TBD";
}

function getTradeCredit(scenario: QuoteScenario) {
  return scenario.pros.find((item) => item.toLowerCase().startsWith("trade-in applied:"))?.replace(/^Trade-in applied:\s*/i, "") ?? "$0";
}

function getScenarioNote(scenario: QuoteScenario) {
  return scenario.pros.find((item) => !item.toLowerCase().startsWith("lead time:") && !item.toLowerCase().startsWith("trade-in applied:")) ?? scenario.description;
}

function buildFieldsFromResult(result: VoiceQrmResponse): ExtractedDetail[] {
  const companyName = result.entities.company.name || result.entities.contact.name || "Needs review";
  const contactName = result.entities.contact.name || "Contact not identified";
  const equipmentValue =
    result.entities.equipment.count > 0
      ? `${result.entities.equipment.count} equipment mention${result.entities.equipment.count === 1 ? "" : "s"} captured`
      : "Needs equipment review";

  return [
    {
      id: "customer",
      icon: UserRound,
      label: "Customer",
      value: companyName,
      confidence: confidenceFromScore(result.entities.company.confidence ?? result.entities.contact.confidence),
    },
    {
      id: "contact",
      icon: ClipboardList,
      label: "Contact",
      value: contactName,
      confidence: confidenceFromScore(result.entities.contact.confidence),
    },
    {
      id: "equipment",
      icon: Wrench,
      label: "Equipment",
      value: equipmentValue,
      confidence: result.entities.equipment.count > 0 ? "Medium" : "Low",
    },
    {
      id: "budget",
      icon: DollarSign,
      label: "Budget",
      value: result.entities.budget_timeline_captured ? "Budget context captured" : "Needs review",
      confidence: result.entities.budget_timeline_captured ? "Medium" : "Low",
    },
    {
      id: "intent",
      icon: Signal,
      label: "Buying intent",
      value: result.intelligence?.buying_intent ? `${result.intelligence.buying_intent} intent` : "Not classified",
      confidence: result.intelligence?.buying_intent ? "Medium" : "Low",
    },
    {
      id: "follow_up",
      icon: CalendarDays,
      label: "Follow-up",
      value: result.follow_up_suggestions[0] ?? "No follow-up suggested",
      confidence: result.follow_up_suggestions.length > 0 ? "Medium" : "Low",
    },
  ];
}

function buildFieldsFromCapture(extractedData: unknown): ExtractedDetail[] {
  if (!extractedData || typeof extractedData !== "object") return [];
  const data = extractedData as Record<string, unknown>;
  const fields: ExtractedDetail[] = [];
  const addField = (id: string, icon: ExtractedDetail["icon"], label: string, value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    fields.push({ id, icon, label, value: value.trim(), confidence: "Medium" });
  };
  addField("customer", UserRound, "Customer", data.companyName ?? data.company_name ?? data.customer);
  addField("contact", ClipboardList, "Contact", data.contactName ?? data.contact_name ?? data.contact);
  addField("equipment", Wrench, "Equipment", data.equipment ?? data.machine ?? data.equipmentInterest);
  addField("budget", DollarSign, "Budget", data.budget ?? data.budgetRange ?? data.budget_range);
  addField("follow_up", CalendarDays, "Follow-up", data.nextStep ?? data.next_step ?? data.followUp);
  return fields;
}

function getRecorderMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) ?? ""
  );
}

function StepIndicator({ phase }: { phase: RecordingPhase }) {
  const currentStep = phase === "idle" || phase === "recording" || phase === "paused" ? 1 : phase === "transcribing" ? 2 : 3;
  const steps = ["Record", "Review transcript", "Compare scenarios", "Open in Quote Builder"];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const active = stepNumber === currentStep || (phase === "ready" && stepNumber === 3);
        const completed = stepNumber < currentStep;
        return (
          <div key={step} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                active && "border-orange-400 bg-orange-500 text-slate-950",
                completed && "border-lime-400/50 bg-lime-500/20 text-lime-200",
                !active && !completed && "border-slate-700 bg-slate-900/70 text-slate-400",
              )}
            >
              {completed ? <CheckCircle2 className="h-3.5 w-3.5" /> : stepNumber}
            </span>
            <span className={cn("font-semibold", active && "text-orange-300", completed && "text-lime-200")}>{step}</span>
            {index < steps.length - 1 && <span className="hidden text-slate-600 sm:inline">-----</span>}
          </div>
        );
      })}
    </div>
  );
}

function Waveform({ active }: { active: boolean }) {
  const bars = useMemo(
    () =>
      Array.from({ length: 48 }, (_, index) => ({
        id: index,
        height: 12 + ((index * 17) % 36),
        hot: index < 33,
      })),
    [],
  );

  return (
    <div className="flex h-14 items-end gap-1 overflow-hidden rounded-[8px] border border-slate-800 bg-slate-950/35 px-2 py-2">
      {bars.map((bar) => (
        <span
          key={bar.id}
          className={cn("w-1 rounded-full", bar.hot ? "bg-orange-400" : "bg-slate-600", active && bar.hot && "animate-pulse")}
          style={{ height: `${bar.height}px`, animationDelay: `${bar.id * 45}ms` }}
        />
      ))}
    </div>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  tone = "green",
}: {
  icon: typeof Mic;
  label: string;
  value: string;
  tone?: "green" | "orange" | "blue";
}) {
  const toneClass =
    tone === "orange"
      ? "border-orange-500/20 bg-orange-500/10 text-orange-300"
      : tone === "blue"
        ? "border-sky-500/20 bg-sky-500/10 text-sky-300"
        : "border-lime-500/20 bg-lime-500/10 text-lime-300";

  return (
    <div className="flex min-h-14 items-center gap-3 rounded-[8px] border border-slate-800 bg-slate-950/35 px-3">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-[8px] border", toneClass)}>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-xs font-semibold text-slate-100">{label}</p>
        <p className={cn("text-xs", tone === "orange" ? "text-orange-300" : tone === "blue" ? "text-sky-300" : "text-lime-300")}>
          {value}
        </p>
      </div>
    </div>
  );
}

export function VoiceQuotePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [transcriptEdited, setTranscriptEdited] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [fields, setFields] = useState<ExtractedDetail[]>([]);
  const [scenarios, setScenarios] = useState<QuoteScenario[]>([]);
  const [resolved, setResolved] = useState<SseResolvedEvent | null>(null);
  const [originatingLogId, setOriginatingLogId] = useState<string | null>(null);
  const [processingMessage, setProcessingMessage] = useState("Start with a fresh recording. Transcript, details, and scenarios will appear after processing.");
  const [microphoneProblem, setMicrophoneProblem] = useState<MicrophoneProblem | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const scenarioSessionRef = useRef<ScenarioSession | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const elapsedBeforePauseRef = useRef(0);

  const isBusy = phase === "transcribing" || phase === "generating";
  const isRecording = phase === "recording" || phase === "paused";

  useEffect(() => {
    if (phase !== "recording") return undefined;
    const interval = window.setInterval(() => {
      if (recordingStartRef.current) {
        setElapsedMs(elapsedBeforePauseRef.current + (Date.now() - recordingStartRef.current));
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    return () => {
      scenarioSessionRef.current?.cancel();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restoreInProgressCapture() {
      try {
        const { data: userResult } = await supabase.auth.getUser();
        const userId = userResult.user?.id;
        if (!userId || cancelled) return;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("voice_captures")
          .select("id, transcript, extracted_data, sync_status, duration_seconds, created_at")
          .eq("user_id", userId)
          .in("sync_status", ["pending", "processing"])
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error || cancelled || !data) return;
        const capture = data as InProgressVoiceCapture;
        const restoredTranscript = capture.transcript?.trim() ?? "";
        setTranscript(restoredTranscript);
        setTranscriptDraft(restoredTranscript);
        setFields(buildFieldsFromCapture(capture.extracted_data));
        setElapsedMs((capture.duration_seconds ?? 0) * 1000);
        setPhase(restoredTranscript ? "ready" : "transcribing");
        setProcessingMessage(
          restoredTranscript
            ? "Restored your in-progress voice quote from the last 24 hours. Review it before generating scenarios."
            : "Restored an in-progress voice quote from the last 24 hours. Transcription is still pending.",
        );
      } catch {
        // First visit should remain empty if restore cannot be verified.
      }
    }
    void restoreInProgressCapture();
    return () => {
      cancelled = true;
    };
  }, []);

  const formattedTimer = useMemo(() => {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [elapsedMs]);

  const processRecording = useCallback(
    async (blob: Blob) => {
      if (blob.size === 0) {
        setPhase("error");
        setProcessingMessage("No audio was captured. Re-record the voice quote and try again.");
        return;
      }

      scenarioSessionRef.current?.cancel();
      setPhase("transcribing");
      setProcessingMessage("Uploading audio and transcribing with voice-to-QRM...");
      setMicrophoneProblem(null);

      try {
        const result = await submitVoiceToQrm({
          audioBlob: blob,
          fileName: `voice-quote-${Date.now()}.webm`,
        });

        if (isIdeaBacklogResponse(result)) {
          throw new Error("This recording was routed to the idea backlog instead of quote generation.");
        }

        setTranscript(result.transcript);
        setTranscriptDraft(result.transcript);
        setTranscriptEdited(false);
        setFields(buildFieldsFromResult(result));
        setPhase("generating");
        setProcessingMessage("Generating quote scenarios from the transcript...");

        const nextScenarios: QuoteScenario[] = [];
        const session = streamScenarios({
          prompt: result.transcript,
          promptSource: "voice",
          supabase,
        });
        scenarioSessionRef.current = session;

        for await (const event of session) {
          if (event.type === "status") {
            setProcessingMessage(event.message);
          }

          if (event.type === "resolved") {
            setResolved(event);
            setProcessingMessage(`Matched ${event.model.nameDisplay}. Building options...`);
          }

          if (event.type === "scenario") {
            nextScenarios[event.index] = event.scenario;
            setScenarios(nextScenarios.filter(Boolean));
          }

          if (event.type === "complete") {
            setOriginatingLogId(event.logId);
            setProcessingMessage(`Generated ${event.totalScenarios} scenario${event.totalScenarios === 1 ? "" : "s"} in ${Math.round(event.latencyMs / 100) / 10}s.`);
            setPhase("ready");
          }

          if (event.type === "error") {
            throw new Error(event.message);
          }
        }

        if (nextScenarios.length === 0) {
          setScenarios([]);
          setProcessingMessage("The recording was transcribed, but scenario generation returned no cards. Re-record or open Quote Builder manually.");
        }
        setPhase("ready");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Voice quote generation failed.";
        setPhase("error");
        setProcessingMessage(message);
        toast({
          title: "Voice quote failed",
          description: message,
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  async function startRecording() {
    const supportProblem = getMicrophoneSupportProblem();
    if (supportProblem) {
      setMicrophoneProblem(supportProblem);
      setPhase("error");
      return;
    }

    try {
      scenarioSessionRef.current?.cancel();
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      recorderRef.current = recorder;
      elapsedBeforePauseRef.current = 0;
      recordingStartRef.current = Date.now();
      setElapsedMs(0);
      setTranscript("");
      setTranscriptDraft("");
      setTranscriptEdited(false);
      setProcessingMessage("Recording voice quote...");
      setPhase("recording");

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        void processRecording(audioBlob);
      };

      recorder.start();
    } catch (error) {
      const problem = getMicrophoneProblemFromError(error);
      setMicrophoneProblem(problem);
      setPhase("error");
      setProcessingMessage(problem.description);
    }
  }

  function pauseRecording() {
    const recorder = recorderRef.current;
    if (!recorder || phase !== "recording") return;
    recorder.pause();
    elapsedBeforePauseRef.current = elapsedMs;
    recordingStartRef.current = null;
    setPhase("paused");
    setProcessingMessage("Recording paused.");
  }

  function resumeRecording() {
    const recorder = recorderRef.current;
    if (!recorder || phase !== "paused") return;
    recorder.resume();
    recordingStartRef.current = Date.now();
    setPhase("recording");
    setProcessingMessage("Recording voice quote...");
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || (phase !== "recording" && phase !== "paused")) return;
    setPhase("transcribing");
    setProcessingMessage("Stopping recording...");
    recorder.stop();
  }

  function resetCapture() {
    scenarioSessionRef.current?.cancel();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setPhase("idle");
    setElapsedMs(0);
    setTranscript("");
    setTranscriptDraft("");
    setTranscriptEdited(false);
    setEditingTranscript(false);
    setFields([]);
    setScenarios([]);
    setResolved(null);
    setOriginatingLogId(null);
    setProcessingMessage("Start with a fresh recording. Transcript, details, and scenarios will appear after processing.");
    setMicrophoneProblem(null);
  }

  function saveTranscriptEdit() {
    setTranscript(transcriptDraft);
    setTranscriptEdited(transcriptDraft !== transcript);
    setEditingTranscript(false);
  }

  function markFieldReviewed(fieldId: string) {
    setFields((current) =>
      current.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              edited: true,
              confidence: field.confidence === "Low" ? "Medium" : field.confidence,
            }
          : field,
      ),
    );
  }

  function openScenario(scenario: QuoteScenario) {
    const selection: ScenarioSelection = {
      scenario,
      resolvedModelId: resolved?.model.id ?? null,
      resolvedBrandId: null,
      deliveryState: resolved?.deliveryState ?? "TX",
      customerType: resolved?.customerType ?? "standard",
      prompt: transcript,
      originatingLogId,
    };

    try {
      sessionStorage.setItem(
        VOICE_QUOTE_HANDOFF_KEY,
        JSON.stringify({
          ...selection,
          voiceSessionId: originatingLogId ?? `voice-session-${Date.now()}`,
          at: new Date().toISOString(),
        }),
      );
    } catch (error) {
      toast({
        title: "Draft not pre-filled",
        description: "The quote builder will open, but your browser blocked the voice handoff.",
        variant: "destructive",
      });
      // eslint-disable-next-line no-console
      console.warn("[voice-quote] sessionStorage write failed:", error);
    }

    navigate(`/quote-v2?voice_session_id=${encodeURIComponent(originatingLogId ?? "voice-session")}`);
  }

  const primaryStatus = phase === "recording" ? "Live" : phase === "paused" ? "Paused" : phase === "error" ? "Needs review" : "Ready";
  const visibleScenarios = scenarios;

  return (
    <div className="-mb-16 min-h-screen bg-[#081323] pb-16 lg:-mb-8 lg:pb-8">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-4 px-4 pb-8 pt-5 sm:px-6 lg:px-8">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_760px] 2xl:grid-cols-[minmax(0,1fr)_840px]">
        <div>
          <p className="text-xs font-bold uppercase text-orange-400">Sales Voice Workflow</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-50">Voice Quote</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Speak the customer situation, review the extracted details, and pick a scenario to open in Quote Builder.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
          <Card className="rounded-[8px] border-slate-800 bg-[#0b1727]/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="flex gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-slate-200" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-slate-400">Try saying something like...</p>
                <p className="mt-3 text-sm leading-6 text-slate-300">{EXAMPLE_TRANSCRIPTS[exampleIndex]}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-slate-400 hover:text-orange-300"
                onClick={() => setExampleIndex((exampleIndex + 1) % EXAMPLE_TRANSCRIPTS.length)}
                title="Show another example"
              >
                <RefreshCcw className="h-4 w-4" />
              </Button>
            </div>
          </Card>

          <div className="grid gap-2 sm:grid-cols-2">
            <StatusCard icon={Signal} label="Voice mode" value="Active" />
            <StatusCard icon={FileText} label="Type mode" value="Available" tone="blue" />
            <StatusCard icon={Wifi} label="Offline-ready" value="Saved locally" />
            <StatusCard icon={Languages} label="English" value="Spanish available" tone="blue" />
            <StatusCard icon={Globe2} label="Draft queue" value="Empty" tone="orange" />
          </div>
        </div>
      </section>

      <StepIndicator phase={phase} />

      <section className="grid gap-3 xl:grid-cols-[250px_minmax(320px,1fr)_470px_240px] 2xl:grid-cols-[275px_minmax(390px,1fr)_520px_280px]">
        <Card className="rounded-[8px] border-slate-800 bg-[#0b1727]/95 p-5">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase text-slate-300">Voice Capture</p>
            <HelpCircle className="h-3.5 w-3.5 text-slate-500" />
          </div>

          <div className="mt-8 flex flex-col items-center">
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isBusy}
              className={cn(
                "relative flex h-36 w-36 items-center justify-center rounded-full border border-orange-400/25 bg-orange-500/15 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:cursor-not-allowed disabled:opacity-60",
                phase === "recording" && "shadow-[0_0_0_18px_rgba(249,115,22,0.10),0_0_0_36px_rgba(249,115,22,0.08)]",
              )}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
            >
              <span className="absolute inset-5 rounded-full bg-orange-500/20" />
              <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-orange-500 text-slate-950 shadow-[0_18px_50px_rgba(249,115,22,0.30)]">
                {isBusy ? <Loader2 className="h-9 w-9 animate-spin" /> : <Mic className="h-10 w-10" />}
              </span>
            </button>

            <p className="mt-8 text-3xl font-medium tabular-nums text-slate-100">{formattedTimer}</p>
            <p className="mt-1 text-sm text-slate-400">Max 10:00</p>

            <div className="mt-7 grid w-full grid-cols-3 gap-3">
              <button
                type="button"
                onClick={phase === "paused" ? resumeRecording : pauseRecording}
                disabled={phase !== "recording" && phase !== "paused"}
                className="flex flex-col items-center gap-2 rounded-[8px] p-2 text-slate-300 disabled:opacity-45"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800">
                  <Pause className="h-5 w-5" />
                </span>
                <span className="text-xs">{phase === "paused" ? "Resume" : "Pause"}</span>
              </button>
              <button
                type="button"
                onClick={stopRecording}
                disabled={!isRecording}
                className="flex flex-col items-center gap-2 rounded-[8px] p-2 text-slate-300 disabled:opacity-45"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800">
                  <Square className="h-4 w-4" />
                </span>
                <span className="text-xs">Stop</span>
              </button>
              <button type="button" onClick={resetCapture} className="flex flex-col items-center gap-2 rounded-[8px] p-2 text-slate-300">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800">
                  <RotateCcw className="h-5 w-5" />
                </span>
                <span className="text-xs">Re-record</span>
              </button>
            </div>

            <div className="mt-5 w-full">
              <Waveform active={phase === "recording"} />
            </div>

            <div className="mt-5 flex items-start gap-2 rounded-[8px] bg-slate-950/25 p-3 text-sm text-slate-300">
              <CircleDot className="mt-1 h-4 w-4 shrink-0 text-lime-400" />
              <p>Offline recordings are saved locally and will sync automatically.</p>
            </div>

            {microphoneProblem && (
              <div className="mt-4 rounded-[8px] border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                <div className="flex gap-2 font-semibold">
                  <AlertCircle className="h-4 w-4" />
                  {microphoneProblem.title}
                </div>
                <p className="mt-2 text-red-100/85">{microphoneProblem.description}</p>
                {microphoneProblem.recovery && <p className="mt-1 text-red-100/75">{microphoneProblem.recovery}</p>}
              </div>
            )}
          </div>
        </Card>

        <Card className="rounded-[8px] border-slate-800 bg-[#0b1727]/95 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold uppercase text-slate-300">Live Transcript</p>
              <span className={cn("h-2 w-2 rounded-full", phase === "recording" ? "bg-lime-400" : phase === "error" ? "bg-red-400" : "bg-slate-500")} />
              <span className="text-xs text-slate-400">{primaryStatus}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 border-slate-700 bg-slate-950/25 text-slate-200 hover:text-orange-200"
              onClick={() => {
                setTranscriptDraft(transcript);
                setEditingTranscript(true);
              }}
            >
              <Edit3 className="h-4 w-4" />
              Edit transcript
            </Button>
          </div>

          <div className="mt-5 min-h-[190px] border-b border-slate-800 pb-5">
            {editingTranscript ? (
              <div className="space-y-3">
                <textarea
                  value={transcriptDraft}
                  onChange={(event) => setTranscriptDraft(event.target.value)}
                  className="min-h-[160px] w-full rounded-[8px] border border-slate-700 bg-slate-950/40 p-3 text-sm leading-6 text-slate-100 outline-none focus:border-orange-400"
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingTranscript(false)}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={saveTranscriptEdit}>
                    Save transcript
                  </Button>
                </div>
              </div>
            ) : transcript ? (
              <div className="space-y-4 whitespace-pre-line text-sm leading-7 text-slate-200">{transcript}</div>
            ) : (
              <div className="flex min-h-[160px] items-center justify-center rounded-[8px] border border-dashed border-slate-700 text-sm text-slate-400">
                Recording transcript will stream here after you stop.
              </div>
            )}
          </div>

          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase text-slate-300">Extracted Details</p>
                  <HelpCircle className="h-3.5 w-3.5 text-slate-500" />
                </div>
                <p className="mt-2 text-xs text-slate-400">Review low-confidence fields before generating scenarios.</p>
              </div>
              {transcriptEdited && <Badge className="border-sky-500/25 bg-sky-500/15 text-sky-200">Edited</Badge>}
            </div>

            <div className="mt-4 space-y-2">
              {fields.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-400">
                  Extracted customer, equipment, budget, and follow-up details will appear after transcription.
                </div>
              ) : fields.map((field) => {
                const Icon = field.icon;
                return (
                  <div key={field.id} className="grid grid-cols-[20px_74px_minmax(0,1fr)_72px_28px] items-center gap-2 rounded-[8px] border border-slate-800 bg-slate-950/20 px-2 py-2 text-sm">
                    <Icon className="h-4 w-4 text-slate-400" />
                    <span className="text-slate-400">{field.label}</span>
                    <span className="min-w-0 truncate text-slate-200">{field.value}</span>
                    <span className={cn("rounded-full border px-2 py-1 text-center text-xs font-semibold", confidenceClass(field.confidence))}>
                      {field.edited ? "Edited" : field.confidence}
                    </span>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-[8px] text-slate-400 hover:bg-slate-800 hover:text-orange-300"
                      onClick={() => markFieldReviewed(field.id)}
                      title={`Review ${field.label}`}
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-[8px] border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-400">
              {processingMessage}
            </div>
          </div>
        </Card>

        <Card className="rounded-[8px] border-slate-800 bg-[#0b1727]/95 p-0">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <div>
              <p className="text-xs font-bold uppercase text-slate-300">Scenarios</p>
              <p className="mt-1 text-sm text-slate-400">Pick one to open in Quote Builder.</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-orange-300"
              disabled={visibleScenarios.length === 0}
              onClick={() => setCompareOpen(true)}
            >
              <Sparkles className="h-4 w-4" />
              How scenarios work
            </Button>
          </div>

          <div className="space-y-2 p-3">
            {visibleScenarios.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-slate-700 px-4 py-10 text-center">
                <p className="text-sm font-semibold text-slate-200">No scenarios yet</p>
                <p className="mt-2 text-sm text-slate-400">Record a voice quote to generate quote options.</p>
              </div>
            ) : visibleScenarios.map((scenario, index) => {
              const recommended = index === 0;
              return (
                <div
                  key={`${scenario.label}-${index}`}
                  className={cn(
                    "rounded-[8px] border bg-slate-950/25 p-4",
                    recommended ? "border-orange-500 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.45)]" : "border-slate-800",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className={cn("text-lg font-semibold", index === 0 && "text-orange-300", index === 1 && "text-sky-300", index === 2 && "text-violet-300")}>
                        {scenario.label}
                      </h2>
                      <p className="mt-2 text-sm text-slate-200">{scenario.description}</p>
                    </div>
                    <div className="text-right">
                      {recommended && <Badge className="mb-2 border-orange-500/25 bg-orange-500/20 text-orange-200">Recommended</Badge>}
                      <p className="text-base font-semibold text-slate-100">{formatCurrency(scenario.customerOutOfPocketCents)}</p>
                      <p className="text-xs text-slate-400">Est. Total Price</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-300">
                    <span className="text-lg font-semibold text-slate-100">{formatMonthly(scenario.monthlyPaymentCents)}</span>
                    <span className="text-slate-600">•</span>
                    <span>{scenario.termMonths ?? 60} mo @ 6.49%</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
                    <span>Lead time: {getLeadTime(scenario)}</span>
                    <span>Trade-in applied: {getTradeCredit(scenario)}</span>
                  </div>

                  <p className="mt-3 text-xs text-slate-400">{getScenarioNote(scenario)}</p>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button type="button" size="sm" onClick={() => openScenario(scenario)}>
                      Open in Quote Builder
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-slate-700 bg-slate-950/20 text-slate-200"
                      onClick={() => setCompareOpen(true)}
                    >
                      Compare
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
            <Circle className="mr-1 inline h-3.5 w-3.5" />
            After opening in Quote Builder, use Back to Voice Quote to start another session.
          </div>
        </Card>

        <aside className="grid gap-3 xl:col-span-1 xl:grid-cols-1">
          <Card className="rounded-[8px] border-slate-800 bg-[#0b1727]/95 p-5">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold uppercase text-slate-300">What to Mention</p>
              <HelpCircle className="h-3.5 w-3.5 text-slate-500" />
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              {[
                "Customer name & company",
                "Equipment type & details",
                "Budget or target price",
                "Urgency or timeline",
                "Trade-in or existing equipment",
                "Delivery or location constraints",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" className="mt-5 w-full border-slate-700 bg-slate-950/20 text-slate-200">
              <HelpCircle className="h-4 w-4" />
              View examples
            </Button>
          </Card>

          <Card className="rounded-[8px] border-slate-800 bg-[#0b1727]/95 p-5">
            <div className="flex items-center gap-3">
              <Wifi className="h-5 w-5 text-sky-400" />
              <p className="text-xs font-bold uppercase text-slate-300">Offline & Sync</p>
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              <li>Sessions are saved locally when you're offline.</li>
              <li>Queued items sync automatically when you're back online.</li>
              <li>You'll be notified if sync requires review.</li>
            </ul>
            <Button type="button" variant="outline" className="mt-5 w-full border-orange-500/35 bg-orange-500/10 text-orange-200">
              Manage offline notes
            </Button>
          </Card>
        </aside>
      </section>

      <Card className="rounded-[8px] border-slate-800 bg-[#0b1727]/95">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <p className="text-xs font-bold uppercase text-slate-200">Recent Voice Quotes</p>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <div className="relative min-w-[240px] max-w-[320px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input className="h-9 border-slate-700 bg-slate-950/30 pl-9 text-sm text-slate-200" placeholder="Search sessions or customers..." />
            </div>
            {["All", "Converted", "Needs Review", "Queued", "Offline"].map((filter, index) => (
              <Button
                key={filter}
                type="button"
                variant={index === 0 ? "default" : "outline"}
                size="sm"
                className={cn(index !== 0 && "border-slate-700 bg-slate-950/20 text-slate-300")}
              >
                {filter}
              </Button>
            ))}
            <Button type="button" variant="outline" size="sm" className="border-slate-700 bg-slate-950/20 text-slate-300">
              Last 30 days
              <CalendarDays className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-9 w-9 border-slate-700 bg-slate-950/20 text-slate-300">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1100px] table-fixed text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-[34%] px-5 py-3 font-semibold">Session</th>
                <th className="w-[16%] px-5 py-3 font-semibold">Customer</th>
                <th className="w-[9%] px-5 py-3 font-semibold">Duration</th>
                <th className="w-[14%] px-5 py-3 font-semibold">Created</th>
                <th className="w-[17%] px-5 py-3 font-semibold">Quote ID / Status</th>
                <th className="w-[10%] px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {RECENT_QUOTES.length === 0 ? (
                <tr>
                  <td className="px-5 py-10 text-center text-slate-400" colSpan={6}>
                    Recent voice quotes will appear after real sessions are recorded or restored.
                  </td>
                </tr>
              ) : RECENT_QUOTES.map((quote) => (
                <tr key={quote.id} className="text-slate-300 hover:bg-slate-950/25">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-200 hover:bg-orange-500 hover:text-slate-950"
                        title={`Play ${quote.title}`}
                      >
                        <Play className="h-4 w-4 fill-current" />
                      </button>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-100">{quote.title}</p>
                        <p className="truncate text-xs text-slate-500">{quote.summary}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-200">{quote.customer}</p>
                    <p className="text-xs text-slate-500">{quote.location}</p>
                  </td>
                  <td className="px-5 py-3 tabular-nums">{quote.duration}</td>
                  <td className="whitespace-pre-line px-5 py-3 text-xs text-slate-400">{quote.createdAt}</td>
                  <td className="px-5 py-3">
                    <span className={cn("inline-flex rounded-full border px-2 py-1 text-xs font-semibold", statusToneClass(quote.statusTone))}>
                      {quote.statusLabel}
                    </span>
                    <p className="mt-1 text-xs text-slate-400">{quote.statusDetail}</p>
                  </td>
                  <td className="px-5 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-slate-700 bg-slate-950/20 text-slate-200"
                      onClick={() => quote.action.includes("Builder") || quote.action.includes("quote") ? openScenario(visibleScenarios[0]) : undefined}
                      disabled={visibleScenarios.length === 0}
                    >
                      {quote.action}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-5xl border-slate-800 bg-[#0b1727] text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-slate-50">Scenario comparison</DialogTitle>
            <DialogDescription>Compare machine, pricing, financing, lead time, and trade credit before opening Quote Builder.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-3">
            {visibleScenarios.map((scenario, index) => (
              <div key={`${scenario.label}-compare`} className={cn("rounded-[8px] border p-4", index === 0 ? "border-orange-500/70 bg-orange-500/10" : "border-slate-800 bg-slate-950/25")}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-50">{scenario.label}</h3>
                  {index === 0 && <Badge className="border-orange-500/25 bg-orange-500/20 text-orange-200">Recommended</Badge>}
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Machine</dt>
                    <dd className="mt-1 text-slate-200">{scenario.description}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Total Price</dt>
                    <dd className="mt-1 font-semibold text-slate-100">{formatCurrency(scenario.customerOutOfPocketCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Monthly</dt>
                    <dd className="mt-1 text-slate-200">{formatMonthly(scenario.monthlyPaymentCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Rate</dt>
                    <dd className="mt-1 text-slate-200">{scenario.termMonths ?? 60} mo @ 6.49%</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Lead Time</dt>
                    <dd className="mt-1 text-slate-200">{getLeadTime(scenario)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Trade Credit</dt>
                    <dd className="mt-1 text-slate-200">{getTradeCredit(scenario)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">Key Difference</dt>
                    <dd className="mt-1 text-slate-200">{getScenarioNote(scenario)}</dd>
                  </div>
                </dl>
                <Button type="button" className="mt-5 w-full" onClick={() => openScenario(scenario)}>
                  Select option
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
