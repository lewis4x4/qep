import { useState, useRef, useEffect, useCallback } from "react";
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
  ChevronDown,
  Send,
  Clock,
  XCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { UserRole, ExtractedDealData, Database } from "../lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { crmSupabase } from "@/features/crm/lib/crm-supabase";

interface VoiceCapturePageProps {
  userRole: UserRole;
  userEmail: string | null;
}

type RecordingState =
  | "idle"
  | "recording"
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
  hubspot_deal_id: string | null;
  hubspot_note_id: string | null;
  hubspot_task_id: string | null;
}

interface DealLookupOption {
  id: string;
  name: string;
  companyName: string | null;
}

type RecentCapture = Pick<
  Database["public"]["Tables"]["voice_captures"]["Row"],
  "id" | "created_at" | "duration_seconds" | "sync_status" | "hubspot_deal_id" | "transcript"
>;

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

function looksLikeCrmRecordId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function formatVoiceCaptureSyncStatus(status: RecentCapture["sync_status"]): string {
  switch (status) {
    case "synced":
      return "Saved to CRM";
    case "failed":
      return "Needs attention";
    case "processing":
      return "Processing";
    default:
      return "Queued";
  }
}

export function VoiceCapturePage({ userRole: _userRole, userEmail: _userEmail }: VoiceCapturePageProps) {
  const { toast } = useToast();
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [hubspotDealId, setHubspotDealId] = useState("");
  const [dealLookupQuery, setDealLookupQuery] = useState("");
  const [dealLookupOptions, setDealLookupOptions] = useState<DealLookupOption[]>([]);
  const [dealLookupLoading, setDealLookupLoading] = useState(false);
  const [selectedDealLabel, setSelectedDealLabel] = useState<string | null>(null);
  const [resolvedDealOption, setResolvedDealOption] = useState<DealLookupOption | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [editedTranscript, setEditedTranscript] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState(0);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [pushingToHubspot, setPushingToHubspot] = useState(false);
  const [recentCaptures, setRecentCaptures] = useState<RecentCapture[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  // Track viewport width for responsive tooltip positioning (QUA-75)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent captures on mount
  useEffect(() => {
    void loadRecentCaptures();
  }, []);

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
      .select("id, created_at, duration_seconds, sync_status, hubspot_deal_id, transcript")
      .order("created_at", { ascending: false })
      .limit(5);
    // Defense-in-depth: scope to own rows for non-elevated roles (RLS also enforces this)
    if (!isElevated) {
      query = query.eq("user_id", user.id);
    }
    const { data } = await query;
    if (data) setRecentCaptures(data);
    setRecentLoading(false);
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

  const startRecording = useCallback(async () => {
    setErrorMessage(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch {
      setErrorMessage(
        "Microphone access was denied. Please allow microphone access and try again."
      );
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "audio/webm";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioBlobUrl(url);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    recorder.start(250);
    setRecordingState("recording");
    setElapsedSeconds(0);

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
    setRecordingState("recorded");
  }, []);

  const resetCapture = useCallback(() => {
    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    setAudioBlob(null);
    setAudioBlobUrl(null);
    setElapsedSeconds(0);
    setHubspotDealId("");
    setDealLookupQuery("");
    setDealLookupOptions([]);
    setSelectedDealLabel(null);
    setResolvedDealOption(null);
    setResult(null);
    setEditedTranscript("");
    setErrorMessage(null);
    setTranscriptOpen(false);
    setTranscriptCopied(false);
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

      setResult((prev) => prev ? { ...prev, hubspot_synced: true } : prev);
      void loadRecentCaptures();
      toast({ title: "Pushed to CRM", description: "Note and task were added to the deal." });
    } catch (err) {
      toast({
        title: "CRM sync failed",
        description: err instanceof Error ? err.message : "Sync failed",
        variant: "destructive",
      });
    } finally {
      setPushingToHubspot(false);
    }
  }

  async function submitCapture(): Promise<void> {
    if (!audioBlob) return;

    setRecordingState("processing");
    setErrorMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const form = new FormData();
      form.append("audio", audioBlob, "recording");
      if (hubspotDealId.trim()) {
        form.append("crm_deal_id", hubspotDealId.trim());
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
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error((err as { error?: string }).error ?? "Processing failed");
      }

      const data = (await res.json()) as CaptureResult;

      // Mark final step complete before showing results
      setProcessingStep(3);
      await new Promise((r) => setTimeout(r, 600));

      setResult(data);
      setEditedTranscript(data.transcript);
      setRecordingState("done");
      void loadRecentCaptures();

      if (data.hubspot_synced) {
        toast({
          title: "Saved to CRM",
          description: "Note and follow-up task were attached to the deal.",
        });
      } else {
        toast({
          title: "Saved locally",
          description: "CRM sync will run once the live connection is available.",
          variant: "destructive",
        });
      }
    } catch (err) {
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

  async function copyTranscript(): Promise<void> {
    const text = editedTranscript || result?.transcript;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setTranscriptCopied(true);
    setTimeout(() => setTranscriptCopied(false), 2000);
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

  function renderDealLookupField(inputId: string): React.JSX.Element {
    const trimmedQuery = dealLookupQuery.trim();
    const isDirectId = looksLikeCrmRecordId(trimmedQuery);
    const showOptions = trimmedQuery.length >= 2 && !isDirectId;
    const selectedSummary = selectedDealLabel
      ? { title: selectedDealLabel, detail: hubspotDealId }
      : hubspotDealId
      ? { title: "Linked by pasted CRM deal ID", detail: hubspotDealId }
      : null;

    return (
      <div className="space-y-2">
        <Input
          id={inputId}
          type="text"
          value={dealLookupQuery}
          onChange={(e) => handleDealLookupChange(e.target.value)}
          placeholder="Search by deal name or paste CRM deal ID"
          autoComplete="off"
        />

        {selectedSummary && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{selectedSummary.title}</p>
              <p className="truncate text-xs text-muted-foreground">{selectedSummary.detail}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={clearDealSelection}
            >
              Clear
            </Button>
          </div>
        )}

        {showOptions && (
          <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            {dealLookupLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching deals...
              </div>
            ) : dealLookupOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                No matching deals found. Paste a CRM deal ID if you already have one.
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

        <p className="text-xs text-muted-foreground">
          Search by deal name or paste the CRM deal ID directly. If you leave it blank, we&apos;ll
          still try to match the note by customer details.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex-1 overflow-y-auto">
        <div className="xl:max-w-5xl mx-auto px-4 py-6">

          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-foreground">Field Note</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Record a quick summary after your visit — we'll pull out the key details and push them into CRM.
            </p>
          </div>

          <div className="xl:grid xl:grid-cols-12 xl:gap-8">

          {/* Main recording area — 7 cols */}
          <div className="xl:col-span-7 space-y-6">

          {/* ── IDLE ──────────────────────────────────────────────────────────── */}
          {recordingState === "idle" && (
            <div className="space-y-6">
              {/* CRM Deal input */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor="deal-id">CRM Deal ID</Label>
                  <span className="text-xs text-muted-foreground">(optional)</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="What is a CRM deal ID?"
                        className="h-11 w-11 inline-flex items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-2"
                      >
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side={isMobile ? "bottom" : "right"} align={isMobile ? "start" : "center"} className="max-w-[200px]">
                      Search by deal name or paste the CRM deal ID to link this note directly.
                    </TooltipContent>
                  </Tooltip>
                </div>
                {renderDealLookupField("deal-id")}
              </div>

              {/* Record button */}
              <div className="flex flex-col items-center gap-3 pt-4">
                <button
                  onClick={startRecording}
                  className="w-24 h-24 bg-primary rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="Start recording"
                >
                  <Mic className="w-10 h-10 text-primary-foreground" />
                </button>
                <p className="text-sm text-muted-foreground">Tap to Record</p>
              </div>
            </div>
          )}

          {/* ── RECORDING ─────────────────────────────────────────────────────── */}
          {recordingState === "recording" && (
            <div className="flex flex-col items-center gap-6 pt-4">
              <div className="relative flex items-center justify-center">
                {/* Pulse rings */}
                <span className="absolute inline-flex h-28 w-28 rounded-full bg-destructive opacity-20 animate-ping" />
                <span className="absolute inline-flex h-24 w-24 rounded-full bg-destructive opacity-15 animate-ping [animation-delay:200ms]" />
                <button
                  onClick={stopRecording}
                  className="relative z-10 w-24 h-24 bg-destructive rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="Stop recording"
                >
                  <Square className="w-10 h-10 text-destructive-foreground fill-current" />
                </button>
              </div>

              {/* Waveform */}
              <div className="flex items-end gap-1 h-10" aria-hidden="true">
                {Array.from({ length: 20 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-1.5 rounded-full bg-primary"
                    style={{
                      animation: `waveform 0.8s ease-in-out ${(i * 0.06).toFixed(2)}s infinite alternate`,
                      height: `${20 + Math.sin(i * 0.9) * 14}px`,
                    }}
                  />
                ))}
              </div>

              <div className="text-center">
                <p className="text-3xl font-mono font-semibold tabular-nums">
                  {formatTime(elapsedSeconds)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Recording...</p>
              </div>

              {elapsedSeconds > 90 && (
                <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                  Try to keep it under 2 minutes for best results
                </Badge>
              )}
            </div>
          )}

          {/* ── RECORDED ──────────────────────────────────────────────────────── */}
          {recordingState === "recorded" && audioBlob && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">Review Recording</CardTitle>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatTime(elapsedSeconds)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {audioBlobUrl && (
                    <audio controls src={audioBlobUrl} className="w-full h-10" />
                  )}
                </CardContent>
              </Card>

              {/* Deal link (editable) */}
              <div className="space-y-1.5">
                <Label htmlFor="deal-id-review">CRM Deal ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
                {renderDealLookupField("deal-id-review")}
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={resetCapture}
                >
                  Re-record
                </Button>
                <Button
                  className="flex-1"
                  onClick={submitCapture}
                >
                  Process Note
                </Button>
              </div>
            </div>
          )}

          {/* ── PROCESSING ────────────────────────────────────────────────────── */}
          {recordingState === "processing" && (
            <Card>
              <CardContent className="pt-6 pb-6">
                <div className="space-y-4">
                  {PROCESSING_STEPS.map((step, index) => {
                    const isComplete = processingStep > index;
                    const isActive = processingStep === index;
                    const isPending = processingStep < index;
                    const StepIcon = step.icon;
                    return (
                      <div
                        key={step.label}
                        className={cn(
                          "flex items-center gap-3 transition-opacity duration-300",
                          isPending && "opacity-35"
                        )}
                      >
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
                            isComplete && "bg-primary text-primary-foreground",
                            isActive && "bg-primary/10 text-primary",
                            isPending && "bg-muted text-muted-foreground"
                          )}
                        >
                          {isComplete ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : isActive ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <StepIcon className="w-4 h-4" />
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-sm font-medium transition-colors",
                            isComplete && "text-primary",
                            isActive && "text-foreground",
                            isPending && "text-muted-foreground"
                          )}
                        >
                          {step.label}
                        </span>
                        {index < PROCESSING_STEPS.length - 1 && (
                          <div className="flex-1 border-b border-dashed border-border ml-auto w-4" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── ERROR ─────────────────────────────────────────────────────────── */}
          {recordingState === "error" && (
            <div className="space-y-4">
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="pt-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-destructive">Processing failed</p>
                    {errorMessage && (
                      <p className="text-xs text-destructive/80 mt-1">{errorMessage}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Button variant="outline" className="w-full" onClick={resetCapture}>
                Start over
              </Button>
            </div>
          )}

          {/* ── DONE ──────────────────────────────────────────────────────────── */}
          {recordingState === "done" && result && (
            <div className="space-y-4">
              {(() => {
                const linkedDealId = result.hubspot_deal_id ?? hubspotDealId ?? null;
                const linkedDealTitle = resolvedDealOption
                  ? resolvedDealOption.companyName
                    ? `${resolvedDealOption.name} · ${resolvedDealOption.companyName}`
                    : resolvedDealOption.name
                  : selectedDealLabel;

                if (!linkedDealId) {
                  return null;
                }

                return (
                  <ResultCard
                    icon={<Building2 className="w-4 h-4" />}
                    title="CRM Link"
                  >
                    <ExtractedField
                      label="Linked deal"
                      value={linkedDealTitle ?? "CRM deal linked"}
                      icon={<Building2 className="w-3.5 h-3.5" />}
                    />
                    <ExtractedField
                      label="Deal ID"
                      value={linkedDealId}
                      icon={<FileText className="w-3.5 h-3.5" />}
                    />
                  </ResultCard>
                );
              })()}

              {/* CRM sync status */}
              <div className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3",
                result.hubspot_synced
                  ? "border-green-200 bg-green-50"
                  : "border-amber-200 bg-amber-50"
              )}>
                {result.hubspot_synced ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-green-800">Saved to CRM</p>
                      <p className="text-xs text-green-600 mt-0.5">Note and follow-up task are attached to the deal.</p>
                    </div>
                    <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
                      Synced
                    </Badge>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-800">Saved locally</p>
                      <p className="text-xs text-amber-600 mt-0.5">Live CRM sync isn't connected yet — this note is safe and ready to sync later.</p>
                    </div>
                    <Badge variant="outline" className="text-amber-600 border-amber-300">
                      Pending
                    </Badge>
                  </>
                )}
              </div>

              {/* Customer Info */}
              {(result.extracted_data.customer_name || result.extracted_data.company_name) && (
                <ResultCard
                  icon={<User className="w-4 h-4" />}
                  title="Customer Info"
                >
                  <ExtractedField label="Name" value={result.extracted_data.customer_name} icon={<User className="w-3.5 h-3.5" />} />
                  <ExtractedField label="Company" value={result.extracted_data.company_name} icon={<Building2 className="w-3.5 h-3.5" />} />
                </ResultCard>
              )}

              {/* Equipment Interest */}
              {(result.extracted_data.machine_interest || result.extracted_data.attachments_discussed) && (
                <ResultCard
                  icon={<Tractor className="w-4 h-4" />}
                  title="Equipment Interest"
                >
                  <ExtractedField label="Equipment" value={result.extracted_data.machine_interest} icon={<Tractor className="w-3.5 h-3.5" />} />
                  <ExtractedField label="Attachments" value={result.extracted_data.attachments_discussed} icon={<Wrench className="w-3.5 h-3.5" />} />
                </ResultCard>
              )}

              {/* Deal Details */}
              {(result.extracted_data.deal_stage || result.extracted_data.budget_range || result.extracted_data.key_concerns) && (
                <ResultCard
                  icon={<TrendingUp className="w-4 h-4" />}
                  title="Deal Details"
                >
                  <ExtractedField
                    label="Stage"
                    value={
                      result.extracted_data.deal_stage
                        ? (DEAL_STAGE_LABELS[result.extracted_data.deal_stage] ?? result.extracted_data.deal_stage)
                        : null
                    }
                    icon={<TrendingUp className="w-3.5 h-3.5" />}
                  />
                  <ExtractedField label="Budget" value={result.extracted_data.budget_range} icon={<DollarSign className="w-3.5 h-3.5" />} />
                  <ExtractedField label="Concerns" value={result.extracted_data.key_concerns} icon={<MessageSquare className="w-3.5 h-3.5" />} />
                </ResultCard>
              )}

              {/* Action Items */}
              {(result.extracted_data.next_step || result.extracted_data.follow_up_date || result.extracted_data.action_items.length > 0) && (
                <ResultCard
                  icon={<ListTodo className="w-4 h-4" />}
                  title="Action Items"
                >
                  <ExtractedField label="Next step" value={result.extracted_data.next_step} icon={<RefreshCw className="w-3.5 h-3.5" />} />
                  <ExtractedField
                    label="Follow-up"
                    value={
                      result.extracted_data.follow_up_date
                        ? new Date(result.extracted_data.follow_up_date).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })
                        : null
                    }
                    icon={<CalendarDays className="w-3.5 h-3.5" />}
                  />
                  {result.extracted_data.action_items.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-xs text-muted-foreground">Tasks</p>
                      <ul className="space-y-1">
                        {result.extracted_data.action_items.map((item, i) => (
                          <li key={i} className="flex gap-2 text-sm">
                            <span className="text-primary flex-shrink-0 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </ResultCard>
              )}

              {/* Transcript (collapsible, editable) */}
              <Card>
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors rounded-t-lg"
                  onClick={() => setTranscriptOpen((o) => !o)}
                  aria-expanded={transcriptOpen}
                >
                  <span>Full Transcript</span>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-muted-foreground transition-transform duration-200",
                      transcriptOpen && "rotate-180"
                    )}
                  />
                </button>
                {transcriptOpen && (
                  <CardContent className="pt-0 space-y-3">
                    <div className="relative">
                      <textarea
                        className="w-full text-sm text-foreground leading-relaxed font-mono bg-muted rounded-md p-3 pr-10 resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-qep-orange border-0"
                        value={editedTranscript}
                        onChange={(e) => setEditedTranscript(e.target.value)}
                        aria-label="Edit transcript"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2 h-11 w-11 p-0"
                        onClick={copyTranscript}
                        aria-label="Copy transcript"
                      >
                        {transcriptCopied ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* Action buttons */}
              <div className="flex gap-3">
                {!result.hubspot_synced && (
                  <Button
                    className="flex-1"
                    onClick={() => void pushToHubspot()}
                    disabled={pushingToHubspot}
                  >
                    {pushingToHubspot ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Push to CRM
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className={cn("flex-1", result.hubspot_synced && "flex-none")}
                  onClick={resetCapture}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  {result.hubspot_synced ? "Record Another" : "Discard"}
                </Button>
              </div>
            </div>
          )}

          {/* ── RECENT RECORDINGS ───────────────────────────────────────────── */}
          {(recordingState === "idle" || recordingState === "done") && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Recent Recordings</h2>
              </div>
              {recentLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-12 bg-muted rounded-md animate-pulse" />
                  ))}
                </div>
              ) : recentCaptures.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recordings yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentCaptures.map((cap) => {
                    const snippet = cap.transcript
                      ? cap.transcript.slice(0, 60) + (cap.transcript.length > 60 ? "…" : "")
                      : "No transcript";
                    return (
                      <Card key={cap.id}>
                        <CardContent className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground truncate">{snippet}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {new Date(cap.created_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                                {cap.duration_seconds != null && ` · ${formatTime(cap.duration_seconds)}`}
                              </p>
                            </div>
                            <Badge
                              variant={
                                cap.sync_status === "synced"
                                  ? "default"
                                  : cap.sync_status === "failed"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="text-xs shrink-0"
                            >
                              {formatVoiceCaptureSyncStatus(cap.sync_status)}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          </div>{/* end main col */}

          {/* Context panel — 5 cols, xl+ only */}
          <aside className="hidden xl:flex xl:col-span-5 flex-col gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">What to include</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span><span className="font-medium text-foreground">Customer name &amp; company</span> — who you met with and where</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span><span className="font-medium text-foreground">Equipment interest</span> — model numbers, categories, attachments discussed</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span><span className="font-medium text-foreground">Deal stage</span> — where they are in the buying process</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span><span className="font-medium text-foreground">Budget &amp; timeline</span> — any numbers or urgency mentioned</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span><span className="font-medium text-foreground">Next steps</span> — follow-up date, callback, quote request</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Tips for best results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Keep recordings under 2 minutes. Speak clearly and mention names and model numbers explicitly.</p>
                <p>Record immediately after the visit while details are fresh.</p>
                <p>If you know the CRM deal ID, paste it before recording to link the note automatically.</p>
              </CardContent>
            </Card>
          </aside>

          </div>{/* end grid */}
        </div>
      </div>
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
}

function ExtractedField({ label, value, icon }: ExtractedFieldProps) {
  if (!value) return null;
  return (
    <div className="flex gap-3 items-start">
      {icon && <span className="text-muted-foreground flex-shrink-0 mt-0.5">{icon}</span>}
      <span className="text-xs text-muted-foreground w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-foreground flex-1">{value}</span>
    </div>
  );
}
