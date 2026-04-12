import type { PortalQuoteSummary } from "./portal-api";
import type { PortalQuoteReviewSummary } from "./portal-quote-review";

export interface PortalQuoteTimelineItem {
  label: string;
  detail: string;
  at: string | null;
  state: "done" | "current" | "upcoming";
}

export interface PortalQuoteActionItem {
  title: string;
  detail: string;
  tone: "blue" | "amber" | "emerald";
}

export interface PortalQuoteChecklistItem {
  label: string;
  done: boolean;
}

function hasValue(value: unknown): boolean {
  return value != null && value !== "";
}

export function buildPortalQuoteTimeline(quote: PortalQuoteSummary): PortalQuoteTimelineItem[] {
  const items: PortalQuoteTimelineItem[] = [
    {
      label: "Proposal prepared",
      detail: "Your dealership assembled the pricing, equipment, and supporting proposal details.",
      at: quote.portal_status.last_updated_at ?? null,
      state: "done",
    },
    {
      label: "Proposal opened for review",
      detail: quote.viewed_at
        ? "The customer portal recorded that this proposal has been reviewed."
        : "The proposal is waiting for customer review in the portal.",
      at: quote.viewed_at,
      state: quote.viewed_at ? "done" : quote.status === "sent" ? "current" : "upcoming",
    },
    {
      label: quote.status === "countered" ? "Requested changes sent" : "Decision captured",
      detail: quote.signed_at
        ? "A customer signature has been recorded on this proposal."
        : quote.status === "countered"
          ? "The customer submitted requested changes or a counter-offer and the dealership is now preparing a revision."
        : quote.status === "rejected"
          ? "The proposal was declined and is waiting on dealership follow-up if needed."
          : "The dealership is waiting on acceptance, rejection, or requested changes.",
      at: quote.signed_at ?? (quote.status === "countered" ? quote.portal_status.last_updated_at : null),
      state: quote.signed_at || quote.status === "rejected" || quote.status === "countered" ? "done" : "upcoming",
    },
  ];

  if (quote.status === "countered") {
    items.push({
      label: "Dealership revision in progress",
      detail: "Your dealership is reviewing the requested changes and preparing the next proposal version.",
      at: quote.portal_status.last_updated_at ?? null,
      state: "current",
    });
  } else if (quote.counter_notes?.trim()) {
    items.push({
      label: "Revised proposal published",
      detail: "A revised proposal is available in the quote room based on the previously requested changes.",
      at: quote.portal_status.last_updated_at ?? null,
      state: "current",
    });
  }

  if (quote.expires_at) {
    items.push({
      label: "Proposal expiry window",
      detail: "The current proposal remains valid through this expiration date unless revised sooner.",
      at: quote.expires_at,
      state: quote.signed_at ? "done" : "current",
    });
  }

  return items;
}

export function buildPortalQuoteActionRail(
  quote: PortalQuoteSummary,
  summary: PortalQuoteReviewSummary,
): PortalQuoteActionItem[] {
  const actions: PortalQuoteActionItem[] = [
    {
      title: quote.status === "countered" ? "Dealership revision pending" : "Dealership action",
      detail: quote.status === "countered"
        ? "Your dealership is reviewing the requested changes and will publish a revised proposal back into the quote room."
        : quote.portal_status.next_action ?? "Your dealership is waiting on the next customer-side action for this proposal.",
      tone: quote.status === "accepted" ? "emerald" : quote.status === "countered" ? "amber" : "blue",
    },
  ];

  if (quote.status === "countered" && quote.counter_notes?.trim()) {
    actions.push({
      title: "Requested changes captured",
      detail: quote.counter_notes.trim(),
      tone: "amber",
    });
  } else if (quote.counter_notes?.trim()) {
    actions.push({
      title: "Dealership revision delivered",
      detail: "A revised proposal has been posted in response to the requested changes recorded earlier in this quote room.",
      tone: "emerald",
    });
  }

  if (summary.financingHighlights.length > 0) {
    actions.push({
      title: "Financing path included",
      detail: `This proposal includes ${summary.financingHighlights.length} financing option${summary.financingHighlights.length === 1 ? "" : "s"} for comparison.`,
      tone: "amber",
    });
  }

  if (quote.expires_at) {
    actions.push({
      title: "Time-sensitive review",
      detail: `The current pricing window expires on ${new Date(quote.expires_at).toLocaleDateString()}.`,
      tone: "amber",
    });
  }

  return actions;
}

export function buildPortalQuoteChecklist(
  quote: PortalQuoteSummary,
  summary: PortalQuoteReviewSummary,
): PortalQuoteChecklistItem[] {
  return [
    {
      label: "Review the equipment scope",
      done: summary.equipmentLabels.length > 0 || summary.lineItems.length > 0,
    },
    {
      label: "Confirm pricing and net total",
      done: hasValue(summary.netTotal ?? quote.amount),
    },
    {
      label: "Check financing options if needed",
      done: summary.financingHighlights.length > 0,
    },
    {
      label: "Read the proposal terms",
      done: summary.terms.length > 0,
    },
    {
      label: "Accept, decline, or request changes",
      done: ["accepted", "rejected", "countered"].includes(quote.status),
    },
    {
      label: "Wait for dealership revision after requested changes",
      done: quote.status !== "countered",
    },
    {
      label: "Review the revised proposal after dealership response",
      done: !(quote.counter_notes?.trim() && quote.status !== "countered"),
    },
  ];
}
