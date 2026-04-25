import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Mic,
  Square,
  CheckCircle2,
  AlertCircle,
  Loader2,
  User,
  Building2,
  Tractor,
  Wrench,
  TrendingUp,
  DollarSign,
  MessageSquare,
  ListTodo,
  Copy,
  Check,
  RefreshCw,
  CloudUpload,
  FileText,
  Cpu,
  Sparkles,
  HelpCircle,
  CalendarDays,
  Send,
  Clock,
  XCircle,
  Volume2,
  Search,
  Play,
  Pause,
  Wifi,
  WifiOff,
  Radio,
  Pencil,
  MoreVertical,
  SlidersHorizontal,
  ShieldCheck,
  Database as DatabaseIcon,
  ExternalLink,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { UserRole, Database } from "../lib/database.types";
import type { ExtractedDealData } from "../lib/voice-capture-extraction.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { crmSupabase } from "@/features/qrm/lib/qrm-supabase";
import {
  getEvidenceSnippet,
  getExtractedMachineLabel,
  normalizeExtractedDealData,
} from "@/lib/voice-capture-extraction";
import {
  getInitialMicrophoneProblem,
  getMicrophoneProblemFromError,
  getMicrophoneSupportProblem,
  type MicrophoneProblem,
} from "@/lib/microphone-access";
import {
  enqueueVoiceNote,
  getQueuedVoiceNotes,
  removeQueuedVoiceNotes,
  type QueuedVoiceNote,
} from "@/features/sales/lib/offline-store";

interface VoiceCapturePageProps {
  userRole: UserRole;
  userEmail: string | null;
}

type RecordingState =
  | "idle"
  | "recording"
  | "paused"
  | "recorded"
  | "processing"
  | "done"
  | "error";

interface CaptureResult {
  id: string;
  transcript: string;
  duration_seconds: number | null;
  extracted_data: ExtractedDealData;
  hubspot_synced: boolean;
  local_crm_saved?: boolean;
  hubspot_deal_id: string | null;
  hubspot_note_id: string | null;
  hubspot_task_id: string | null;
  local_crm_note_id?: string | null;
  local_crm_task_id?: string | null;
}

interface DealLookupOption {
  id: string;
  name: string;
  companyName: string | null;
}

interface RecordingFormat {
  mimeType: string;
  fileName: string;
  previewTypes: string[];
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
}

type RecentCapture = Pick<
  Database["public"]["Tables"]["voice_captures"]["Row"],
  | "id"
  | "created_at"
  | "duration_seconds"
  | "sync_status"
  | "hubspot_deal_id"
  | "transcript"
  | "sync_error"
  | "updated_at"
  | "user_id"
  | "audio_storage_path"
  | "linked_deal_id"
> & {
  recorderName: string | null;
  recorderEmail: string | null;
};

type RecentCaptureDetail = Database["public"]["Tables"]["voice_captures"]["Row"] & {
  recorderName: string | null;
  recorderEmail: string | null;
};

interface VoiceCaptureStatusMeta {
  badgeLabel: string;
  badgeVariant: "default" | "destructive" | "secondary";
  heading: string;
  summary: string;
}

type RecentStatusFilter = "all" | "synced" | "queued" | "needs_match";
type RecentDateFilter = "all" | "today" | "week";

interface RecentRecordingRow {
  id: string;
  source: "remote" | "queued";
  title: string;
  transcript: string | null;
  createdAt: string;
  durationSeconds: number | null;
  recorder: string;
  dealId: string | null;
  syncStatus: "synced" | "queued" | "needs_match" | "review_sync" | "processing";
  statusLabel: string;
  statusDetail: string;
  actionLabel: string;
  audioStoragePath: string | null;
  audioBlob?: Blob;
}

const DEAL_STAGE_LABELS: Record<string, string> = {
  initial_contact: "Initial Contact",
  follow_up: "Follow-Up",
  demo_scheduled: "Demo Scheduled",
  quote_sent: "Quote Sent",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

const PROCESSING_STEPS = [
  { label: "Uploading", icon: CloudUpload },
  { label: "Transcribing", icon: FileText },
  { label: "Extracting", icon: Cpu },
  { label: "Done", icon: Sparkles },
];

const WORKFLOW_STEPS = ["Record", "Review", "Extract", "Match to deal", "Synced"];

const RECORDING_FORMATS: RecordingFormat[] = [
  {
    mimeType: "audio/mp4;codecs=mp4a.40.2",
    fileName: "recording.m4a",
    previewTypes: ["audio/mp4; codecs=mp4a.40.2", "audio/mp4", "audio/aac"],
  },
  {
    mimeType: "audio/mp4",
    fileName: "recording.m4a",
    previewTypes: ["audio/mp4", "audio/aac"],
  },
  {
    mimeType: "audio/webm;codecs=opus",
    fileName: "recording.webm",
    previewTypes: ["audio/webm; codecs=opus", "audio/webm"],
  },
  {
    mimeType: "audio/webm",
    fileName: "recording.webm",
    previewTypes: ["audio/webm"],
  },
];

const CONFIDENCE_TONE: Record<
  "high" | "medium" | "low" | "unknown",
  { label: string; className: string }
> = {
  high: {
    label: "High confidence",
    className: "border-green-200 bg-green-50 text-green-700",
  },
  medium: {
    label: "Medium confidence",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  low: {
    label: "Low confidence",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  unknown: {
    label: "Confidence unknown",
    className: "border-border bg-muted text-muted-foreground",
  },
};

function looksLikeCrmRecordId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function formatDealReference(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!looksLikeCrmRecordId(trimmed)) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function getVoiceCaptureStatusMeta(
  status: RecentCapture["sync_status"],
  syncError: string | null,
): VoiceCaptureStatusMeta {
  switch (status) {
    case "synced":
      return {
        badgeLabel: "Saved to QRM",
        badgeVariant: "default",
        heading: "Saved to QRM",
        summary: "This field note processed cleanly and the QRM sync completed.",
      };
    case "processing":
      return {
        badgeLabel: "Processing",
        badgeVariant: "secondary",
        heading: "Processing",
        summary: "The note is still transcribing or extracting data.",
      };
    case "pending":
      return {
        badgeLabel: "Ready to push",
        badgeVariant: "secondary",
        heading: "Captured locally",
        summary: "The note is captured, but it is not attached to the QRM timeline yet.",
      };
    case "failed":
    default:
      if (syncError?.startsWith("Transcription failed")) {
        return {
          badgeLabel: "Transcription failed",
          badgeVariant: "destructive",
          heading: "Transcription failed",
          summary: "We could not reliably turn this recording into text.",
        };
      }
      if (syncError?.startsWith("Data extraction failed")) {
        return {
          badgeLabel: "Extraction failed",
          badgeVariant: "destructive",
          heading: "Extraction failed",
          summary: "The transcript exists, but the structured QRM fields did not finish extracting.",
        };
      }
      return {
        badgeLabel: "Review needed",
        badgeVariant: "destructive",
        heading: "Review needed",
        summary: "This note needs operator review before it can be trusted downstream.",
      };
  }
}

function canPreviewAudioMimeType(mimeType: string): boolean {
  if (typeof document === "undefined") return true;
  const audio = document.createElement("audio");
  return audio.canPlayType(mimeType).replace(/no/i, "").trim().length > 0;
}

function chooseRecordingFormat(): RecordingFormat | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return RECORDING_FORMATS[0] ?? null;
  }

  const playableFormats = RECORDING_FORMATS.filter(
    (format) =>
      MediaRecorder.isTypeSupported(format.mimeType) &&
      format.previewTypes.some((previewType) => canPreviewAudioMimeType(previewType)),
  );

  if (playableFormats.length > 0) {
    return playableFormats[0];
  }

  const supportedFormat = RECORDING_FORMATS.find((format) =>
    MediaRecorder.isTypeSupported(format.mimeType),
  );

  return supportedFormat ?? null;
}

function formatStageLabel(value: ExtractedDealData["opportunity"]["dealStage"]): string | null {
  if (!value) return null;
  return DEAL_STAGE_LABELS[value] ?? value;
}

function formatEnumLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatMaybeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Edge pipeline holds the blob in memory more than once; oversized uploads often fail with a generic 500. */
const MAX_VOICE_CAPTURE_BYTES = 24 * 1024 * 1024;

export function VoiceCapturePage({ userRole: _userRole, userEmail: _userEmail }: VoiceCapturePageProps) {
  const { toast } = useToast();
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [audioPreviewFailed, setAudioPreviewFailed] = useState(false);
  const [hubspotDealId, setHubspotDealId] = useState("");
  const [dealLookupQuery, setDealLookupQuery] = useState("");
  const [dealLookupOptions, setDealLookupOptions] = useState<DealLookupOption[]>([]);
  const [dealLookupLoading, setDealLookupLoading] = useState(false);
  const [selectedDealLabel, setSelectedDealLabel] = useState<string | null>(null);
  const [resolvedDealOption, setResolvedDealOption] = useState<DealLookupOption | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [microphoneProblem, setMicrophoneProblem] = useState<MicrophoneProblem | null>(null);
  const [processingStep, setProcessingStep] = useState(0);
  const [pushingToHubspot, setPushingToHubspot] = useState(false);
  const [recentCaptures, setRecentCaptures] = useState<RecentCapture[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentCaptureSheetOpen, setRecentCaptureSheetOpen] = useState(false);
  const [recentCaptureLoading, setRecentCaptureLoading] = useState(false);
  const [selectedRecentCapture, setSelectedRecentCapture] = useState<RecentCaptureDetail | null>(null);
  const [recentAudioUrl, setRecentAudioUrl] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [queuedVoiceNotes, setQueuedVoiceNotes] = useState<QueuedVoiceNote[]>([]);
  const [queuedSyncing, setQueuedSyncing] = useState(false);
  const [recentSearch, setRecentSearch] = useState("");
  const [recentStatusFilter, setRecentStatusFilter] = useState<RecentStatusFilter>("all");
  const [recentDateFilter, setRecentDateFilter] = useState<RecentDateFilter>("all");
  const [inlineAudio, setInlineAudio] = useState<{
    id: string;
    url: string;
    isObjectUrl: boolean;
  } | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");

  // Track viewport width for responsive tooltip positioning (QUA-75)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const problem = await getInitialMicrophoneProblem();
      if (!cancelled) {
        setMicrophoneProblem(problem);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingFormatRef = useRef<RecordingFormat | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Load recent captures on mount
  useEffect(() => {
    void loadRecentCaptures();
    void loadQueuedVoiceNotes();
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void syncQueuedVoiceNotes();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queuedSyncing]);

  useEffect(() => {
    return () => {
      if (inlineAudio?.isObjectUrl) {
        URL.revokeObjectURL(inlineAudio.url);
      }
    };
  }, [inlineAudio]);

  useEffect(() => {
    const query = dealLookupQuery.trim();
    if (query.length < 2 || looksLikeCrmRecordId(query)) {
      setDealLookupOptions([]);
      setDealLookupLoading(false);
      return;
    }

    let cancelled = false;
    setDealLookupLoading(true);

    const timer = window.setTimeout(() => {
      void (async () => {
        const { data, error } = await crmSupabase
          .from("crm_deals_rep_safe")
          .select("id, name, company_id")
          .ilike("name", `%${query}%`)
          .is("deleted_at", null)
          .limit(6);

        if (cancelled) return;
        if (error || !data) {
          setDealLookupOptions([]);
          setDealLookupLoading(false);
          return;
        }

        const companyIds = Array.from(
          new Set(data.map((row) => row.company_id).filter((value): value is string => Boolean(value))),
        );

        let companyNameById = new Map<string, string>();
        if (companyIds.length > 0) {
          const companyResult = await crmSupabase
            .from("crm_companies")
            .select("id, name")
            .in("id", companyIds)
            .is("deleted_at", null);

          if (!cancelled && !companyResult.error && companyResult.data) {
            companyNameById = new Map(companyResult.data.map((row) => [row.id, row.name]));
          }
        }

        if (cancelled) return;
        setDealLookupOptions(
          data.map((row) => ({
            id: row.id,
            name: row.name,
            companyName: row.company_id ? companyNameById.get(row.company_id) ?? null : null,
          })),
        );
        setDealLookupLoading(false);
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dealLookupQuery]);

  useEffect(() => {
    const activeDealId = result?.hubspot_deal_id?.trim() || hubspotDealId.trim();
    if (!activeDealId || !looksLikeCrmRecordId(activeDealId)) {
      setResolvedDealOption(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data: deal, error: dealError } = await crmSupabase
        .from("crm_deals_rep_safe")
        .select("id, name, company_id")
        .eq("id", activeDealId)
        .is("deleted_at", null)
        .maybeSingle();

      if (cancelled) return;
      if (dealError || !deal) {
        setResolvedDealOption(null);
        return;
      }

      let companyName: string | null = null;
      if (deal.company_id) {
        const companyResult = await crmSupabase
          .from("crm_companies")
          .select("name")
          .eq("id", deal.company_id)
          .is("deleted_at", null)
          .maybeSingle();

        if (!cancelled && !companyResult.error) {
          companyName = companyResult.data?.name ?? null;
        }
      }

      if (cancelled) return;
      setResolvedDealOption({
        id: deal.id,
        name: deal.name,
        companyName,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [hubspotDealId, result?.hubspot_deal_id]);

  async function loadRecentCaptures(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setRecentLoading(false);
      return;
    }
    const isElevated = ["manager", "owner"].includes(_userRole);
    let query = supabase
      .from("voice_captures")
      .select(
        "id, created_at, duration_seconds, sync_status, hubspot_deal_id, linked_deal_id, transcript, sync_error, updated_at, user_id, audio_storage_path",
      )
      .order("created_at", { ascending: false })
      .limit(7);
    // Defense-in-depth: scope to own rows for non-elevated roles (RLS also enforces this)
    if (!isElevated) {
      query = query.eq("user_id", user.id);
    }
    const { data } = await query;
    if (data) {
      const userIds = Array.from(new Set(data.map((capture) => capture.user_id).filter(Boolean)));
      let profileMap = new Map<string, { full_name: string | null; email: string | null }>();

      if (userIds.length > 0) {
        const profileResult = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);

        if (!profileResult.error && profileResult.data) {
          profileMap = new Map(
            profileResult.data.map((profile) => [
              profile.id,
              {
                full_name: profile.full_name,
                email: profile.email,
              },
            ]),
          );
        }
      }

      setRecentCaptures(
        data.map((capture) => {
          const recorder = profileMap.get(capture.user_id);
          return {
            ...capture,
            recorderName: recorder?.full_name ?? null,
            recorderEmail:
              recorder?.email ?? (capture.user_id === user.id ? _userEmail ?? null : null),
          };
        }),
      );
    }
    setRecentLoading(false);
  }

  async function loadQueuedVoiceNotes(): Promise<void> {
    try {
      const notes = await getQueuedVoiceNotes();
      setQueuedVoiceNotes(notes.sort((a, b) => b.queuedAt.localeCompare(a.queuedAt)));
    } catch (err) {
      console.warn("Could not load queued voice notes", err);
      setQueuedVoiceNotes([]);
    }
  }

  async function syncQueuedVoiceNotes(): Promise<void> {
    if (queuedSyncing || typeof navigator !== "undefined" && !navigator.onLine) return;

    const notes = await getQueuedVoiceNotes().catch(() => []);
    if (notes.length === 0) {
      setQueuedVoiceNotes([]);
      return;
    }

    setQueuedSyncing(true);
    const syncedIds: string[] = [];
    try {
      for (const note of notes) {
        try {
          await submitVoiceBlob(note.audioBlob, {
            dealId: note.dealId,
            fileName: note.fileName,
          });
          syncedIds.push(note.id);
        } catch (err) {
          console.warn("Queued voice note sync failed", err);
          break;
        }
      }

      if (syncedIds.length > 0) {
        await removeQueuedVoiceNotes(syncedIds);
        toast({
          title: "Offline notes synced",
          description: `${syncedIds.length} field note${syncedIds.length === 1 ? "" : "s"} reached QRM processing.`,
        });
      }
    } finally {
      setQueuedSyncing(false);
      await loadQueuedVoiceNotes();
      void loadRecentCaptures();
    }
  }

  async function openRecentCapture(capture: RecentCapture): Promise<void> {
    setRecentCaptureLoading(true);
    setRecentCaptureSheetOpen(true);

    const { data: captureRow, error: captureError } = await supabase
      .from("voice_captures")
      .select("*")
      .eq("id", capture.id)
      .single();

    if (captureError || !captureRow) {
      setSelectedRecentCapture(null);
      setRecentCaptureLoading(false);
      toast({
        title: "Could not open note",
        description: "We couldn't load the full field note right now.",
        variant: "destructive",
      });
      return;
    }

    const profileResult = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", captureRow.user_id)
      .maybeSingle();

    setSelectedRecentCapture({
      ...captureRow,
      recorderName: profileResult.data?.full_name ?? capture.recorderName,
      recorderEmail: profileResult.data?.email ?? capture.recorderEmail,
    });
    setRecentCaptureLoading(false);

    // Generate signed URL for audio playback
    setRecentAudioUrl(null);
    if (captureRow.audio_storage_path) {
      const { data: signedData } = await supabase.storage
        .from("voice-recordings")
        .createSignedUrl(captureRow.audio_storage_path, 3600);
      if (signedData?.signedUrl) {
        setRecentAudioUrl(signedData.signedUrl);
      }
    }
  }

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, [audioBlobUrl]);

  // Advance processing steps while processing
  useEffect(() => {
    if (recordingState !== "processing") {
      setProcessingStep(0);
      return;
    }
    setProcessingStep(0);
    const advance = (step: number) => {
      if (step >= 2) return; // hold at "Extracting" until result arrives
      stepTimerRef.current = setTimeout(() => {
        setProcessingStep(step + 1);
        advance(step + 1);
      }, 2000);
    };
    advance(0);
    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, [recordingState]);

  function startLiveTranscript(): void {
    setLiveTranscript("");

    const recognitionCtor =
      typeof window === "undefined"
        ? null
        : ((window as unknown as {
            SpeechRecognition?: new () => SpeechRecognitionLike;
            webkitSpeechRecognition?: new () => SpeechRecognitionLike;
          }).SpeechRecognition ??
          (window as unknown as {
            webkitSpeechRecognition?: new () => SpeechRecognitionLike;
          }).webkitSpeechRecognition ??
          null);

    if (!recognitionCtor) return;

    try {
      const recognition = new recognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        let text = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          text += event.results[i][0].transcript;
        }
        setLiveTranscript((prev) => {
          const next = `${prev} ${text}`.trim();
          return next.length > 360 ? next.slice(next.length - 360) : next;
        });
      };
      recognition.onerror = () => undefined;
      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch {
      speechRecognitionRef.current = null;
    }
  }

  function stopLiveTranscript(): void {
    try {
      speechRecognitionRef.current?.stop();
    } catch {
      // Browser speech recognition can throw if it already stopped.
    }
    speechRecognitionRef.current = null;
  }

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    setMicrophoneProblem(null);

    const supportProblem = getMicrophoneSupportProblem();
    if (supportProblem) {
      setMicrophoneProblem(supportProblem);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (err) {
      setMicrophoneProblem(getMicrophoneProblemFromError(err));
      return;
    }

    const recordingFormat = chooseRecordingFormat();
    if (!recordingFormat) {
      setErrorMessage("This browser does not support an audio recording format we can save safely.");
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      return;
    }

    recordingFormatRef.current = recordingFormat;

    const recorder = new MediaRecorder(stream, { mimeType: recordingFormat.mimeType });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];
    setAudioPreviewFailed(false);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recordingFormat.mimeType });
      const url = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioBlobUrl(url);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    recorder.start(250);
    setRecordingState("recording");
    setElapsedSeconds(0);
    setMicrophoneProblem(null);
    startLiveTranscript();

    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    stopLiveTranscript();
    setRecordingState("recorded");
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopLiveTranscript();
    setRecordingState("paused");
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
    }
    startLiveTranscript();
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    setRecordingState("recording");
  }, []);

  const resetCapture = useCallback(() => {
    stopLiveTranscript();
    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    setAudioBlob(null);
    setAudioBlobUrl(null);
    setAudioPreviewFailed(false);
    setElapsedSeconds(0);
    setHubspotDealId("");
    setDealLookupQuery("");
    setDealLookupOptions([]);
    setSelectedDealLabel(null);
    setResolvedDealOption(null);
    setResult(null);
    setErrorMessage(null);
    setMicrophoneProblem(null);
    setLiveTranscript("");
    setRecordingState("idle");
  }, [audioBlobUrl]);

  async function pushToHubspot(): Promise<void> {
    if (!result) return;
    setPushingToHubspot(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-capture-sync`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ capture_id: result.id }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Sync failed" }));
        throw new Error((err as { error?: string }).error ?? "Sync failed");
      }

      const payload = (await res.json()) as Partial<CaptureResult>;
      setResult((prev) =>
        prev
          ? {
              ...prev,
              hubspot_synced: payload.hubspot_synced ?? true,
              local_crm_saved: payload.local_crm_saved ?? true,
              hubspot_deal_id: payload.hubspot_deal_id ?? prev.hubspot_deal_id,
              hubspot_note_id: payload.hubspot_note_id ?? prev.hubspot_note_id,
              hubspot_task_id: payload.hubspot_task_id ?? prev.hubspot_task_id,
              local_crm_note_id: payload.local_crm_note_id ?? prev.local_crm_note_id,
              local_crm_task_id: payload.local_crm_task_id ?? prev.local_crm_task_id,
            }
          : prev,
      );
      void loadRecentCaptures();
      toast({ title: "Added to QRM", description: "Note and follow-up task are on the local deal timeline." });
    } catch (err) {
      toast({
        title: "QRM sync failed",
        description: err instanceof Error ? err.message : "Sync failed",
        variant: "destructive",
      });
    } finally {
      setPushingToHubspot(false);
    }
  }

  async function submitCapture(): Promise<void> {
    if (!audioBlob) return;

    if (audioBlob.size > MAX_VOICE_CAPTURE_BYTES) {
      const mb = (audioBlob.size / (1024 * 1024)).toFixed(1);
      const msg = `This recording is large (${mb} MB) and may not process reliably. Record a shorter note (aim under about 2 minutes) and try again.`;
      setErrorMessage(msg);
      setRecordingState("error");
      toast({ title: "Recording too large", description: msg, variant: "destructive" });
      return;
    }

    setRecordingState("processing");
    setErrorMessage(null);

    try {
      const recordingFileName = recordingFormatRef.current?.fileName ?? "recording.webm";
      const data = await submitVoiceBlob(audioBlob, {
        dealId: hubspotDealId.trim() || null,
        fileName: recordingFileName,
      });

      // Mark final step complete before showing results
      setProcessingStep(3);
      await new Promise((r) => setTimeout(r, 600));

      setResult(data);
      setRecordingState("done");
      void loadRecentCaptures();

      if (data.local_crm_saved || data.hubspot_synced) {
        toast({
          title: "Saved to QRM",
          description: "Note and follow-up task were attached to the deal.",
        });
      } else {
        toast({
          title: "Captured locally",
          description: "The note is saved, but it still needs to be attached to a QRM deal.",
        });
      }
    } catch (err) {
      if (isLikelyNetworkFailure(err)) {
        await queueVoiceCaptureForLater(
          audioBlob,
          "The recording is stored on this device and will sync when connectivity returns.",
        );
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      setErrorMessage(message);
      setRecordingState("error");
      toast({ title: "Processing failed", description: message, variant: "destructive" });
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function handleDealLookupChange(value: string): void {
    setDealLookupQuery(value);

    const trimmed = value.trim();
    if (!trimmed) {
      setHubspotDealId("");
      setSelectedDealLabel(null);
      setDealLookupOptions([]);
      return;
    }

    if (looksLikeCrmRecordId(trimmed)) {
      setHubspotDealId(trimmed);
      setSelectedDealLabel(null);
      setDealLookupOptions([]);
      return;
    }

    setHubspotDealId("");
    setSelectedDealLabel(null);
  }

  function handleDealOptionSelect(option: DealLookupOption): void {
    const label = option.companyName ? `${option.name} · ${option.companyName}` : option.name;
    setHubspotDealId(option.id);
    setSelectedDealLabel(label);
    setDealLookupQuery(label);
    setDealLookupOptions([]);
  }

  function clearDealSelection(): void {
    setHubspotDealId("");
    setSelectedDealLabel(null);
    setDealLookupQuery("");
    setDealLookupOptions([]);
  }

  async function submitVoiceBlob(
    blob: Blob,
    opts: { dealId: string | null; fileName: string },
  ): Promise<CaptureResult> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const form = new FormData();
    form.append("audio", blob, opts.fileName);
    if (opts.dealId?.trim()) {
      form.append("crm_deal_id", opts.dealId.trim());
    }

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: form,
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error((err as { error?: string }).error ?? "Processing failed");
    }

    return (await res.json()) as CaptureResult;
  }

  function isLikelyNetworkFailure(err: unknown): boolean {
    if (typeof navigator !== "undefined" && !navigator.onLine) return true;
    if (!(err instanceof Error)) return false;
    return /failed to fetch|network|load failed|offline/i.test(err.message);
  }

  async function queueVoiceCaptureForLater(blob: Blob, reason: string): Promise<void> {
    const recordingFileName = recordingFormatRef.current?.fileName ?? "recording.webm";
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `queued-${Date.now()}`;

    await enqueueVoiceNote({
      id,
      audioBlob: blob,
      mimeType: blob.type || recordingFormatRef.current?.mimeType || "audio/webm",
      fileName: recordingFileName,
      durationSeconds: elapsedSeconds,
      dealId: hubspotDealId.trim() || null,
      dealLabel: selectedDealLabel,
      queuedAt: new Date().toISOString(),
    });
    await loadQueuedVoiceNotes();
    toast({
      title: "Saved offline",
      description: reason,
    });
    resetCapture();
  }

  function formatCaptureDateTime(value: string | null): string | null {
    if (!value) return null;
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  async function playRecentAudio(row: RecentRecordingRow): Promise<void> {
    if (inlineAudio?.id === row.id) {
      setInlineAudio(null);
      return;
    }

    if (row.source === "queued" && row.audioBlob) {
      setInlineAudio({
        id: row.id,
        url: URL.createObjectURL(row.audioBlob),
        isObjectUrl: true,
      });
      return;
    }

    if (!row.audioStoragePath) return;
    const { data } = await supabase.storage
      .from("voice-recordings")
      .createSignedUrl(row.audioStoragePath, 3600);
    if (data?.signedUrl) {
      setInlineAudio({
        id: row.id,
        url: data.signedUrl,
        isObjectUrl: false,
      });
    }
  }

  function buildRemoteRow(cap: RecentCapture): RecentRecordingRow {
    const hasDeal = Boolean(cap.hubspot_deal_id || cap.linked_deal_id);
    const transcript = cap.transcript?.trim() || null;
    let syncStatus: RecentRecordingRow["syncStatus"] = "review_sync";
    let statusLabel = "Review & Sync";
    let statusDetail = "Needs review before QRM timeline sync";
    let actionLabel = "Review & Sync";

    if (cap.sync_status === "processing") {
      syncStatus = "processing";
      statusLabel = "Review & Sync";
      statusDetail = "Transcription and extraction are still running";
      actionLabel = "Check progress";
    } else if (cap.sync_status === "synced" && hasDeal) {
      syncStatus = "synced";
      statusLabel = "Synced to QRM";
      statusDetail = formatDealReference(cap.hubspot_deal_id ?? cap.linked_deal_id) ?? "On deal timeline";
      actionLabel = "Open note";
    } else if (!hasDeal) {
      syncStatus = "needs_match";
      statusLabel = "Needs match";
      statusDetail = "No deal matched";
      actionLabel = "Match to deal";
    } else if (cap.sync_status === "pending") {
      syncStatus = "review_sync";
      statusLabel = "Review & Sync";
      statusDetail = "Ready to attach to QRM";
      actionLabel = "Review & Sync";
    }

    return {
      id: cap.id,
      source: "remote",
      title: transcript?.split(/[.!?\n]/)[0]?.slice(0, 54) || "Untitled field note",
      transcript,
      createdAt: cap.created_at,
      durationSeconds: cap.duration_seconds,
      recorder: cap.recorderName ?? cap.recorderEmail ?? "Recorder unavailable",
      dealId: cap.hubspot_deal_id ?? cap.linked_deal_id ?? null,
      syncStatus,
      statusLabel,
      statusDetail,
      actionLabel,
      audioStoragePath: cap.audio_storage_path,
    };
  }

  function buildQueuedRow(note: QueuedVoiceNote): RecentRecordingRow {
    return {
      id: note.id,
      source: "queued",
      title: note.dealLabel ?? "Offline field note",
      transcript: "Audio is stored on this device. Transcript and QRM extraction will run after sync.",
      createdAt: note.queuedAt,
      durationSeconds: note.durationSeconds,
      recorder: _userEmail ?? "This device",
      dealId: note.dealId,
      syncStatus: "queued",
      statusLabel: "Queued locally",
      statusDetail: note.dealId
        ? `Will sync to ${formatDealReference(note.dealId) ?? "selected deal"}`
        : "Will auto-match after upload",
      actionLabel: "Manage offline",
      audioStoragePath: null,
      audioBlob: note.audioBlob,
    };
  }

  function renderDealLookupField(inputId: string): React.JSX.Element {
    const trimmedQuery = dealLookupQuery.trim();
    const isDirectId = looksLikeCrmRecordId(trimmedQuery);
    const showOptions = trimmedQuery.length >= 2 && !isDirectId;

    return (
      <div className="relative">
        <div className="relative">
          <Input
            id={inputId}
            type="text"
            value={dealLookupQuery}
            onChange={(e) => handleDealLookupChange(e.target.value)}
            placeholder="Search by deal name, customer, or QRM deal ID"
            autoComplete="off"
            className={cn("h-10 pr-11", (selectedDealLabel || hubspotDealId) && "border-qep-orange/40")}
          />
          {(selectedDealLabel || hubspotDealId) && (
            <button
              type="button"
              aria-label="Clear QRM deal selection"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={clearDealSelection}
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>

        {showOptions && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-20 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
            {dealLookupLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching deals...
              </div>
            ) : dealLookupOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                No matching deals found. Paste a QRM deal ID if you already have one.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {dealLookupOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleDealOptionSelect(option)}
                    className="flex w-full flex-col items-start gap-1 px-3 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="text-sm font-medium text-foreground">{option.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.companyName ?? "No linked company"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const activeExtracted = result ? normalizeExtractedDealData(result.extracted_data) : null;
  const activeDealId = (result?.hubspot_deal_id ?? hubspotDealId.trim()) || null;
  const activeDealTitle = resolvedDealOption
    ? resolvedDealOption.companyName
      ? `${resolvedDealOption.name} · ${resolvedDealOption.companyName}`
      : resolvedDealOption.name
    : selectedDealLabel;
  const activeDealReference = formatDealReference(activeDealId);
  const queuedCount = queuedVoiceNotes.length;
  const matchConfidenceClass = activeDealId
    ? "border-green-500/30 bg-green-500/10 text-green-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  const workflowStepIndex =
    recordingState === "done" && (result?.local_crm_saved || result?.hubspot_synced)
      ? 4
      : recordingState === "done"
        ? 3
        : recordingState === "processing"
          ? 2
          : recordingState === "recorded" || recordingState === "error"
            ? 1
            : 0;
  const matchModeLabel = activeDealId
    ? "Direct match"
    : dealLookupQuery.trim()
      ? "Review match"
      : "Auto-match";
  const statusCards = [
    {
      label: "Match Mode",
      value: matchModeLabel,
      detail: activeDealId ? "Deal selected" : "Customer details resolve after transcript",
      icon: Sparkles,
      className: activeDealId
        ? "border-green-500/30 bg-green-500/10 text-green-300"
        : "border-border bg-background/50 text-foreground",
    },
    {
      label: "Offline",
      value: isOnline ? "Ready" : "Offline",
      detail: isOnline ? "Local fallback enabled" : "Saving to this device",
      icon: isOnline ? ShieldCheck : WifiOff,
      className: isOnline
        ? "border-blue-500/25 bg-blue-500/10 text-blue-200"
        : "border-amber-500/30 bg-amber-500/10 text-amber-200",
    },
    {
      label: "Queued",
      value: `${queuedCount} notes`,
      detail: queuedCount === 1 ? "Waiting to sync" : "Waiting to sync",
      icon: DatabaseIcon,
      className: queuedCount > 0
        ? "border-qep-orange/30 bg-qep-orange/10 text-qep-orange"
        : "border-border bg-background/50 text-foreground",
    },
  ];

  const recentRows = useMemo(() => {
    const rows = [
      ...queuedVoiceNotes.map((note) => buildQueuedRow(note)),
      ...recentCaptures.map((cap) => buildRemoteRow(cap)),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const query = recentSearch.trim().toLowerCase();
    const now = new Date();
    return rows.filter((row) => {
      if (recentStatusFilter !== "all" && row.syncStatus !== recentStatusFilter) return false;
      if (query) {
        const haystack = `${row.title} ${row.transcript ?? ""} ${row.recorder} ${row.dealId ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (recentDateFilter !== "all") {
        const created = new Date(row.createdAt);
        const ageMs = now.getTime() - created.getTime();
        if (recentDateFilter === "today" && created.toDateString() !== now.toDateString()) return false;
        if (recentDateFilter === "week" && ageMs > 7 * 24 * 60 * 60 * 1000) return false;
      }
      return true;
    });
  }, [queuedVoiceNotes, recentCaptures, recentSearch, recentStatusFilter, recentDateFilter]);

  const hasTranscriptContent = Boolean(liveTranscript || result?.transcript);
  const liveTranscriptText =
    liveTranscript ||
    result?.transcript ||
    (recordingState === "recording"
      ? "Listening for customer, equipment, stage, budget, and next steps..."
      : "Transcript preview appears here after recording.");

  return (
    <TooltipProvider>
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-[1680px] space-y-4 px-4 py-5 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-qep-orange/90">POST-VISIT CAPTURE</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Field Note</h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Record a post-visit recap. Iron transcribes it, extracts the deal signals, and syncs the record to the QRM timeline.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isOnline ? <Wifi className="h-4 w-4 text-green-400" /> : <WifiOff className="h-4 w-4 text-amber-400" />}
              <span>{isOnline ? "Online" : "Offline"}</span>
              <span className="rounded-full border border-border px-2 py-1">{queuedCount} notes queued</span>
            </div>
          </header>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm" aria-label="Field note workflow">
            <div className="grid gap-2 sm:grid-cols-5">
              {WORKFLOW_STEPS.map((step, index) => {
                const complete = workflowStepIndex > index;
                const active = workflowStepIndex === index;
                return (
                  <div
                    key={step}
                    className={cn(
                      "relative flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                      complete && "border-green-500/30 bg-green-500/10 text-green-300",
                      active && "border-qep-orange/50 bg-qep-orange/15 text-qep-orange shadow-[inset_0_0_0_1px_rgba(255,132,31,0.12)]",
                      !complete && !active && "border-border bg-background/30 text-muted-foreground/80",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                        complete && "border-green-500/40 bg-green-500/25 text-green-200",
                        active && "border-qep-orange bg-qep-orange text-background",
                        !complete && !active && "border-muted-foreground/35 bg-transparent text-muted-foreground",
                      )}
                    >
                      {complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className="font-medium leading-tight">{step}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3 shadow-sm" aria-label="QRM match bar">
            <div className="grid gap-3 lg:grid-cols-[minmax(320px,1.25fr)_repeat(3,minmax(0,0.75fr))] lg:items-end">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor="deal-id" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    QRM Deal ID
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="What is a QRM deal ID?" className="rounded-sm text-muted-foreground hover:text-foreground">
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side={isMobile ? "bottom" : "right"} className="max-w-[260px]">
                      Search by deal name or paste the QRM deal ID directly. If you leave it blank, we&apos;ll still try to match the note by customer details.
                    </TooltipContent>
                  </Tooltip>
                </div>
                {renderDealLookupField("deal-id")}
              </div>
              {statusCards.map((card) => {
                const StatusIcon = card.icon;
                return (
                  <div key={card.label} className={cn("flex h-[72px] min-w-0 flex-col justify-center rounded-lg border px-3 py-2", card.className)}>
                    <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-75">
                      <StatusIcon className="h-3.5 w-3.5 shrink-0" />
                      {card.label}
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold leading-tight">{card.value}</p>
                    <p className="mt-0.5 truncate text-[11px] leading-tight opacity-70">{card.detail}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <main className="space-y-4">
              <section className="rounded-xl border border-border bg-card shadow-sm">
                <div className="grid divide-y divide-border lg:grid-cols-[260px_minmax(0,1fr)_340px] lg:divide-x lg:divide-y-0">
                  <div className="flex flex-col items-center justify-center gap-5 p-5">
                    <p className="self-start text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recording</p>
                    <button
                      type="button"
                      onClick={recordingState === "recording" || recordingState === "paused" ? stopRecording : startRecording}
                      className={cn(
                        "relative flex h-36 w-36 items-center justify-center rounded-full border transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange",
                        recordingState === "recording"
                          ? "border-red-400/40 bg-red-500/15 shadow-[0_0_0_18px_rgba(239,68,68,0.06)]"
                          : recordingState === "paused"
                            ? "border-amber-400/40 bg-amber-500/15"
                            : "border-qep-orange/45 bg-qep-orange shadow-[0_0_0_18px_rgba(255,132,31,0.12)] hover:bg-qep-orange-hover",
                      )}
                      aria-label={recordingState === "recording" || recordingState === "paused" ? "Stop recording" : "Start recording"}
                    >
                      {recordingState === "recording" && <span className="absolute h-40 w-40 animate-ping rounded-full bg-red-500/15" />}
                      {recordingState === "recording" || recordingState === "paused" ? (
                        <Square className="relative h-14 w-14 fill-current text-red-100" />
                      ) : (
                        <Mic className="h-16 w-16 text-white" />
                      )}
                    </button>
                    <div className="text-center">
                      <p className="text-lg font-semibold text-foreground">
                        {recordingState === "recording" ? "Recording" : recordingState === "paused" ? "Paused" : "Tap to record"}
                      </p>
                      <p className="text-sm text-muted-foreground">or press Enter</p>
                    </div>
                    <div className="w-full space-y-3 border-t border-border pt-4">
                      <div className="text-center">
                        <p className="font-mono text-3xl tabular-nums leading-none text-foreground">{formatTime(elapsedSeconds)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Max 10:00</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={recordingState === "paused" ? resumeRecording : pauseRecording}
                        disabled={recordingState !== "recording" && recordingState !== "paused"}
                      >
                        {recordingState === "paused" ? (
                          <Play className="h-4 w-4" />
                        ) : (
                          <span aria-hidden="true" className="text-base leading-none">⏸</span>
                        )}
                        {recordingState === "paused" ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={stopRecording}
                        disabled={recordingState !== "recording" && recordingState !== "paused"}
                      >
                        <span aria-hidden="true" className="text-base leading-none">⏹</span>
                        Stop
                      </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live transcript</p>
                      <span className={cn("inline-flex items-center gap-1.5 text-xs", recordingState === "recording" ? "text-green-400" : "text-muted-foreground")}>
                        <span className="h-2 w-2 rounded-full bg-current" />
                        {recordingState === "recording" ? "Live" : "Ready"}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "min-h-[132px] rounded-lg border border-border bg-background/50 p-4 text-base leading-7 text-foreground",
                        !hasTranscriptContent && "text-muted-foreground/70 italic",
                      )}
                    >
                      {liveTranscriptText}
                    </div>
                    <div className="flex h-16 items-center gap-1 overflow-hidden rounded-lg border border-border bg-background/40 px-3" aria-label="Recording waveform">
                      {Array.from({ length: 52 }).map((_, i) => (
                        <span
                          key={i}
                          className={cn("w-1 rounded-full", i < 26 ? "bg-qep-orange" : "bg-muted-foreground/25")}
                          style={{
                            animation: recordingState === "recording" ? `waveform 0.8s ease-in-out ${(i * 0.035).toFixed(2)}s infinite alternate` : undefined,
                            height: `${14 + Math.abs(Math.sin(i * 0.75)) * 32}px`,
                          }}
                        />
                      ))}
                    </div>
                    {recordingState === "recorded" && audioBlob && (
                      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-foreground">
                            {audioPreviewFailed ? "Recording ready" : "Preview before processing"}
                          </p>
                        </div>
                        {audioBlobUrl && !audioPreviewFailed && (
                          <audio controls src={audioBlobUrl} className="h-10 w-full" onError={() => setAudioPreviewFailed(true)} />
                        )}
                        <div className="flex gap-2">
                          <Button variant="outline" className="flex-1" onClick={resetCapture}>Re-record</Button>
                          <Button className="flex-1" onClick={submitCapture}>Process note</Button>
                        </div>
                      </div>
                    )}
                    {recordingState === "processing" && (
                      <div className="grid gap-2 sm:grid-cols-4">
                        {PROCESSING_STEPS.map((step, index) => {
                          const StepIcon = step.icon;
                          const active = processingStep === index;
                          const complete = processingStep > index;
                          return (
                            <div key={step.label} className={cn("rounded-lg border border-border p-3 text-sm", active && "border-qep-orange/50 bg-qep-orange/10", complete && "border-green-500/40 bg-green-500/10")}>
                              <div className="mb-2 flex items-center gap-2">
                                {complete ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : active ? <Loader2 className="h-4 w-4 animate-spin text-qep-orange" /> : <StepIcon className="h-4 w-4 text-muted-foreground" />}
                                <span className="font-medium text-foreground">{step.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {recordingState === "error" && (
                      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                        <div className="flex items-start gap-3">
                          <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
                          <div>
                            <p className="text-sm font-semibold text-destructive">Processing failed</p>
                            <p className="mt-1 text-sm text-destructive/90">{errorMessage}</p>
                          </div>
                        </div>
                        <Button variant="outline" className="mt-3" onClick={resetCapture}>Start over</Button>
                      </div>
                    )}
                    {microphoneProblem && (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                        <p className="text-sm font-medium text-destructive">{microphoneProblem.title}</p>
                        <p className="mt-1 text-sm text-destructive/90">{microphoneProblem.description}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Extracted details (preview)</p>
                      <Button variant="ghost" size="icon" aria-label="Edit extracted details">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {[
                        { icon: User, label: "Customer", value: activeExtracted?.record.companyName ?? activeDealTitle ?? "Auto-match after transcript" },
                        { icon: Tractor, label: "Equipment interest", value: getExtractedMachineLabel(activeExtracted ?? normalizeExtractedDealData({})) ?? "Models, categories, attachments" },
                        { icon: TrendingUp, label: "Deal stage", value: formatStageLabel(activeExtracted?.opportunity.dealStage ?? null) ?? "Evaluation, quote, close risk" },
                        { icon: DollarSign, label: "Budget / Timeline", value: activeExtracted?.opportunity.budgetRange ?? activeExtracted?.opportunity.timelineToBuy ?? "Budget, urgency, quarter" },
                        { icon: ListTodo, label: "Next step", value: activeExtracted?.opportunity.nextStep ?? "Follow-up date or quote request" },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.label} className="grid w-full grid-cols-[24px_minmax(0,1fr)_36px] items-start gap-3">
                            <Icon className="mt-1 h-4 w-4 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="whitespace-nowrap text-sm font-medium leading-tight text-foreground">{item.label}</p>
                              <p className="break-words text-sm text-muted-foreground">{item.value}</p>
                            </div>
                            <Button variant="ghost" size="icon" aria-label={`Edit ${item.label}`} className="h-8 w-8 justify-self-end">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    {recordingState === "done" && result && (
                      <div className="space-y-3 border-t border-border pt-4">
                        <div className={cn("rounded-lg border p-3", result.local_crm_saved || result.hubspot_synced ? "border-green-500/30 bg-green-500/10" : "border-amber-500/30 bg-amber-500/10")}>
                          <p className="text-sm font-semibold text-foreground">
                            {result.local_crm_saved || result.hubspot_synced ? "Synced to QRM" : "Needs match"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {result.local_crm_saved || result.hubspot_synced ? "Saved to the deal timeline." : "Captured safely, but no deal timeline was matched."}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {looksLikeCrmRecordId(result.hubspot_deal_id ?? hubspotDealId ?? "") && (
                            <Button asChild variant="outline" className="flex-1">
                              <Link to={`/crm/deals/${result.hubspot_deal_id ?? hubspotDealId}`}>Open QRM Deal</Link>
                            </Button>
                          )}
                          {!(result.local_crm_saved || result.hubspot_synced) && (
                            <Button className="flex-1" onClick={() => void pushToHubspot()} disabled={pushingToHubspot}>
                              {pushingToHubspot ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                              Add to QRM
                            </Button>
                          )}
                          <Button variant="ghost" onClick={resetCapture}>
                            <XCircle className="h-4 w-4" />
                            Record another
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card shadow-sm">
                <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Recent recordings</h2>
                    <p className="text-sm text-muted-foreground">Search, replay, match, and sync field notes without leaving the capture page.</p>
                  </div>
                  <Link to="/sales/field-note/history" className="text-sm font-semibold text-qep-orange hover:underline">
                    View all
                  </Link>
                </div>
                <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[minmax(0,1fr)_140px_150px_auto] lg:items-end">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={recentSearch} onChange={(e) => setRecentSearch(e.target.value)} placeholder="Search notes..." className="pl-9" />
                  </div>
                  <label className="space-y-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</span>
                    <select value={recentStatusFilter} onChange={(e) => setRecentStatusFilter(e.target.value as RecentStatusFilter)} className="h-10 w-full rounded-[8px] border border-border bg-card px-3 text-sm text-foreground">
                      <option value="all">All</option>
                      <option value="synced">Synced</option>
                      <option value="queued">Queued</option>
                      <option value="needs_match">Needs match</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Date</span>
                    <select value={recentDateFilter} onChange={(e) => setRecentDateFilter(e.target.value as RecentDateFilter)} className="h-10 w-full rounded-[8px] border border-border bg-card px-3 text-sm text-foreground">
                      <option value="all">All time</option>
                      <option value="today">Today</option>
                      <option value="week">Last 7 days</option>
                    </select>
                  </label>
                  <Button variant="outline" aria-label="Open recording filters">
                    <SlidersHorizontal className="h-4 w-4" />
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <thead className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Note</th>
                        <th className="px-4 py-3 font-semibold">Duration</th>
                        <th className="px-4 py-3 font-semibold">Created</th>
                        <th className="px-4 py-3 font-semibold">Owner</th>
                        <th className="px-4 py-3 font-semibold">Status & destination</th>
                        <th className="px-4 py-3 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {recentLoading && recentRows.length === 0 ? (
                        Array.from({ length: 5 }).map((_, index) => (
                          <tr key={index}>
                            <td className="px-4 py-4" colSpan={6}>
                              <div className="h-10 animate-pulse rounded-md bg-muted" />
                            </td>
                          </tr>
                        ))
                      ) : recentRows.length === 0 ? (
                        <tr>
                          <td className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>No recordings match these filters.</td>
                        </tr>
                      ) : (
                        recentRows.map((row) => {
                          const cap = recentCaptures.find((item) => item.id === row.id);
                          return (
                            <tr key={row.id} className="align-top hover:bg-muted/25">
                              <td className="px-4 py-3">
                                <div className="flex items-start gap-3">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="mt-0.5 shrink-0 rounded-full"
                                    onClick={() => void playRecentAudio(row)}
                                    aria-label={`Play ${row.title}`}
                                  >
                                    {inlineAudio?.id === row.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                  </Button>
                                  <div className="min-w-0">
                                    <p className="font-medium text-foreground">{row.title}</p>
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                      <span className="font-medium text-muted-foreground">Transcript preview:</span> {row.transcript ?? "No transcript captured yet."}
                                    </p>
                                    {inlineAudio?.id === row.id && (
                                      <audio
                                        controls
                                        autoPlay
                                        src={inlineAudio.url}
                                        className="mt-3 h-8 w-full max-w-md"
                                        onEnded={() => setInlineAudio(null)}
                                      />
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-muted-foreground">{row.durationSeconds == null ? "—" : formatTime(row.durationSeconds)}</td>
                              <td className="px-4 py-3 text-muted-foreground">{formatCaptureDateTime(row.createdAt)}</td>
                              <td className="px-4 py-3 text-muted-foreground">{row.recorder}</td>
                              <td className="px-4 py-3">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "mb-1",
                                    row.syncStatus === "synced" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                                    row.syncStatus === "queued" && "border-sky-500/30 bg-sky-500/10 text-sky-300",
                                    row.syncStatus === "needs_match" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
                                    row.syncStatus === "review_sync" && "border-qep-orange/30 bg-qep-orange/10 text-qep-orange",
                                  )}
                                >
                                  {row.statusLabel}
                                </Badge>
                                <p className="text-xs text-muted-foreground">{row.statusDetail}</p>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <Button type="button" variant={row.syncStatus === "review_sync" ? "default" : "ghost"} size="sm" onClick={() => cap && void openRecentCapture(cap)}>
                                    {row.syncStatus === "needs_match" ? (
                                      <Pencil className="h-3.5 w-3.5" />
                                    ) : (
                                      <FileText className="h-3.5 w-3.5" />
                                    )}
                                    {row.actionLabel}
                                  </Button>
                                  {row.dealId && (
                                    <Button asChild variant="ghost" size="icon" aria-label="Open linked QRM deal">
                                      <Link to={`/crm/deals/${row.dealId}`}>
                                        <ExternalLink className="h-4 w-4" />
                                      </Link>
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" aria-label="More note actions">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </main>

            <aside className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    QRM match & destination
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label="Where field notes are saved" className="rounded-sm text-muted-foreground hover:text-foreground">
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side={isMobile ? "bottom" : "left"} className="max-w-[260px]">
                        Field notes save to Sales Activity first. When a deal is matched, Iron syncs the note to that customer timeline in QRM.
                      </TooltipContent>
                    </Tooltip>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-border bg-background/50 p-3">
                    <p className="text-xs text-muted-foreground">Matched to</p>
                    <p className="mt-1 font-semibold text-foreground">{activeDealTitle ?? "No deal matched yet"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{activeDealReference ?? "Orphan notes stay in Field Notes until matched."}</p>
                    {activeDealId && (
                      <Link to={`/crm/deals/${activeDealId}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-qep-orange hover:underline">
                        View in QRM
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Confidence</span>
                    <Badge variant="outline" className={matchConfidenceClass}>{activeDealId ? "High (92%)" : "Needs match"}</Badge>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Saves to <span className="font-medium text-foreground">Field Notes</span> until matched to a deal.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
                    <RefreshCw className="h-4 w-4" />
                    Get the best results
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>Speak clearly and include names, equipment models, and numbers.</p>
                  <p>Mention deal stage, budget, timeline, and next steps.</p>
                  <p>Record immediately after the visit while details are fresh.</p>
                  <Button variant="outline" className="mt-2 w-full justify-start">
                    <FileText className="h-4 w-4" />
                    View recording tips
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
                    {isOnline ? <Wifi className="h-4 w-4 text-green-400" /> : <WifiOff className="h-4 w-4 text-amber-400" />}
                    Offline & sync status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    {isOnline
                      ? queuedCount > 0
                        ? "Connection is back. Queued notes can sync automatically or manually now."
                        : "You are online. Field notes process immediately after upload."
                      : "You are offline. Notes are saved locally and will sync automatically when you are back online."}
                  </p>
                  <Button variant="ghost" className="px-0 text-qep-orange hover:bg-transparent" onClick={() => void syncQueuedVoiceNotes()} disabled={!isOnline || queuedSyncing || queuedCount === 0}>
                    {queuedSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                    Manage offline notes
                  </Button>
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </div>
      <Sheet open={recentCaptureSheetOpen} onOpenChange={(open) => {
        setRecentCaptureSheetOpen(open);
        if (!open) setRecentAudioUrl(null);
      }}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Field note review</SheetTitle>
            <SheetDescription>
              {selectedRecentCapture
                ? getVoiceCaptureStatusMeta(
                    selectedRecentCapture.sync_status,
                    selectedRecentCapture.sync_error,
                  ).summary
                : "Inspect the note, confirm the recorder context, and decide what to do next."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {recentCaptureLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading note details...
              </div>
            ) : selectedRecentCapture ? (
              <>
                {(() => {
                  const statusMeta = getVoiceCaptureStatusMeta(
                    selectedRecentCapture.sync_status,
                    selectedRecentCapture.sync_error,
                  );
                  const extracted = normalizeExtractedDealData(
                    selectedRecentCapture.extracted_data,
                  );

                  return (
                    <>
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{statusMeta.heading}</p>
                          <p className="text-xs text-muted-foreground mt-1">{statusMeta.summary}</p>
                        </div>
                        <Badge variant={statusMeta.badgeVariant}>{statusMeta.badgeLabel}</Badge>
                      </div>

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium">Capture context</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <ExtractedField
                            label="Recorded by"
                            value={
                              selectedRecentCapture.recorderName ??
                              selectedRecentCapture.recorderEmail ??
                              "Unknown recorder"
                            }
                            icon={<User className="w-3.5 h-3.5" />}
                          />
                          <ExtractedField
                            label="Email"
                            value={selectedRecentCapture.recorderEmail}
                            icon={<MessageSquare className="w-3.5 h-3.5" />}
                          />
                          <ExtractedField
                            label="Recorded at"
                            value={formatCaptureDateTime(selectedRecentCapture.created_at)}
                            icon={<CalendarDays className="w-3.5 h-3.5" />}
                          />
                          <ExtractedField
                            label="Updated"
                            value={formatCaptureDateTime(selectedRecentCapture.updated_at)}
                            icon={<RefreshCw className="w-3.5 h-3.5" />}
                          />
                          <ExtractedField
                            label="Duration"
                            value={
                              selectedRecentCapture.duration_seconds != null
                                ? formatTime(selectedRecentCapture.duration_seconds)
                                : null
                            }
                            icon={<Clock className="w-3.5 h-3.5" />}
                          />
                          <ExtractedField
                            label="Deal"
                            value={selectedRecentCapture.hubspot_deal_id}
                            icon={<Building2 className="w-3.5 h-3.5" />}
                          />
                        </CardContent>
                      </Card>

                      {recentAudioUrl && (
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                              <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
                              Audio Playback
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <audio
                              controls
                              src={recentAudioUrl}
                              className="w-full h-10"
                              preload="metadata"
                            />
                          </CardContent>
                        </Card>
                      )}

                      {selectedRecentCapture.sync_error && (
                        <Card className="border-destructive/40 bg-destructive/5">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-medium text-destructive">
                              What needs review
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-destructive/90">
                              {selectedRecentCapture.sync_error}
                            </p>
                          </CardContent>
                        </Card>
                      )}

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium">Transcript</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm leading-6 text-foreground whitespace-pre-wrap">
                            {selectedRecentCapture.transcript?.trim() || "No transcript captured yet."}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {selectedRecentCapture.transcript?.trim() && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  void navigator.clipboard.writeText(selectedRecentCapture.transcript ?? "");
                                  toast({
                                    title: "Transcript copied",
                                    description: "The field note transcript is on your clipboard.",
                                  });
                                }}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy transcript
                              </Button>
                            )}
                            {looksLikeCrmRecordId(selectedRecentCapture.hubspot_deal_id ?? "") && (
                              <Button asChild size="sm">
                                <Link to={`/crm/deals/${selectedRecentCapture.hubspot_deal_id}`}>
                                  Open linked deal
                                </Link>
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <ExtractedSignalSummary extracted={extracted} compact />
                    </>
                  );
                })()}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load this note right now.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────

interface ResultCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function ResultCard({ icon, title, children }: ResultCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">{children}</CardContent>
    </Card>
  );
}

interface ExtractedFieldProps {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
  placeholder?: string;
  confidence?: "high" | "medium" | "low" | "unknown" | null;
  snippet?: string | null;
}

function ExtractedSignalSummary({
  extracted,
  compact = false,
}: {
  extracted: ExtractedDealData;
  compact?: boolean;
}) {
  const machineLabel = getExtractedMachineLabel(extracted);
  const attachments = extracted.opportunity.attachmentsDiscussed.join(", ");
  const competitors = extracted.opportunity.competitorsMentioned.join(", ");
  const actionItems = extracted.opportunity.actionItems;
  const opsSignals = [
    extracted.operations.serviceOpportunity ? "Service follow-up" : null,
    extracted.operations.partsOpportunity ? "Parts opportunity" : null,
    extracted.operations.rentalOpportunity ? "Rental fit" : null,
  ].filter(Boolean).join(" · ");

  const hasOperations =
    Boolean(opsSignals) ||
    Boolean(extracted.operations.branchRelevance) ||
    Boolean(extracted.operations.existingFleetContext) ||
    Boolean(extracted.operations.replacementTrigger) ||
    extracted.operations.crossSellOpportunity.length > 0;

  return (
    <>
      <ResultCard icon={<User className="w-4 h-4" />} title="Facts captured">
        <ExtractedField
          label="Contact"
          value={extracted.record.contactName}
          icon={<User className="w-3.5 h-3.5" />}
          placeholder="Not mentioned"
          snippet={getEvidenceSnippet(extracted, "contactName")?.quote}
        />
        <ExtractedField
          label="Role"
          value={extracted.record.contactRole}
          icon={<User className="w-3.5 h-3.5" />}
          placeholder="Unclear"
        />
        <ExtractedField
          label="Company"
          value={extracted.record.companyName}
          icon={<Building2 className="w-3.5 h-3.5" />}
          placeholder="Not mentioned"
        />
        <ExtractedField
          label="Type"
          value={extracted.record.companyType}
          icon={<Building2 className="w-3.5 h-3.5" />}
          placeholder="Unclear"
        />
        <ExtractedField
          label="Equipment"
          value={machineLabel}
          icon={<Tractor className="w-3.5 h-3.5" />}
          placeholder="Not mentioned"
          snippet={getEvidenceSnippet(extracted, "machineInterest")?.quote}
        />
        <ExtractedField
          label="Attachments"
          value={attachments || null}
          icon={<Wrench className="w-3.5 h-3.5" />}
          placeholder="Not mentioned"
        />
        <ExtractedField
          label="Use case"
          value={extracted.opportunity.applicationUseCase}
          icon={<FileText className="w-3.5 h-3.5" />}
          placeholder="Not mentioned"
        />
        <ExtractedField
          label="Stage"
          value={formatStageLabel(extracted.opportunity.dealStage)}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          placeholder="Unclear"
        />
      </ResultCard>

      <ResultCard icon={<TrendingUp className="w-4 h-4" />} title="Opportunity read">
        <ExtractedField
          label="Intent"
          value={formatEnumLabel(extracted.opportunity.intentLevel)}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          placeholder="Unknown"
          confidence={extracted.evidence.confidence.intentLevel}
        />
        <ExtractedField
          label="Urgency"
          value={formatEnumLabel(extracted.opportunity.urgencyLevel)}
          icon={<Clock className="w-3.5 h-3.5" />}
          placeholder="Unknown"
          confidence={extracted.evidence.confidence.urgencyLevel}
        />
        <ExtractedField
          label="Timeline"
          value={extracted.opportunity.timelineToBuy}
          icon={<CalendarDays className="w-3.5 h-3.5" />}
          placeholder="Not mentioned"
          snippet={getEvidenceSnippet(extracted, "timelineToBuy")?.quote}
        />
        <ExtractedField
          label="Financing"
          value={formatEnumLabel(extracted.opportunity.financingInterest)}
          icon={<DollarSign className="w-3.5 h-3.5" />}
          placeholder="Unknown"
          snippet={getEvidenceSnippet(extracted, "financingInterest")?.quote}
        />
        <ExtractedField
          label="New / used"
          value={formatEnumLabel(extracted.opportunity.newVsUsedPreference)}
          icon={<Tractor className="w-3.5 h-3.5" />}
          placeholder="Unknown"
        />
        <ExtractedField
          label="Trade-in"
          value={formatEnumLabel(extracted.opportunity.tradeInLikelihood)}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          placeholder="Unknown"
          snippet={getEvidenceSnippet(extracted, "tradeInLikelihood")?.quote}
        />
        <ExtractedField
          label="Quote"
          value={formatEnumLabel(extracted.opportunity.quoteReadiness)}
          icon={<FileText className="w-3.5 h-3.5" />}
          placeholder="Unknown"
        />
        <ExtractedField
          label="Competitors"
          value={competitors || null}
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          placeholder="Not mentioned"
          snippet={getEvidenceSnippet(extracted, "competitorsMentioned")?.quote}
        />
        <ExtractedField
          label="Concerns"
          value={extracted.opportunity.keyConcerns}
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          placeholder="Not mentioned"
        />
        <ExtractedField
          label="Next step"
          value={extracted.opportunity.nextStep}
          icon={<ListTodo className="w-3.5 h-3.5" />}
          placeholder="Not captured"
          snippet={getEvidenceSnippet(extracted, "nextStep")?.quote}
        />
        <ExtractedField
          label="Follow-up"
          value={formatMaybeDate(extracted.opportunity.followUpDate)}
          icon={<CalendarDays className="w-3.5 h-3.5" />}
          placeholder="No date captured"
        />
        {actionItems.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs text-muted-foreground">Action items</p>
            <ul className="space-y-1">
              {actionItems.map((item, i) => (
                <li key={`${item}-${i}`} className="flex gap-2 text-sm">
                  <span className="text-primary mt-0.5 flex-shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ResultCard>

      {hasOperations && !compact && (
        <ResultCard icon={<Wrench className="w-4 h-4" />} title="Dealership ops read">
          <ExtractedField
            label="Ops signal"
            value={opsSignals || null}
            icon={<Wrench className="w-3.5 h-3.5" />}
          />
          <ExtractedField
            label="Branch"
            value={extracted.operations.branchRelevance}
            icon={<Building2 className="w-3.5 h-3.5" />}
          />
          <ExtractedField
            label="Fleet"
            value={extracted.operations.existingFleetContext}
            icon={<Tractor className="w-3.5 h-3.5" />}
          />
          <ExtractedField
            label="Replacement"
            value={extracted.operations.replacementTrigger}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          />
          <ExtractedField
            label="Cross-sell"
            value={extracted.operations.crossSellOpportunity.join(", ") || null}
            icon={<Sparkles className="w-3.5 h-3.5" />}
          />
        </ResultCard>
      )}

      <ResultCard icon={<Sparkles className="w-4 h-4" />} title="AI read">
        <ExtractedField
          label="Sentiment"
          value={formatEnumLabel(extracted.guidance.customerSentiment)}
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          placeholder="Unknown"
          confidence={extracted.evidence.confidence.customerSentiment}
        />
        <ExtractedField
          label="Win odds"
          value={formatEnumLabel(extracted.guidance.probabilitySignal)}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          placeholder="Unknown"
          confidence={extracted.evidence.confidence.probabilitySignal}
        />
        <ExtractedField
          label="Stall risk"
          value={formatEnumLabel(extracted.guidance.stalledRisk)}
          icon={<AlertCircle className="w-3.5 h-3.5" />}
          placeholder="Unknown"
          confidence={extracted.evidence.confidence.stalledRisk}
        />
        <ExtractedField
          label="Persona"
          value={formatEnumLabel(extracted.guidance.buyerPersona)}
          icon={<Cpu className="w-3.5 h-3.5" />}
          placeholder="Unknown"
          confidence={extracted.evidence.confidence.buyerPersona}
        />
        <ExtractedField
          label="Rep guidance"
          value={extracted.guidance.recommendedNextAction}
          icon={<Sparkles className="w-3.5 h-3.5" />}
          placeholder="No recommendation yet"
          confidence={extracted.evidence.confidence.recommendedNextAction}
        />
        {!compact && (
          <>
            <ExtractedField
              label="Follow-up"
              value={formatEnumLabel(extracted.guidance.recommendedFollowUpMode)}
              icon={<Send className="w-3.5 h-3.5" />}
              placeholder="Unknown"
            />
            <ExtractedField
              label="Manager"
              value={extracted.guidance.managerAttentionFlag ? "Manager review recommended" : "No manager escalation"}
              icon={<AlertCircle className="w-3.5 h-3.5" />}
            />
            <ExtractedField
              label="Rep summary"
              value={extracted.guidance.summaryForRep}
              icon={<FileText className="w-3.5 h-3.5" />}
            />
            <ExtractedField
              label="Manager summary"
              value={extracted.guidance.summaryForManager}
              icon={<FileText className="w-3.5 h-3.5" />}
            />
          </>
        )}
      </ResultCard>

      {extracted.evidence.snippets.length > 0 && (
        <ResultCard icon={<Copy className="w-4 h-4" />} title="Supporting evidence">
          <div className="space-y-2">
            {extracted.evidence.snippets.map((snippet, index) => (
              <div
                key={`${snippet.field}-${index}`}
                className="rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {formatEnumLabel(snippet.field) ?? snippet.field}
                  </span>
                  {snippet.confidence && snippet.confidence !== "unknown" && (
                    <ConfidenceBadge confidence={snippet.confidence} />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">&ldquo;{snippet.quote}&rdquo;</p>
              </div>
            ))}
          </div>
        </ResultCard>
      )}
    </>
  );
}

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" | "unknown" }) {
  const tone = CONFIDENCE_TONE[confidence];
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", tone.className)}>
      {tone.label}
    </span>
  );
}

function ExtractedField({
  label,
  value,
  icon,
  placeholder,
  confidence,
  snippet,
}: ExtractedFieldProps) {
  const displayValue = value ?? placeholder ?? null;
  if (!displayValue) return null;
  const isPlaceholder = !value;
  return (
    <div className="flex gap-3 items-start">
      {icon && <span className="text-muted-foreground flex-shrink-0 mt-0.5">{icon}</span>}
      <span className="text-xs text-muted-foreground w-20 flex-shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm", isPlaceholder ? "text-muted-foreground" : "text-foreground")}>
            {displayValue}
          </span>
          {confidence && confidence !== "unknown" && !isPlaceholder && (
            <ConfidenceBadge confidence={confidence} />
          )}
        </div>
        {snippet && !isPlaceholder && (
          <p className="text-xs text-muted-foreground">&ldquo;{snippet}&rdquo;</p>
        )}
      </div>
    </div>
  );
}
