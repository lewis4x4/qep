/**
 * Lightweight AI-adjacent hints for deal context (chat RAG, future superintelligence layer).
 */

export function suggestedFollowUpHintLine(nextFollowUpAtIso: string | null | undefined): string | null {
  if (!nextFollowUpAtIso) return null;
  const due = Date.parse(nextFollowUpAtIso);
  if (!Number.isFinite(due)) return null;
  if (due >= Date.now()) return null;
  return "Suggested action: complete or reschedule the touch — the planned follow-up time has passed.";
}
