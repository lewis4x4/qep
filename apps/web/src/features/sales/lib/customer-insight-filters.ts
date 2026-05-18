import type { RepCustomer } from "./types";

export type CustomerInsightKey =
  | "hot"
  | "active_deals"
  | "active_quotes"
  | "due_followup"
  | "gone_quiet"
  | "never_touched";

export function isHot(c: RepCustomer): boolean {
  return c.opportunity_score >= 70;
}

export function hasActiveDeals(c: RepCustomer): boolean {
  return c.open_deals > 0;
}

export function hasActiveQuotes(c: RepCustomer): boolean {
  return c.active_quotes > 0;
}

/** Was contacted within 7-29 days — warming up to overdue. */
export function isDueFollowup(c: RepCustomer): boolean {
  const d = c.days_since_contact;
  return d != null && d >= 7 && d < 30;
}

/** Was contacted but has gone cold (30+ days). */
export function isGoneQuiet(c: RepCustomer): boolean {
  const d = c.days_since_contact;
  return d != null && d >= 30;
}

/** Has never been contacted by anyone. */
export function isNeverTouched(c: RepCustomer): boolean {
  return c.last_interaction == null && c.days_since_contact == null;
}

const PREDICATES: Record<
  CustomerInsightKey,
  (c: RepCustomer) => boolean
> = {
  hot: isHot,
  active_deals: hasActiveDeals,
  active_quotes: hasActiveQuotes,
  due_followup: isDueFollowup,
  gone_quiet: isGoneQuiet,
  never_touched: isNeverTouched,
};

export function filterCustomersByInsight(
  customers: RepCustomer[],
  key: CustomerInsightKey,
): RepCustomer[] {
  return customers.filter(PREDICATES[key]);
}

export const CUSTOMER_INSIGHT_LABELS: Record<CustomerInsightKey, string> = {
  hot: "Hot",
  active_deals: "Active Deals",
  active_quotes: "Active Quotes",
  due_followup: "Due Follow-up",
  gone_quiet: "Gone Quiet",
  never_touched: "Never Touched",
};
