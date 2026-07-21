import { useEffect, useId, useRef } from "react";
import { Check, X } from "lucide-react";

import {
  IRON_VOICE_INTENTS,
  labelIronVoiceIntent,
  type IronVoiceIntent,
} from "./voice-intent-confirmation";

export interface IronVoiceConfirmationProps {
  intent: IronVoiceIntent;
  canConfirm: boolean;
  onIntentChange: (intent: IronVoiceIntent) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Review step inserted after voice transcription. Focus starts on the live
 * region so keyboard users encounter the confirmation controls before the
 * now-disabled microphone button that launched the request.
 */
export function IronVoiceConfirmation({
  intent,
  canConfirm,
  onIntentChange,
  onCancel,
  onConfirm,
}: IronVoiceConfirmationProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, []);

  return (
    <div
      ref={panelRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      data-testid="iron-voice-confirmation"
      className="mx-3 mb-3 rounded-lg border border-qep-orange/40 bg-qep-orange/[0.06] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id={titleId} className="text-xs font-semibold text-foreground">
            Confirm before Iron acts
          </p>
          <p id={descriptionId} className="mt-0.5 text-[10px] text-muted-foreground">
            Classified as {labelIronVoiceIntent(intent)}. Correct the text or category, then confirm.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/30"
          aria-label="Cancel voice request"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        className="mt-2 flex flex-wrap gap-1.5"
        role="group"
        aria-label="Correct Iron voice intent"
      >
        {IRON_VOICE_INTENTS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => onIntentChange(candidate)}
            aria-pressed={intent === candidate}
            className={`min-h-[44px] rounded-full border px-3 py-2 text-[10px] font-semibold transition-colors ${
              intent === candidate
                ? "border-qep-orange bg-qep-orange/20 text-qep-orange-accessible"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {labelIronVoiceIntent(candidate)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!canConfirm}
        className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-qep-orange px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"
        aria-label={`Confirm ${labelIronVoiceIntent(intent)} voice request`}
      >
        <Check className="h-3.5 w-3.5" />
        Confirm and continue
      </button>
    </div>
  );
}
