/**
 * Pure helpers for the Today → Ask Iron per-move handoff (Slice 12).
 *
 * Mirror of signalCardHelpers (Slice 8, Pulse) and graphExplorerHelpers
 * (Slice 9, Graph). The three handoff formatters share the same envelope:
 *
 *   1. A distinct opener verb (so the conversation feels on-topic).
 *   2. An entity-scoped bullet list Iron can read at a glance.
 *   3. An explicit propose_move invitation at the end.
 *
 * What's different here: a Move is *already* a recommended action. The
 * operator isn't asking "what should I do?" — they're asking "why does
 * this move exist, and should I actually run it?". Iron's job is to
 * *defend* or *challenge* the move using the signals/entity behind it.
 * So the opener is built around that frame rather than "brief me".
 *
 * Kept free of React / supabase imports so Bun can exercise formatting
 * without spinning up the web app (same rule as the Slice 8/9 helpers).
 */

import type { QrmMove, QrmMoveKind } from "../lib/moves-types";

/**
 * Human label for each move kind. Used in the body bullet of the prompt.
 * Mirrors moveCardHelpers' acceptLabel but phrased as a noun ("call the
 * buyer") rather than an imperative ("Call now").
 */
export function labelForMoveKind(kind: QrmMoveKind): string {
  switch (kind) {
    case "call_now": return "call";
    case "send_quote": return "quote";
    case "send_follow_up": return "follow-up";
    case "send_proposal": return "proposal";
    case "schedule_meeting": return "meeting";
    case "escalate": return "escalation";
    case "drop_deal": return "drop";
    case "reassign": return "reassignment";
    case "field_visit": return "field visit";
    case "pricing_review": return "pricing review";
    case "inventory_reserve": return "inventory reserve";
    case "service_escalate": return "service escalation";
    case "rescue_offer": return "rescue offer";
    case "other": return "move";
  }
}

/**
 * Grouped opener by move kind. Five families cover the 14 kinds:
 *
 *   - outreach (call/quote/follow-up/proposal/meeting): "Brief me before
 *     I run this — what's the context and is this the right move?"
 *   - escalation (escalate/pricing_review/rescue_offer/service_escalate):
 *     "Walk me through why this is urgent and what's at stake."
 *   - hygiene (drop_deal/reassign): "Make the case for this — is there a
 *     better option?"
 *   - iron (field_visit/inventory_reserve): "Brief me on this work and
 *     what would change its priority."
 *   - fallback (other): generic "Brief me on this move."
 *
 * Keeping the groups internal — tests assert on the resulting prompt
 * prefix, not on the group label, so we can re-tune without breaking
 * contracts. Exported only so the test suite can pin the per-kind
 * output shape.
 */
export function openerForMoveKind(kind: QrmMoveKind): string {
  switch (kind) {
    case "call_now":
    case "send_quote":
    case "send_follow_up":
    case "send_proposal":
    case "schedule_meeting":
      return "Brief me before I run this move — what's the context, and is this actually the right next step?";
    case "escalate":
    case "pricing_review":
    case "rescue_offer":
    case "service_escalate":
      return "Walk me through why this move is urgent — what's at stake, and who needs to be in the loop?";
    case "drop_deal":
    case "reassign":
      return "Make the case for this move — is there a better option before I pull the trigger?";
    case "field_visit":
    case "inventory_reserve":
      return "Brief me on this work — what's driving the ask, and what would change its priority?";
    case "other":
      return "Brief me on this move — why was it queued, and what's the best way to close it out?";
  }
}

/**
 * Slice 12 — Today → Ask Iron per-move handoff.
 *
 * Build a well-scoped seed question for Ask Iron when the operator clicks
 * "Ask Iron" on a move card. The question carries:
 *
 *   - An opener tuned to the move kind (see openerForMoveKind).
 *   - A bullet with kind label + title + priority (so Iron can reason
 *     about confidence vs priority without another tool call).
 *   - The rationale when present (whitespace-collapsed and capped).
 *   - The entity scope (type + id) so Iron can jump straight to a
 *     detail/summarize tool without first searching.
 *   - A signal-trail hint when signal_ids is present so Iron knows there
 *     are reference events it can pull via list_recent_signals.
 *   - An explicit propose_move / explain-or-queue closer.
 *
 * Kept pure so Bun can exercise formatting without the HTTP client. The
 * caller composes the string, navigates to the Ask Iron surface with it
 * in router state, and AskIronSurface auto-sends on mount.
 *
 * Not a system-prompt override: this is a user-role message. Iron's
 * existing system prompt already tells it to use tools and only propose
 * moves when explicitly asked — the closing line here gives it the
 * explicit propose_move permission.
 */
export function formatIronMovePrompt(
  move: Pick<
    QrmMove,
    "kind" | "title" | "rationale" | "priority" | "entity_type" | "entity_id" | "signal_ids"
  >,
): string {
  const parts: string[] = [];
  parts.push(openerForMoveKind(move.kind));

  const kindLabel = labelForMoveKind(move.kind);
  const title = move.title.trim() || "(untitled move)";
  parts.push(`• ${kindLabel}: ${title} (priority ${move.priority})`);

  if (move.rationale) {
    const rat = move.rationale.replace(/\s+/g, " ").trim();
    if (rat.length > 0) {
      // Cap at 240 — matches the Slice 8 Pulse cap so Iron's prompt
      // budget is predictable across surfaces.
      const capped = rat.length > 240 ? `${rat.slice(0, 239)}…` : rat;
      parts.push(`• Rationale: ${capped}`);
    }
  }

  if (move.entity_type && move.entity_id) {
    parts.push(`• Entity: ${move.entity_type} (${move.entity_id})`);
  }

  // Signal trail — only a hint, not the full list. Iron can read the
  // full records via list_recent_signals + the signal ids if it needs
  // the severities or timestamps.
  if (Array.isArray(move.signal_ids) && move.signal_ids.length > 0) {
    const n = move.signal_ids.length;
    const noun = n === 1 ? "signal" : "signals";
    parts.push(`• Triggered by ${n} ${noun} (signal_ids available on the move record).`);
  }

  parts.push(
    "Use the detail + signal tools to ground your answer. If there's a clearer next step, call propose_move; otherwise tell me what you'd want to know before acting.",
  );

  return parts.join("\n");
}
