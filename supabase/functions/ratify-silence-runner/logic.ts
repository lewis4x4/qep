export type DecisionCandidate = {
  id: string;
  code: string;
  lane: string;
  status: string;
  owner_role: string;
  created_at: string;
  silence_threshold_days: number | null;
  recommended_option: string | null;
  ai_prep_packet: unknown;
};

export type NotificationAttempt = {
  kind: "linear_comment" | "email_card";
  attempted: boolean;
  ok: boolean;
  detail?: string;
};

const RATIFY_DEFAULT_SILENCE_DAYS = 7;

export function resolveSilenceThresholdDays(raw: number | null | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return RATIFY_DEFAULT_SILENCE_DAYS;
  return Math.max(1, Math.floor(raw));
}

export function isRatifySilenceEligible(input: { decision: DecisionCandidate; now: Date }): boolean {
  const lane = input.decision.lane.trim().toLowerCase();
  if (lane !== "ratify") return false;

  const status = input.decision.status.trim().toLowerCase();
  if (status !== "open" && status !== "escalated") return false;

  const recommended = input.decision.recommended_option?.trim() ?? "";
  if (!recommended) return false;

  const createdAt = new Date(input.decision.created_at);
  if (Number.isNaN(createdAt.getTime())) return false;

  const thresholdDays = resolveSilenceThresholdDays(input.decision.silence_threshold_days);
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return input.now.getTime() - createdAt.getTime() >= thresholdMs;
}

export function buildRatifySilenceRationale(input: {
  decisionCode: string;
  thresholdDays: number;
  actor: string;
}): string {
  return `RATIFY silence auto-promotion: decision ${input.decisionCode} exceeded ${input.thresholdDays} day silence threshold. Auto-promoted to shadow_ship by ${input.actor}.`;
}

export function stampRatifySilencePacket(
  existingPacket: unknown,
  payload: {
    ran_at: string;
    actor: string;
    threshold_days: number;
    notification_attempts: NotificationAttempt[];
  },
): Record<string, unknown> {
  const base = existingPacket && typeof existingPacket === "object" && !Array.isArray(existingPacket)
    ? { ...(existingPacket as Record<string, unknown>) }
    : {};

  base.ratify_silence_last_run = payload;
  return base;
}
