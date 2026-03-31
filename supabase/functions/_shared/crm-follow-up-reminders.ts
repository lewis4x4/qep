/**
 * Shared rules for QEP native follow-ups vs HubSpot sequence tasks (dedupe).
 */

const NATIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * When true, skip creating a HubSpot sequence "task" step — the rep already has
 * a native next_follow_up_at within ±48h of "now" (sequence step due time).
 */
export function shouldSkipHubSpotSequenceTaskForNativeFollowUp(
  nextFollowUpAtIso: string | null | undefined,
  referenceTimeMs: number = Date.now(),
): boolean {
  if (!nextFollowUpAtIso) return false;
  const t = Date.parse(nextFollowUpAtIso);
  if (!Number.isFinite(t)) return false;
  return Math.abs(t - referenceTimeMs) <= NATIVE_WINDOW_MS;
}
