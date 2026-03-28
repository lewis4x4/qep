/**
 * Financing Partners Mock Adapter — rate tables for AgDirect, CNH Capital, etc.
 */

import type {
  IntegrationAdapter,
  AdapterConfig,
  AdapterResult,
  FinancingRequest,
  FinancingResult,
  FinancingRate,
} from "../integration-types.ts";

interface RateTemplate {
  lender_name: string;
  term_months: number;
  credit_tier: string;
  rate_pct: number;
  dealer_holdback_pct: number;
}

const RATE_TEMPLATES: RateTemplate[] = [
  { lender_name: "AgDirect", term_months: 36, credit_tier: "A", rate_pct: 4.99, dealer_holdback_pct: 1.25 },
  { lender_name: "AgDirect", term_months: 48, credit_tier: "A", rate_pct: 5.25, dealer_holdback_pct: 1.25 },
  { lender_name: "AgDirect", term_months: 60, credit_tier: "A", rate_pct: 5.75, dealer_holdback_pct: 1.25 },
  { lender_name: "AgDirect", term_months: 60, credit_tier: "B", rate_pct: 6.99, dealer_holdback_pct: 1.0 },
  { lender_name: "AgDirect", term_months: 72, credit_tier: "A", rate_pct: 6.25, dealer_holdback_pct: 1.0 },
  { lender_name: "CNH Capital", term_months: 36, credit_tier: "A", rate_pct: 4.75, dealer_holdback_pct: 1.5 },
  { lender_name: "CNH Capital", term_months: 60, credit_tier: "A", rate_pct: 5.50, dealer_holdback_pct: 1.5 },
  { lender_name: "CNH Capital", term_months: 60, credit_tier: "B", rate_pct: 6.75, dealer_holdback_pct: 1.0 },
  { lender_name: "John Deere Financial", term_months: 48, credit_tier: "A", rate_pct: 4.99, dealer_holdback_pct: 1.0 },
  { lender_name: "John Deere Financial", term_months: 60, credit_tier: "A", rate_pct: 5.49, dealer_holdback_pct: 1.0 },
  { lender_name: "AGCO Finance", term_months: 60, credit_tier: "A", rate_pct: 5.25, dealer_holdback_pct: 1.25 },
  { lender_name: "AGCO Finance", term_months: 60, credit_tier: "B", rate_pct: 6.50, dealer_holdback_pct: 0.75 },
];

function calcMonthlyPayment(amount: number, annualRatePct: number, termMonths: number): number {
  const r = annualRatePct / 100 / 12;
  if (r === 0) return amount / termMonths;
  return Math.round((amount * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1) * 100) / 100;
}

export class FinancingMockAdapter
  implements IntegrationAdapter<FinancingRequest, FinancingResult>
{
  readonly integrationKey = "financing" as const;
  readonly isMock = true;

  async execute(
    request: FinancingRequest,
    _config: AdapterConfig
  ): Promise<AdapterResult<FinancingResult>> {
    await _simulateLatency(60, 150);

    const tier = request.credit_tier ?? "A";
    const matchingRates = RATE_TEMPLATES.filter(
      (r) =>
        r.credit_tier === tier &&
        (request.term_months ? r.term_months === request.term_months : true)
    );

    const rates: FinancingRate[] = matchingRates.map((r) => ({
      lender_name: r.lender_name,
      rate_pct: r.rate_pct,
      dealer_holdback_pct: r.dealer_holdback_pct,
      monthly_payment: calcMonthlyPayment(request.amount, r.rate_pct, r.term_months),
      term_months: r.term_months,
      credit_tier: r.credit_tier,
    }));

    return {
      data: { rates, as_of: new Date().toISOString() },
      badge: "DEMO",
      isMock: true,
      latencyMs: 105,
      source: "financing-mock",
    };
  }

  async testConnection(
    _config: AdapterConfig
  ): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    await _simulateLatency(40, 80);
    return { success: true, latencyMs: 60 };
  }
}

function _simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, delay));
}
