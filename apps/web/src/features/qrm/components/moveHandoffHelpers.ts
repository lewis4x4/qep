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

import type {
  QrmMove,
  QrmMoveEntityType,
  QrmMoveKind,
} from "../lib/moves-types";

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
 * Per-entity synthesizer hint. Slice 19 parallel of Slice 17 (Graph) and
 * Slice 18 (Pulse): when a move is scoped to a deal/company/contact,
 * name Iron's dedicated synthesizer tool so the LLM reaches for the
 * bundled read instead of chaining get_*_detail + list_recent_signals.
 *
 * Returns null for the entity types that have no synthesizer yet
 * (equipment, rental, activity, workspace) — those keep the generic
 * closer. Single spot to wire in a new synthesizer when it ships.
 */
function toolHintForMoveEntity(
  entityType: QrmMoveEntityType,
): string | null {
  switch (entityType) {
    case "deal":
      return "Then call summarize_deal with the deal_id to pull the deal row + recent activities + open signals in one shot.";
    case "company":
      return "Then call summarize_company with the company_id to pull the account row + open deals + recent activities + signals in one shot.";
    case "contact":
      return "Then call summarize_contact with the contact_id to pull the person + related deals at their company + recent activities + open signals in one shot.";
    case "equipment":
      return "Then call summarize_equipment with the equipment_id to pull the machine row + open rentals + recent touches + open signals in one shot.";
    case "rental":
    case "activity":
    case "workspace":
      return null;
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

  // Signal trail — now carries the first signal id explicitly, which
  // Slice 22 names in the closer so Iron can reach straight for
  // summarize_signal. The "why was this move queued" question is
  // signal-centric; pointing Iron at the trigger is the shortest
  // route to the answer.
  const firstSignalId = Array.isArray(move.signal_ids) &&
      move.signal_ids.length > 0 &&
      typeof move.signal_ids[0] === "string" &&
      move.signal_ids[0].length > 0
    ? move.signal_ids[0]
    : null;
  if (Array.isArray(move.signal_ids) && move.signal_ids.length > 0) {
    const n = move.signal_ids.length;
    const noun = n === 1 ? "signal" : "signals";
    if (firstSignalId) {
      parts.push(
        `• Triggered by ${n} ${noun} (first: ${firstSignalId}).`,
      );
    } else {
      parts.push(
        `• Triggered by ${n} ${noun} (signal_ids available on the move record).`,
      );
    }
  }

  // Slice 22 — signal-centric synthesizer naming. When the move has a
  // trigger signal, summarize_signal is the most direct answer to "why
  // was this queued": it bundles the trigger event, its parent entity,
  // the related signals on that entity, and any other moves the signal
  // kicked off. Iron can follow with the entity synthesizer if it
  // needs broader account context (activity history, other open
  // deals), but summarize_signal comes first.
  if (firstSignalId) {
    parts.push(
      `Call summarize_signal with signal_id "${firstSignalId}" to understand why this move was queued — it pulls the trigger signal + its parent entity + related events in one shot.`,
    );
  }

  // Slice 19 — entity-synthesizer tool-naming. Kept as a secondary
  // hint because summarize_signal returns the parent entity row but
  // NOT the parent's recent activities, open-deal list, or touch
  // trail — those live in summarize_deal/company/contact. An operator
  // vetting a move often wants that broader context.
  const entityHint = move.entity_type && move.entity_id
    ? toolHintForMoveEntity(move.entity_type)
    : null;
  if (entityHint) {
    parts.push(entityHint);
    parts.push(
      "If there's a clearer next step, call propose_move; otherwise tell me what you'd want to know before acting.",
    );
  } else if (firstSignalId) {
    // Signal synthesizer already named above; just close out.
    parts.push(
      "If there's a clearer next step, call propose_move; otherwise tell me what you'd want to know before acting.",
    );
  } else {
    parts.push(
      "Use the detail + signal tools to ground your answer. If there's a clearer next step, call propose_move; otherwise tell me what you'd want to know before acting.",
    );
  }

  return parts.join("\n");
}
