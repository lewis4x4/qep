import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QrmActivityItem } from "../lib/types";
import type { QrmVoiceCaptureTimelineSignals } from "../lib/voice-capture-activity-metadata";
import {
  readVoiceCaptureTargetMetadata,
  readVoiceCaptureTranscript,
} from "../lib/voice-capture-activity-metadata";
import { QrmVoiceCaptureSignalBlock } from "./QrmVoiceCaptureSignalBlock";

interface QrmVoiceCaptureActivityCardProps {
  activity: QrmActivityItem;
  signals: QrmVoiceCaptureTimelineSignals | null;
  showSignals: boolean;
}

export function QrmVoiceCaptureActivityCard({ activity, signals, showSignals }: QrmVoiceCaptureActivityCardProps) {
  const transcript = readVoiceCaptureTranscript(activity);
  const target = readVoiceCaptureTargetMetadata(activity);

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3" role="region" aria-label="Voice capture activity">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-1 font-semibold text-primary">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          Voice capture
        </span>
        {target && (
          <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-1 font-medium text-foreground">
            {target.label}
          </span>
        )}
        {target?.needsAssignment && (
          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-1 font-medium text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            Needs assignment
          </span>
        )}
      </div>

      {showSignals && signals && <QrmVoiceCaptureSignalBlock signals={signals} className="mt-2" />}

      {transcript && (
        <details className={cn("mt-2 rounded-md border border-border bg-background/70 p-2", showSignals && "mt-3")}>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Transcript
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{transcript}</p>
        </details>
      )}
    </div>
  );
}
