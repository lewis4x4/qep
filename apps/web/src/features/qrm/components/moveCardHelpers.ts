/**
 * Pure routing + labeling helpers for MoveCard. Lives in its own file so
 * unit tests can import it without dragging in the supabase client.
 */

import type { QrmMove, QrmMoveKind } from "../lib/moves-types";
import { accountCommandUrl } from "../lib/account-links";

/**
 * Derive the canonical deep-link for the entity behind this move. Mirrors
 * the GraphExplorer routing contract so Today and Graph stay consistent.
 */
export function hrefForMoveEntity(move: QrmMove): string | null {
  if (!move.entity_id || !move.entity_type) return null;
  switch (move.entity_type) {
    case "contact":
      return `/qrm/contacts/${move.entity_id}`;
    // Track 7A: account command center is the default drill-down system-wide.
    case "company":
      return accountCommandUrl(move.entity_id);
    case "deal":
      return `/qrm/deals/${move.entity_id}`;
    case "equipment":
      return `/qrm/inventory-pressure?equipment=${move.entity_id}`;
    case "rental":
      return `/qrm/rentals?request=${move.entity_id}`;
    case "activity":
      return `/qrm/activities/${move.entity_id}`;
    default:
      return null;
  }
}

/**
 * Map a move.kind to the imperative verb printed on the primary button.
 * Defaulting to the move kind keeps buttons meaningful: reps hit "I'll call"
 * rather than a generic "Accept".
 */
export function acceptLabelForKind(kind: QrmMoveKind): string {
  switch (kind) {
    case "call_now":
      return "I'll call";
    case "send_quote":
    case "send_proposal":
      return "I'll quote";
    case "send_follow_up":
      return "I'll follow up";
    case "schedule_meeting":
      return "I'll schedule";
    case "escalate":
      return "I'll escalate";
    case "field_visit":
      return "I'll go onsite";
    case "service_escalate":
      return "I'll loop in service";
    case "rescue_offer":
      return "I'll rescue";
    case "inventory_reserve":
      return "I'll reserve";
    case "pricing_review":
      return "I'll review pricing";
    case "drop_deal":
      return "I'll drop";
    case "reassign":
      return "I'll reassign";
    default:
      return "Accept";
  }
}
