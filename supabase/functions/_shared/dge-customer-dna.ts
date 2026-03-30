import type { PricingPersona } from "./dge-customer-profile.ts";

export interface DealHistoryRow {
  deal_date: string;
  outcome: string;
  sold_price: number | null;
  list_price: number | null;
  discount_pct: number | null;
  attachments_sold: number | null;
  service_contract_sold: boolean | null;
  days_to_close: number | null;
  financing_used: boolean | null;
  loss_reason: string | null;
}

export interface DnaMetrics {
  totalDeals: number;
  wonDeals: number;
  lifetimeValue: number;
  avgDealSize: number;
  avgDiscountPct: number;
  avgDaysToClose: number;
  attachmentRate: number;
  serviceContractRate: number;
  priceSensitivityScore: number;
  quoteToCloseRatio: number;
  preferredFinancing: string;
  seasonalPattern: string;
  lastDealAt: string | null;
  persona: PricingPersona;
  personaConfidence: number;
  personaReasoning: string;
  isColdStart: boolean;
  dataBadges: string[];
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deriveSeasonalPattern(deals: DealHistoryRow[]): string {
  if (deals.length === 0) return "steady";

  const monthCounts = new Map<number, number>();
  for (const deal of deals) {
    const month = new Date(deal.deal_date).getUTCMonth();
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }

  const entries = [...monthCounts.entries()].sort((a, b) => b[1] - a[1]);
  const [topMonth, topCount] = entries[0];
  const secondCount = entries[1]?.[1] ?? 0;

  if (topCount - secondCount <= 1) {
    return "steady";
  }
  if ([0, 1, 2].includes(topMonth)) {
    return "pre_season";
  }
  if ([10, 11].includes(topMonth)) {
    return "year_end";
  }
  return "event_driven";
}

function classifyPersona(
  priceSensitivityScore: number,
  serviceContractRate: number,
  avgDaysToClose: number,
  totalDeals: number,
): { persona: PricingPersona; confidence: number; reasoning: string } {
  if (totalDeals === 0) {
    return {
      persona: null,
      confidence: 0,
      reasoning: "New customer profile with no historical transactions.",
    };
  }

  if (priceSensitivityScore <= 0.25 && serviceContractRate >= 0.45) {
    return {
      persona: "relationship_loyal",
      confidence: 0.74,
      reasoning: "Low price sensitivity and strong service-contract adoption indicate loyal behavior.",
    };
  }

  if (priceSensitivityScore >= 0.6) {
    return {
      persona: "budget_constrained",
      confidence: 0.72,
      reasoning: "High discount and loss-to-price signals indicate budget-constrained behavior.",
    };
  }

  if (avgDaysToClose > 0 && avgDaysToClose <= 14) {
    return {
      persona: "urgency_buyer",
      confidence: 0.67,
      reasoning: "Short close cycle suggests urgency-driven purchase behavior.",
    };
  }

  return {
    persona: "value_driven",
    confidence: 0.64,
    reasoning: "Deal behavior indicates value-driven evaluation over pure relationship or urgency.",
  };
}

export function defaultCustomerName(
  hubspotContactId?: string,
  intellidealerCustomerId?: string,
): string {
  if (hubspotContactId) return `HubSpot ${hubspotContactId}`;
  if (intellidealerCustomerId) return `IntelliDealer ${intellidealerCustomerId}`;
  return "QEP Customer";
}

export function computeDnaMetrics(deals: DealHistoryRow[]): DnaMetrics {
  const totalDeals = deals.length;
  const wonDeals = deals.filter((deal) => deal.outcome.toLowerCase() === "won").length;

  const soldValues = deals.map((deal) => deal.sold_price ?? deal.list_price ?? 0).filter((value) => value > 0);
  const discountValues = deals.map((deal) => deal.discount_pct ?? 0).filter((value) => value >= 0);
  const closeDaysValues = deals.map((deal) => deal.days_to_close ?? 0).filter((value) => value > 0);

  const financingUsedCount = deals.filter((deal) => deal.financing_used === true).length;
  const attachmentCount = deals.filter((deal) => (deal.attachments_sold ?? 0) > 0).length;
  const serviceContractCount = deals.filter((deal) => deal.service_contract_sold === true).length;
  const priceLossCount = deals.filter((deal) =>
    typeof deal.loss_reason === "string" && deal.loss_reason.toLowerCase().includes("price")
  ).length;

  const avgDiscountPct = average(discountValues);
  const priceSensitivityScore = clamp(
    avgDiscountPct / 20 + (priceLossCount > 0 ? priceLossCount / Math.max(totalDeals, 1) * 0.35 : 0),
    0,
    1,
  );

  const personaResult = classifyPersona(
    priceSensitivityScore,
    totalDeals > 0 ? serviceContractCount / totalDeals : 0,
    average(closeDaysValues),
    totalDeals,
  );

  const isColdStart = totalDeals < 3;
  const confidence = isColdStart
    ? Math.min(personaResult.confidence, 0.4)
    : personaResult.confidence;

  const badges = totalDeals === 0 ? ["DEMO"] : [];

  return {
    totalDeals,
    wonDeals,
    lifetimeValue: soldValues.reduce((sum, value) => sum + value, 0),
    avgDealSize: average(soldValues),
    avgDiscountPct,
    avgDaysToClose: average(closeDaysValues),
    attachmentRate: totalDeals > 0 ? attachmentCount / totalDeals : 0,
    serviceContractRate: totalDeals > 0 ? serviceContractCount / totalDeals : 0,
    priceSensitivityScore,
    quoteToCloseRatio: wonDeals > 0 ? totalDeals / wonDeals : totalDeals,
    preferredFinancing: financingUsedCount > totalDeals / 2 ? "finance" : "cash",
    seasonalPattern: deriveSeasonalPattern(deals),
    lastDealAt: deals[0]?.deal_date ?? null,
    persona: personaResult.persona,
    personaConfidence: confidence,
    personaReasoning: isColdStart
      ? `Cold-start heuristic. ${personaResult.reasoning}`
      : personaResult.reasoning,
    isColdStart,
    dataBadges: badges,
  };
}
