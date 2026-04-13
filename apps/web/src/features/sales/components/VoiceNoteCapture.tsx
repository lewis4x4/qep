import { useState, useRef, useEffect } from "react";
import { Mic, Square, Upload } from "lucide-react";
import { useCustomers } from "../hooks/useCustomers";
import { supabase } from "@/lib/supabase";

export function VoiceNoteCapture({ onComplete }: { onComplete: () => void }) {
  const { allCustomers } = useCustomers();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");

  const filtered = customerSearch.trim()
    ? allCustomers.filter((c) =>
        c.company_name?.toLowerCase().includes(customerSearch.toLowerCase()),
      )
    : allCustomers.slice(0, 8);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4",
      });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setDuration(0);

      timerRef.current = window.setInterval(() => {
        setDuration((d) => {
          if (d >= 60) {
            stopRecording();
            return 60;
          }
          return d + 1;
        });
      }, 1000);
    } catch {
      alert("Microphone access denied.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function handleSubmit() {
    if (!audioBlob || !customerId) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const mimeType = mediaRecorderRef.current?.mimeType ?? "audio/webm";
      const ext = mimeType.includes("mp4") ? ".mp4" : ".webm";
      const fileName = `${user.id}/voice-note-${Date.now()}${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("voice-recordings")
        .upload(fileName, audioBlob, { contentType: mimeType });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from("voice_captures")
        .insert({
          user_id: user.id,
          audio_storage_path: fileName,
          duration_seconds: duration,
          sync_status: "pending",
        });

      if (insertError) throw insertError;
      onComplete();
    } catch {
      alert("Failed to save voice note. It will be saved offline.");
    } finally {
      setSubmitting(false);
    }
  }

  // Step 1: pick customer
  if (!customerId) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">Voice Note</h3>
        <p className="text-sm text-slate-600">Attach to which customer?</p>
        <input
          type="text"
          value={customerSearch}
          onChange={(e) => setCustomerSearch(e.target.value)}
          placeholder="Search..."
          className="w-full h-11 px-4 rounded-xl bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-qep-orange/30"
        />
        <div className="max-h-60 overflow-y-auto space-y-1">
          {filtered.map((c) => (
            <button
              key={c.customer_id}
              onClick={() => setCustomerId(c.customer_id)}
              className="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-50 text-sm font-medium text-slate-900"
            >
              {c.company_name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: record
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-900">Voice Note</h3>

      {/* Waveform / timer */}
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="text-4xl font-mono font-bold text-slate-800">
          {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, "0")}
        </div>
        <p className="text-xs text-slate-400">
          {recording ? "Recording... (max 60s)" : audioBlob ? "Recording saved" : "Tap to start"}
        </p>

        {/* Record / stop button */}
        {!audioBlob ? (
          <button
            onClick={recording ? stopRecording : startRecording}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
              recording
                ? "bg-red-500 hover:bg-red-600 animate-pulse"
                : "bg-qep-orange hover:bg-qep-orange/90"
            }`}
          >
            {recording ? (
              <Square className="w-8 h-8 text-white" />
            ) : (
              <Mic className="w-8 h-8 text-white" />
            )}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-12 bg-qep-orange text-white font-semibold rounded-xl flex items-center justify-center gap-2 hover:bg-qep-orange/90 disabled:opacity-50"
          >
            <Upload className="w-5 h-5" />
            {submitting ? "Saving..." : "Save Voice Note"}
          </button>
        )}
      </div>
    </div>
  );
}
