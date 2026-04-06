import type { ReactNode } from "react";
import { AlertTriangle, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QrmVoiceCaptureTimelineSignals } from "../lib/voice-capture-activity-metadata";
import {
  formatVoiceCaptureDealStage,
  formatVoiceCaptureEnumLabel,
  formatVoiceCaptureFollowUpDate,
} from "../lib/voice-capture-activity-metadata";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(0,7rem)_1fr] sm:gap-x-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs leading-snug text-foreground">{children}</div>
    </div>
  );
}

interface QrmVoiceCaptureSignalBlockProps {
  signals: QrmVoiceCaptureTimelineSignals;
  className?: string;
}

export function QrmVoiceCaptureSignalBlock({ signals, className }: QrmVoiceCaptureSignalBlockProps) {
  const { summary: s, actionItems } = signals;

  const equipmentLine = [s.equipmentMake, s.equipmentModel].filter(Boolean).join(" ").trim();
  const equipment = s.machineInterest || equipmentLine || null;
  const stage = formatVoiceCaptureDealStage(s.dealStage);
  const urgency = s.urgencyLevel && s.urgencyLevel !== "unknown" ? formatVoiceCaptureEnumLabel(s.urgencyLevel) : null;
  const financing =
    s.financingInterest && s.financingInterest !== "unknown" ? formatVoiceCaptureEnumLabel(s.financingInterest) : null;
  const tradeIn =
    s.tradeInLikelihood &&
    s.tradeInLikelihood !== "unknown" &&
    s.tradeInLikelihood !== "none"
      ? formatVoiceCaptureEnumLabel(s.tradeInLikelihood)
      : null;
  const competitors = s.competitorsMentioned?.length ? s.competitorsMentioned.join(", ") : null;
  const followUp = formatVoiceCaptureFollowUpDate(s.followUpDate);

  const who = [s.contactName, s.companyName].filter(Boolean).join(" · ") || null;

  return (
    <div
      className={cn(
        "mt-3 rounded-lg border border-border bg-muted/30 p-3",
        className,
      )}
      role="region"
      aria-label="Field note signal summary"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
        <Mic className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        Field note signals
      </div>

      <div className="space-y-2">
        {who && <Row label="Who">{who}</Row>}
        {equipment && <Row label="Equipment">{equipment}</Row>}
        {s.applicationUseCase && <Row label="Use case">{s.applicationUseCase}</Row>}
        {stage && <Row label="Stage">{stage}</Row>}
        {(urgency || financing || tradeIn) && (
          <Row label="Deal read">
            {[urgency, financing, tradeIn].filter(Boolean).join(" · ")}
          </Row>
        )}
        {s.nextStep && <Row label="Next step">{s.nextStep}</Row>}
        {followUp && <Row label="Follow-up">{followUp}</Row>}
        {s.keyConcerns && <Row label="Concerns">{s.keyConcerns}</Row>}
        {competitors && <Row label="Competitors">{competitors}</Row>}
        {s.recommendedNextAction && <Row label="Suggested action">{s.recommendedNextAction}</Row>}
        {actionItems.length > 0 && (
          <div className="pt-1">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Action items</div>
            <ul className="list-inside list-disc space-y-0.5 text-xs leading-snug text-foreground">
              {actionItems.map((item, i) => (
                <li key={`${i}-${item.slice(0, 48)}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {s.managerAttentionFlag && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-950">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Flagged for manager attention from this field note.</span>
        </div>
      )}
    </div>
  );
}
