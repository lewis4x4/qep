import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { UserRole, ExtractedDealData } from "../lib/database.types";

interface VoiceCapturePageProps {
  userRole: UserRole;
  userEmail: string | null;
}

type RecordingState = "idle" | "recording" | "recorded" | "processing" | "done" | "error";

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

const DEAL_STAGE_LABELS: Record<string, string> = {
  initial_contact: "Initial Contact",
  follow_up: "Follow-Up",
  demo_scheduled: "Demo Scheduled",
  quote_sent: "Quote Sent",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

export function VoiceCapturePage({ userRole, userEmail }: VoiceCapturePageProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [hubspotDealId, setHubspotDealId] = useState("");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [audioBlobUrl]);

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

    // Pick the best supported format (webm for Chrome/Android, mp4 for Safari/iOS)
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

    recorder.start(250); // collect data every 250ms
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
    setResult(null);
    setErrorMessage(null);
    setRecordingState("idle");
  }, [audioBlobUrl]);

  async function submitCapture() {
    if (!audioBlob) return;

    setRecordingState("processing");
    setErrorMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const form = new FormData();
      form.append("audio", audioBlob, "recording");
      if (hubspotDealId.trim()) {
        form.append("hubspot_deal_id", hubspotDealId.trim());
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
        throw new Error(err.error ?? "Processing failed");
      }

      const data = (await res.json()) as CaptureResult;
      setResult(data);
      setRecordingState("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setErrorMessage(message);
      setRecordingState("error");
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <MicIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Field Note</h1>
            <p className="text-xs text-gray-400 capitalize">{userRole}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-xs text-blue-600 hover:underline">Knowledge</a>
          {["admin", "manager", "owner"].includes(userRole) && (
            <a href="/admin" className="text-xs text-blue-600 hover:underline">Admin</a>
          )}
          <button onClick={handleSignOut} className="text-xs text-gray-500 hover:text-gray-700">
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">

        {/* ── IDLE / PRE-RECORD ─────────────────────────────────────────── */}
        {(recordingState === "idle") && (
          <div className="space-y-6">
            <div className="text-center pt-4">
              <p className="text-sm text-gray-500">
                Record a quick summary after your visit. We'll pull out the key details and push them to HubSpot.
              </p>
            </div>

            {/* Optional deal ID */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                HubSpot Deal ID <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={hubspotDealId}
                onChange={(e) => setHubspotDealId(e.target.value)}
                placeholder="Paste the deal ID if you know it"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">
                Don't know it? We'll try to match by customer name automatically.
              </p>
            </div>

            {/* Record button */}
            <div className="flex flex-col items-center gap-3 pt-4">
              <button
                onClick={startRecording}
                className="w-24 h-24 bg-orange-500 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform hover:bg-orange-600"
              >
                <MicIcon className="w-10 h-10 text-white" />
              </button>
              <p className="text-sm text-gray-500">Tap to start recording</p>
            </div>
          </div>
        )}

        {/* ── RECORDING ──────────────────────────────────────────────────── */}
        {recordingState === "recording" && (
          <div className="flex flex-col items-center gap-6 pt-8">
            <div className="relative">
              {/* Pulse rings */}
              <div className="absolute inset-0 rounded-full bg-red-400 opacity-30 animate-ping" />
              <div className="absolute inset-2 rounded-full bg-red-400 opacity-20 animate-ping" style={{ animationDelay: "150ms" }} />
              <button
                onClick={stopRecording}
                className="relative w-24 h-24 bg-red-500 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform hover:bg-red-600 z-10"
              >
                <StopIcon className="w-10 h-10 text-white" />
              </button>
            </div>
            <div className="text-center">
              <p className="text-3xl font-mono font-semibold text-gray-800">
                {formatTime(elapsedSeconds)}
              </p>
              <p className="text-sm text-gray-500 mt-1">Recording — tap to stop</p>
            </div>
            {elapsedSeconds > 90 && (
              <p className="text-xs text-amber-600 text-center">
                Try to keep it under 2 minutes for best results.
              </p>
            )}
          </div>
        )}

        {/* ── RECORDED (review before submit) ──────────────────────────── */}
        {recordingState === "recorded" && audioBlob && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Recording ready</span>
                <span className="text-xs text-gray-400">{formatTime(elapsedSeconds)}</span>
              </div>
              {audioBlobUrl && (
                <audio controls src={audioBlobUrl} className="w-full h-10" />
              )}
            </div>

            {/* Deal ID (editable before submit) */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                HubSpot Deal ID <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={hubspotDealId}
                onChange={(e) => setHubspotDealId(e.target.value)}
                placeholder="Paste deal ID if known"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetCapture}
                className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 transition"
              >
                Re-record
              </button>
              <button
                onClick={submitCapture}
                className="flex-2 bg-orange-500 text-white rounded-xl py-3 px-6 text-sm font-medium hover:bg-orange-600 transition flex-1"
              >
                Process Note
              </button>
            </div>
          </div>
        )}

        {/* ── PROCESSING ─────────────────────────────────────────────────── */}
        {recordingState === "processing" && (
          <div className="flex flex-col items-center gap-4 pt-12">
            <div className="w-12 h-12 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-gray-700">Processing your note...</p>
              <p className="text-xs text-gray-400">Transcribing and pulling out deal details</p>
            </div>
          </div>
        )}

        {/* ── ERROR ──────────────────────────────────────────────────────── */}
        {(recordingState === "error") && (
          <div className="space-y-4 pt-4">
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <p className="text-sm font-medium text-red-800">Something went wrong</p>
              {errorMessage && (
                <p className="text-xs text-red-600 mt-1">{errorMessage}</p>
              )}
            </div>
            <button
              onClick={resetCapture}
              className="w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 transition"
            >
              Start over
            </button>
          </div>
        )}

        {/* ── DONE — show extracted results ─────────────────────────────── */}
        {recordingState === "done" && result && (
          <div className="space-y-4">
            {/* HubSpot sync status */}
            <div className={`rounded-2xl p-4 flex items-start gap-3 ${
              result.hubspot_synced
                ? "bg-green-50 border border-green-200"
                : "bg-amber-50 border border-amber-200"
            }`}>
              {result.hubspot_synced ? (
                <>
                  <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Saved to HubSpot</p>
                    <p className="text-xs text-green-600 mt-0.5">
                      Note and follow-up task added to the deal.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <AlertIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Saved locally</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      HubSpot isn't connected yet — your note is saved and will sync once connected.
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Extracted data card */}
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
              <div className="px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">What we pulled out</h2>
              </div>

              <ExtractedField label="Customer" value={result.extracted_data.customer_name} />
              <ExtractedField label="Company" value={result.extracted_data.company_name} />
              <ExtractedField label="Equipment" value={result.extracted_data.machine_interest} />
              <ExtractedField label="Attachments" value={result.extracted_data.attachments_discussed} />
              <ExtractedField
                label="Deal stage"
                value={
                  result.extracted_data.deal_stage
                    ? DEAL_STAGE_LABELS[result.extracted_data.deal_stage] ?? result.extracted_data.deal_stage
                    : null
                }
              />
              <ExtractedField label="Budget" value={result.extracted_data.budget_range} />
              <ExtractedField label="Key concerns" value={result.extracted_data.key_concerns} />
              <ExtractedField label="Next step" value={result.extracted_data.next_step} />
              <ExtractedField
                label="Follow-up date"
                value={
                  result.extracted_data.follow_up_date
                    ? new Date(result.extracted_data.follow_up_date).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : null
                }
              />

              {result.extracted_data.action_items.length > 0 && (
                <div className="px-4 py-3">
                  <p className="text-xs text-gray-400 mb-1.5">Action items</p>
                  <ul className="space-y-1">
                    {result.extracted_data.action_items.map((item, i) => (
                      <li key={i} className="text-sm text-gray-800 flex gap-2">
                        <span className="text-orange-400 flex-shrink-0">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Transcript (collapsible) */}
            <details className="bg-white rounded-2xl border border-gray-200">
              <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer select-none">
                Full transcript
              </summary>
              <div className="px-4 pb-4">
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {result.transcript}
                </p>
              </div>
            </details>

            <button
              onClick={resetCapture}
              className="w-full bg-orange-500 text-white rounded-xl py-3 text-sm font-medium hover:bg-orange-600 transition"
            >
              Record another note
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ExtractedField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="px-4 py-3 flex gap-3">
      <span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">{value}</span>
    </div>
  );
}

// ── Inline SVG icons (no external dep) ────────────────────────────────────────

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" />
    </svg>
  );
}
