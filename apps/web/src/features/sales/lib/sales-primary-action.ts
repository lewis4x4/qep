import type { RepPipelineDeal } from "./types";

export interface SalesPrimaryAction {
  /** Stable key so callers can switch on which kind of action surfaced. */
  kind:
    | "start_first_quote"
    | "recover_cold_deal"
    | "confirm_closing_deal"
    | "engage_quiet_customer"
    | "start_quote";
  /** Display label on the hero CTA. */
  label: string;
  /** Helper line under the label explaining the *why*. */
  reason: string;
  /** Destination route. */
  to: string;
  /** Optional deal id for analytics / tests. */
  dealId?: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function pickSalesPrimaryAction(pipeline: RepPipelineDeal[]): SalesPrimaryAction {
  if (pipeline.length === 0) {
    return {
      kind: "start_first_quote",
      label: "Start your first quote",
      reason: "Your book is quiet — the briefing sharpens the moment you start.",
      to: "/sales/quotes/new",
    };
  }

  const now = Date.now();

  // Priority 1: a deal closing this week that's also going cold — losing it is
  // the costliest mistake the rep can make today.
  const closingHot = pipeline.find(
    (deal) =>
      deal.expected_close_on &&
      new Date(deal.expected_close_on).getTime() - now < WEEK_MS &&
      (deal.heat_status === "cooling" || deal.heat_status === "cold"),
  );
  if (closingHot) {
    return {
      kind: "confirm_closing_deal",
      label: `Confirm ${closingHot.customer_name}`,
      reason: `Closes this week and going quiet — confirm terms before it slips.`,
      to: `/sales/deals/${closingHot.deal_id}`,
      dealId: closingHot.deal_id,
    };
  }

  // Priority 2: the highest-value cold deal — recover it before it dies.
  const coldDeals = pipeline
    .filter((deal) => deal.heat_status === "cold")
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  if (coldDeals[0]) {
    const deal = coldDeals[0];
    const days = deal.days_since_activity ?? "?";
    return {
      kind: "recover_cold_deal",
      label: `Recover ${deal.customer_name}`,
      reason: `Cold ${days}d — call before momentum is gone.`,
      to: `/sales/deals/${deal.deal_id}`,
      dealId: deal.deal_id,
    };
  }

  // Priority 3: closing-soon, regardless of heat — the biggest dollar in
  // the next 7 days that the rep should reaffirm.
  const closingSoon = pipeline
    .filter(
      (deal) =>
        deal.expected_close_on &&
        new Date(deal.expected_close_on).getTime() - now < WEEK_MS,
    )
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  if (closingSoon[0]) {
    const deal = closingSoon[0];
    return {
      kind: "confirm_closing_deal",
      label: `Confirm ${deal.customer_name}`,
      reason: `Closes this week — lock the win.`,
      to: `/sales/deals/${deal.deal_id}`,
      dealId: deal.deal_id,
    };
  }

  // Priority 4: a cooling deal that hasn't gone fully cold yet.
  const cooling = pipeline
    .filter((deal) => deal.heat_status === "cooling")
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  if (cooling[0]) {
    const deal = cooling[0];
    return {
      kind: "engage_quiet_customer",
      label: `Re-engage ${deal.customer_name}`,
      reason: `Pulse is cooling — one touch keeps the deal warm.`,
      to: `/sales/deals/${deal.deal_id}`,
      dealId: deal.deal_id,
    };
  }

  // Default: pipeline is healthy, push for the next quote.
  return {
    kind: "start_quote",
    label: "Start a new quote",
    reason: "Pipeline looks healthy — keep the cadence going.",
    to: "/sales/quotes/new",
  };
}
