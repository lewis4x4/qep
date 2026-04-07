/**
 * Wave 7 Iron Companion v1.1 — small mic button for slot inputs.
 *
 * Embedded in text/longtext slot renderers in FlowEngineUI. Click → record;
 * click again → stop, transcribe, append to slot value (or replace if the
 * slot was empty).
 *
 * This is intentionally not a full voice-flow experience (no narration of
 * the slot question, no voice-only walking through the form). Those are
 * v1.2 work once a TTS provider is wired. For v1.1 we ship voice INPUT
 * everywhere a user types text.
 */
import { useCallback, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useIronVoiceRecorder } from "./useIronVoiceRecorder";
import { ironTranscribe } from "./api";

interface VoiceFillButtonProps {
  /** Current slot value — used to decide append vs replace. */
  currentValue: string;
  /** Called with the new merged value after transcription succeeds. */
  onTranscribed: (newValue: string) => void;
  /** Called when transcription fails. */
  onError?: (message: string) => void;
  disabled?: boolean;
  /** Optional ARIA label. */
  ariaLabel?: string;
}

export function VoiceFillButton({
  currentValue,
  onTranscribed,
  onError,
  disabled,
  ariaLabel,
}: VoiceFillButtonProps) {
  const recorder = useIronVoiceRecorder();
  const [transcribing, setTranscribing] = useState(false);

  const handleClick = useCallback(async () => {
    if (recorder.state === "recording") {
      setTranscribing(true);
      try {
        const result = await recorder.stop();
        if (!result) {
          onError?.("Didn't catch that — try again?");
          return;
        }
        const transcribed = await ironTranscribe(result.blob, result.fileName);
        if (!transcribed.ok || !transcribed.transcript) {
          onError?.(transcribed.message ?? "No speech detected");
          return;
        }
        // Append on space-separator if there's existing text, else replace
        const merged =
          currentValue.trim().length > 0
            ? `${currentValue.trim()} ${transcribed.transcript}`
            : transcribed.transcript;
        onTranscribed(merged);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Voice transcription failed");
      } finally {
        setTranscribing(false);
      }
    } else {
      await recorder.start();
    }
  }, [recorder, currentValue, onTranscribed, onError]);

  const isRecording = recorder.state === "recording";
  const isError = recorder.state === "error";
  const isBusy = transcribing || recorder.state === "requesting";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isBusy}
      aria-label={ariaLabel ?? (isRecording ? "Stop recording" : "Record voice for slot")}
      className={`shrink-0 rounded-md p-1.5 transition-colors disabled:opacity-30 ${
        isRecording
          ? "bg-red-500/15 text-red-400 animate-pulse"
          : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {isBusy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isError ? (
        <MicOff className="h-3.5 w-3.5" />
      ) : (
        <Mic className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
