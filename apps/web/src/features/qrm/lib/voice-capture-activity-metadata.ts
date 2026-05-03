import type { QrmActivityItem } from "./types";

/** Mirrors `buildCrmSummary` in `supabase/functions/_shared/voice-capture-crm.ts`. */
export type QrmVoiceCaptureExtractedSummary = {
  contactName: string | null;
  companyName: string | null;
  machineInterest: string | null;
  applicationUseCase: string | null;
  equipmentMake: string | null;
  equipmentModel: string | null;
  dealStage: string | null;
  urgencyLevel: string | null;
  financingInterest: string | null;
  tradeInLikelihood: string | null;
  nextStep: string | null;
  followUpDate: string | null;
  keyConcerns: string | null;
  competitorsMentioned: string[] | null;
  recommendedNextAction: string | null;
  managerAttentionFlag: boolean;
};

export type QrmVoiceCaptureTimelineSignals = {
  summary: QrmVoiceCaptureExtractedSummary;
  actionItems: string[];
};

const DEAL_STAGE_LABELS: Record<string, string> = {
  initial_contact: "Initial Contact",
  follow_up: "Follow-Up",
  demo_scheduled: "Demo Scheduled",
  quote_sent: "Quote Sent",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return out.length ? out : null;
}

function asBool(v: unknown): boolean {
  return v === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function formatVoiceCaptureDealStage(value: string | null | undefined): string | null {
  if (!value) return null;
  return DEAL_STAGE_LABELS[value] ?? value;
}

export function formatVoiceCaptureEnumLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function formatVoiceCaptureFollowUpDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function parseExtractedSummary(raw: unknown): QrmVoiceCaptureExtractedSummary | null {
  if (!isRecord(raw)) return null;
  return {
    contactName: asString(raw.contactName),
    companyName: asString(raw.companyName),
    machineInterest: asString(raw.machineInterest),
    applicationUseCase: asString(raw.applicationUseCase),
    equipmentMake: asString(raw.equipmentMake),
    equipmentModel: asString(raw.equipmentModel),
    dealStage: asString(raw.dealStage),
    urgencyLevel: asString(raw.urgencyLevel),
    financingInterest: asString(raw.financingInterest),
    tradeInLikelihood: asString(raw.tradeInLikelihood),
    nextStep: asString(raw.nextStep),
    followUpDate: asString(raw.followUpDate),
    keyConcerns: asString(raw.keyConcerns),
    competitorsMentioned: asStringArray(raw.competitorsMentioned),
    recommendedNextAction: asString(raw.recommendedNextAction),
    managerAttentionFlag: asBool(raw.managerAttentionFlag),
  };
}

export function isVoiceCaptureActivity(activity: QrmActivityItem): boolean {
  return activity.metadata.source === "voice_capture";
}

export function readVoiceCaptureTimelineSignals(activity: QrmActivityItem): QrmVoiceCaptureTimelineSignals | null {
  if (!isVoiceCaptureActivity(activity)) return null;
  const summary = parseExtractedSummary(activity.metadata.extractedSummary);
  const actionItems = Array.isArray(activity.metadata.actionItems)
    ? activity.metadata.actionItems.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  if (!summary) return null;
  return { summary, actionItems };
}

export function voiceCaptureSignalsHaveContent(signals: QrmVoiceCaptureTimelineSignals): boolean {
  const s = signals.summary;
  const competitors = s.competitorsMentioned?.length ?? 0;
  return Boolean(
    s.contactName ||
      s.companyName ||
      s.machineInterest ||
      s.applicationUseCase ||
      s.equipmentMake ||
      s.equipmentModel ||
      s.dealStage ||
      (s.urgencyLevel && s.urgencyLevel !== "unknown") ||
      (s.financingInterest && s.financingInterest !== "unknown") ||
      (s.tradeInLikelihood && s.tradeInLikelihood !== "unknown" && s.tradeInLikelihood !== "none") ||
      s.nextStep ||
      s.followUpDate ||
      s.keyConcerns ||
      competitors > 0 ||
      s.recommendedNextAction ||
      s.managerAttentionFlag ||
      signals.actionItems.length > 0,
  );
}
