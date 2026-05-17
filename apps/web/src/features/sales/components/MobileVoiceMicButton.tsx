import { Mic, Square, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileVoiceMicState = "idle" | "recording" | "processing" | "error";

export interface MobileVoiceMicButtonProps {
  state: MobileVoiceMicState;
  onClick?: () => void;
  /** Size in pixels — minimum 96, maximum 128. */
  size?: number;
  /** Human label spoken to screen readers for the current state. */
  statusLabel?: string;
  /** Optional className for the wrapper. */
  className?: string;
  /** Optional helper copy under the button (e.g. "Tap and hold to record"). */
  helper?: string;
  disabled?: boolean;
}

/**
 * Standardized mobile mic primitive used across Field Note and Voice Quote.
 * The button itself is large enough to land on with a thumb (>= 96pt), and
 * is the dominant element of the screen during voice capture.
 *
 * State semantics:
 *  - idle:       press to start recording
 *  - recording:  pulse animation, tap to stop
 *  - processing: spinner, no interactions
 *  - error:      warning state, tap retries
 */
export function MobileVoiceMicButton({
  state,
  onClick,
  size = 112,
  statusLabel,
  className,
  helper,
  disabled,
}: MobileVoiceMicButtonProps) {
  const clamped = Math.min(Math.max(size, 96), 128);
  const isRecording = state === "recording";
  const isProcessing = state === "processing";
  const isError = state === "error";
  const isIdle = state === "idle";

  const ariaLabel = statusLabel
    ? statusLabel
    : isRecording
      ? "Stop recording"
      : isProcessing
        ? "Processing recording"
        : isError
          ? "Retry recording"
          : "Start recording";

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <button
        type="button"
        aria-pressed={isRecording}
        aria-label={ariaLabel}
        aria-busy={isProcessing}
        disabled={disabled || isProcessing}
        onClick={onClick}
        style={{ width: clamped, height: clamped }}
        className={cn(
          "relative rounded-full flex items-center justify-center transition-all duration-200 shadow-lg",
          "focus:outline-none focus-visible:ring-4 focus-visible:ring-qep-orange/40",
          isIdle &&
            "bg-gradient-to-br from-qep-orange to-qep-orange-hover text-white shadow-qep-orange/40 active:scale-[0.97]",
          isRecording &&
            "bg-gradient-to-br from-red-500 to-red-600 text-white shadow-red-500/40 active:scale-[0.97]",
          isProcessing && "bg-foreground/[0.08] text-muted-foreground cursor-wait",
          isError &&
            "bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-amber-500/40 active:scale-[0.97]",
          disabled && "opacity-60 cursor-not-allowed",
        )}
        data-testid="mobile-voice-mic-button"
        data-state={state}
      >
        {isRecording && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-white/40 animate-ping"
          />
        )}
        {isProcessing ? (
          <Loader2
            className="animate-spin"
            style={{ width: clamped * 0.35, height: clamped * 0.35 }}
            aria-hidden
          />
        ) : isError ? (
          <AlertCircle
            style={{ width: clamped * 0.4, height: clamped * 0.4 }}
            aria-hidden
          />
        ) : isRecording ? (
          <Square
            style={{ width: clamped * 0.3, height: clamped * 0.3 }}
            fill="currentColor"
            aria-hidden
          />
        ) : (
          <Mic
            style={{ width: clamped * 0.42, height: clamped * 0.42 }}
            strokeWidth={2.5}
            aria-hidden
          />
        )}
      </button>
      <span
        role="status"
        aria-live="polite"
        className="text-sm font-semibold text-foreground min-h-[1.25rem]"
        data-testid="mobile-voice-mic-status"
      >
        {statusLabel ?? defaultStatusFor(state)}
      </span>
      {helper && (
        <span className="text-xs text-muted-foreground text-center max-w-[260px]">
          {helper}
        </span>
      )}
    </div>
  );
}

function defaultStatusFor(state: MobileVoiceMicState): string {
  switch (state) {
    case "recording":
      return "Recording...";
    case "processing":
      return "Processing...";
    case "error":
      return "Tap to retry";
    case "idle":
    default:
      return "Tap to record";
  }
}
