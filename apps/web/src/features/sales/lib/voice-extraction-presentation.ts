/**
 * Pure helpers that turn a VoiceExtractionResult into review-screen UX:
 *   - formatExtractedAmount → "$186K" / "$2.5M"
 *   - pickSmartActions     → ordered list of actions the rep can toggle
 *
 * Kept out of the React component so the logic is unit-testable in
 * isolation. The component just renders what these return.
 */
import type { VoiceExtractionResult } from "@/lib/iron/voice/extract";

export function formatExtractedAmount(amountCents: number | null): string | null {
  if (amountCents == null || !Number.isFinite(amountCents)) return null;
  if (amountCents <= 0) return null;
  const dollars = amountCents / 100;
  if (dollars >= 1_000_000) {
    const m = dollars / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (dollars >= 1_000) {
    const k = dollars / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${dollars.toFixed(0)}`;
}

export function titleCaseTopic(topic: VoiceExtractionResult["topic"]): string {
  switch (topic) {
    case "quote_followup":
      return "Quote follow-up";
    case "trade_in":
      return "Trade-in";
    case "competitor":
      return "Competitor";
    case "service":
      return "Service";
    case "parts":
      return "Parts";
    case "visit":
      return "Visit";
    case "call":
      return "Call";
    default:
      return "Note";
  }
}

export interface SmartAction {
  id:
    | "log_activity"
    | "schedule_follow_up"
    | "open_quote_builder"
    | "mark_deal_cooling";
  /** Mobile-truncatable headline. */
  label: string;
  /** One-line subtext explaining the consequence. */
  detail: string | null;
  /** Default toggle state. */
  defaultOn: boolean;
  /**
   * True when the action's effect actually fires through to a backend
   * mutation today. False means it's stored as intent on the voice
   * capture's extracted_data and a follow-up slice will wire it through.
   */
  wired: boolean;
}

export interface PickSmartActionsArgs {
  extraction: VoiceExtractionResult | null;
  selectedCustomerId: string | null;
  selectedDealId: string | null;
}

export function pickSmartActions({
  extraction,
  selectedCustomerId,
  selectedDealId,
}: PickSmartActionsArgs): SmartAction[] {
  const actions: SmartAction[] = [];

  const topicLabel = titleCaseTopic(extraction?.topic ?? "other").toLowerCase();
  actions.push({
    id: "log_activity",
    label: `Log as ${topicLabel} activity`,
    detail: "Always saves to the customer timeline.",
    defaultOn: true,
    wired: true,
  });

  if (extraction?.next_step && extraction.next_step_due) {
    actions.push({
      id: "schedule_follow_up",
      label: `Schedule follow-up ${extraction.next_step_due}`,
      detail: extraction.next_step,
      defaultOn: true,
      // Stored as intent on the voice capture row — Phase 2 will sync
      // it through to scheduled_follow_ups once the touchpoint schema
      // accepts a rep-book customer_id.
      wired: false,
    });
  }

  if (extraction?.equipment_mentioned && extraction.equipment_mentioned.length > 0) {
    const eq = extraction.equipment_mentioned.slice(0, 3).join(", ");
    actions.push({
      id: "open_quote_builder",
      label: `Open Quote Builder pre-filled with ${eq}`,
      detail: "Opens in a new screen after save.",
      defaultOn: false,
      wired: true,
    });
  }

  if (extraction?.sentiment === "cooling" && selectedCustomerId && selectedDealId) {
    actions.push({
      id: "mark_deal_cooling",
      label: "Mark deal as cooling",
      detail: "Flags the deal in the pipeline for manager attention.",
      defaultOn: false,
      wired: false,
    });
  }

  return actions;
}

/**
 * True when the result has zero structured signal to render. The summary
 * is not enough on its own — we want the user-facing block to surface
 * "No structured details detected." when only the summary is present.
 */
export function isExtractionEmpty(extraction: VoiceExtractionResult | null): boolean {
  if (!extraction) return true;
  return (
    !extraction.next_step
    && !extraction.amount_cents
    && extraction.equipment_mentioned.length === 0
    && !extraction.competitor
    && !extraction.sentiment
    && (!extraction.topic || extraction.topic === "other")
  );
}
