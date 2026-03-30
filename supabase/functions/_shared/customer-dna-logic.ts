export type PricingPersona =
  | "value_driven"
  | "relationship_loyal"
  | "budget_constrained"
  | "urgency_buyer"
  | null;

export interface DealHistorySignal {
  outcome: string;
  sold_price: number | null;
  discount_pct: number | null;
  financing_used: boolean | null;
  attachments_sold: number | null;
  service_contract_sold: boolean | null;
  days_to_close: number | null;
  deal_date: string;
}

export interface CrmDealSignal {
  amount: number | null;
  created_at: string;
  stage_is_closed_won: boolean;
}

export interface CustomerDnaMetrics {
  totalDeals: number;
  wonDeals: number;
  totalLifetimeValue: number;
  avgDealSize: number | null;
  avgDiscountPct: number | null;
  avgDaysToClose: number | null;
  attachmentRate: number | null;
  serviceContractRate: number | null;
  financingRate: number | null;
  priceSensitivityScore: number;
  lastInteractionAt: string | null;
}

export interface PersonaResult {
  persona: PricingPersona;
  confidence: number;
  reasoning: string;
}

function average(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function latestDate(values: string[]): string | null {
  if (values.length === 0) return null;
  return [...values].sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function confidenceFromSignals(
  totalDeals: number,
  scoreSpread: number,
): number {
  const sampleStrength = clamp(totalDeals / 12, 0, 1);
  const spreadStrength = clamp(scoreSpread, 0, 1);
  return Number(
    (0.25 + sampleStrength * 0.45 + spreadStrength * 0.3).toFixed(2),
  );
}

export function computeCustomerDnaMetrics(
  dealHistory: DealHistorySignal[],
  crmDeals: CrmDealSignal[],
): CustomerDnaMetrics {
  const totalDeals = dealHistory.length > 0
    ? dealHistory.length
    : crmDeals.length;
  const wonDeals = dealHistory.length > 0
    ? dealHistory.filter((deal) => deal.outcome.toLowerCase() === "won").length
    : crmDeals.filter((deal) => deal.stage_is_closed_won).length;

  const lifetimeValuesFromHistory = dealHistory
    .filter((deal) => deal.outcome.toLowerCase() === "won")
    .map((deal) => deal.sold_price)
    .filter((value): value is number => typeof value === "number");

  const lifetimeValuesFromCrm = crmDeals
    .filter((deal) => deal.stage_is_closed_won)
    .map((deal) => deal.amount)
    .filter((value): value is number => typeof value === "number");

  const totalLifetimeValue =
    (lifetimeValuesFromHistory.length > 0
      ? lifetimeValuesFromHistory
      : lifetimeValuesFromCrm).reduce((sum, value) => sum + value, 0);

  const discountValues = dealHistory
    .map((deal) => deal.discount_pct)
    .filter((value): value is number => typeof value === "number");
  const daysToCloseValues = dealHistory
    .map((deal) => deal.days_to_close)
    .filter((value): value is number => typeof value === "number");

  const financedDeals =
    dealHistory.filter((deal) => deal.financing_used === true).length;
  const attachmentDeals =
    dealHistory.filter((deal) => (deal.attachments_sold ?? 0) > 0).length;
  const serviceContractDeals =
    dealHistory.filter((deal) => deal.service_contract_sold === true)
      .length;

  const avgDiscountPct = average(discountValues);
  const financingRate = totalDeals > 0 ? financedDeals / totalDeals : null;
  const attachmentRate = totalDeals > 0 ? attachmentDeals / totalDeals : null;
  const serviceContractRate = totalDeals > 0
    ? serviceContractDeals / totalDeals
    : null;
  const avgDaysToClose = average(daysToCloseValues);

  const discountSignal = avgDiscountPct === null
    ? 0.4
    : clamp(avgDiscountPct / 22, 0, 1);
  const financingSignal = financingRate === null
    ? 0.4
    : clamp(financingRate, 0, 1);
  const speedSignal = avgDaysToClose === null
    ? 0.4
    : clamp((45 - avgDaysToClose) / 45, 0, 1);
  const repeatSignal = totalDeals > 0 ? clamp(wonDeals / totalDeals, 0, 1) : 0;

  const priceSensitivityScore = Number(
    clamp(
      discountSignal * 0.45 +
        financingSignal * 0.25 +
        (1 - repeatSignal) * 0.2 +
        (1 - speedSignal) * 0.1,
      0,
      1,
    ).toFixed(2),
  );

  const historyDates = dealHistory.map((item) => item.deal_date);
  const crmDates = crmDeals.map((item) => item.created_at);

  return {
    totalDeals,
    wonDeals,
    totalLifetimeValue: Number(totalLifetimeValue.toFixed(2)),
    avgDealSize: wonDeals > 0
      ? Number((totalLifetimeValue / wonDeals).toFixed(2))
      : null,
    avgDiscountPct: avgDiscountPct === null
      ? null
      : Number(avgDiscountPct.toFixed(2)),
    avgDaysToClose: avgDaysToClose === null
      ? null
      : Number(avgDaysToClose.toFixed(0)),
    attachmentRate: attachmentRate === null
      ? null
      : Number(attachmentRate.toFixed(2)),
    serviceContractRate: serviceContractRate === null
      ? null
      : Number(serviceContractRate.toFixed(2)),
    financingRate: financingRate === null
      ? null
      : Number(financingRate.toFixed(2)),
    priceSensitivityScore,
    lastInteractionAt: latestDate([...historyDates, ...crmDates]),
  };
}

export function classifyPersona(metrics: CustomerDnaMetrics): PersonaResult {
  if (metrics.totalDeals === 0) {
    return {
      persona: null,
      confidence: 0,
      reasoning: "New customer with no transaction history yet.",
    };
  }

  const financingRate = metrics.financingRate ?? 0;
  const avgDaysToClose = metrics.avgDaysToClose ?? 30;
  const loyaltyRatio = metrics.totalDeals > 0
    ? metrics.wonDeals / metrics.totalDeals
    : 0;

  const scoreBudgetConstrained = clamp(
    metrics.priceSensitivityScore * 0.6 + financingRate * 0.4,
    0,
    1,
  );
  const scoreRelationshipLoyal = clamp(
    loyaltyRatio * 0.7 + (1 - metrics.priceSensitivityScore) * 0.3,
    0,
    1,
  );
  const scoreUrgencyBuyer = clamp((30 - avgDaysToClose) / 30, 0, 1);
  const scoreValueDriven = clamp(
    0.6 - metrics.priceSensitivityScore * 0.5 +
      (metrics.attachmentRate ?? 0) * 0.4,
    0,
    1,
  );

  const ranking: Array<
    { persona: Exclude<PricingPersona, null>; score: number }
  > = [
    { persona: "budget_constrained" as const, score: scoreBudgetConstrained },
    { persona: "relationship_loyal" as const, score: scoreRelationshipLoyal },
    { persona: "urgency_buyer" as const, score: scoreUrgencyBuyer },
    { persona: "value_driven" as const, score: scoreValueDriven },
  ];
  ranking.sort((a, b) => b.score - a.score);

  const winner = ranking[0];
  const runnerUp = ranking[1];
  const spread = (winner?.score ?? 0) - (runnerUp?.score ?? 0);
  const confidence = confidenceFromSignals(metrics.totalDeals, spread);

  if (metrics.totalDeals < 3) {
    return {
      persona: winner?.persona ?? null,
      confidence: Number(Math.min(0.4, confidence).toFixed(2)),
      reasoning:
        `Cold-start profile from ${metrics.totalDeals} interaction(s).`,
    };
  }

  return {
    persona: winner?.persona ?? null,
    confidence,
    reasoning: `Top signal ${winner?.persona ?? "unknown"} (${
      Math.round((winner?.score ?? 0) * 100)
    }%).`,
  };
}
