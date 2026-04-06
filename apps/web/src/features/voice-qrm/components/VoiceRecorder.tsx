import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Upload, RotateCcw } from "lucide-react";

interface VoiceRecorderProps {
  onRecorded: (audioBlob: Blob, fileName: string) => void;
  disabled?: boolean;
}

type RecorderState = "idle" | "recording" | "ready";

/** Picks the best supported mimeType in the current browser. */
function pickMimeType(): { mimeType: string; fileName: string } {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", fileName: "recording.webm" },
    { mimeType: "audio/webm", fileName: "recording.webm" },
    { mimeType: "audio/mp4", fileName: "recording.m4a" },
    { mimeType: "audio/ogg;codecs=opus", fileName: "recording.ogg" },
  ];

  for (const c of candidates) {
    // Some Safari versions don't have MediaRecorder.isTypeSupported
    const isSupported =
      typeof MediaRecorder !== "undefined" &&
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(c.mimeType);
    if (isSupported) return c;
  }
  return { mimeType: "", fileName: "recording.webm" };
}

export function VoiceRecorder({ onRecorded, disabled }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedFileName, setRecordedFileName] = useState<string>("recording.webm");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopTimer();
      cleanupStream();
    };
  }, []);

  function cleanupStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startRecording() {
    setErrorMessage(null);
    setElapsedSec(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const { mimeType, fileName } = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      setRecordedFileName(fileName);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        setRecordedBlob(blob);
        setState("ready");
        stopTimer();
        cleanupStream();
      };

      recorder.start();
      setState("recording");

      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied";
      setErrorMessage(message);
      setState("idle");
      cleanupStream();
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  function reset() {
    setRecordedBlob(null);
    setState("idle");
    setElapsedSec(0);
    setErrorMessage(null);
  }

  function submit() {
    if (recordedBlob) {
      onRecorded(recordedBlob, recordedFileName);
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center">
        {state === "idle" && (
          <Button
            size="lg"
            onClick={startRecording}
            disabled={disabled}
            className="h-20 w-20 rounded-full p-0"
            aria-label="Start recording"
          >
            <Mic className="h-8 w-8" />
          </Button>
        )}

        {state === "recording" && (
          <Button
            size="lg"
            variant="destructive"
            onClick={stopRecording}
            className="h-20 w-20 rounded-full p-0 animate-pulse"
            aria-label="Stop recording"
          >
            <Square className="h-8 w-8 fill-current" />
          </Button>
        )}

        {state === "ready" && recordedBlob && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-1 h-3 w-3" />
              Record again
            </Button>
            <Button size="sm" onClick={submit} disabled={disabled}>
              <Upload className="mr-1 h-3 w-3" />
              Process voice note
            </Button>
          </div>
        )}
      </div>

      <div className="text-center">
        {state === "recording" && (
          <p className="text-sm font-mono text-red-400">
            Recording... {formatTime(elapsedSec)}
          </p>
        )}
        {state === "idle" && !errorMessage && (
          <p className="text-xs text-muted-foreground">Tap the mic to start. Talk naturally — the system will extract the structure.</p>
        )}
        {state === "ready" && (
          <p className="text-xs text-muted-foreground">Recorded {formatTime(elapsedSec)}. Review or submit.</p>
        )}
        {errorMessage && (
          <p className="text-xs text-red-400">{errorMessage}</p>
        )}
      </div>
    </div>
  );
}
