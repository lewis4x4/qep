import type { DealRoomFinanceScenario, DealRoomQuote } from "./deal-room-api";

// Standard amortizing payment — returns monthly payment given principal,
// APR (percent, not decimal), and term months. Zero-rate falls back to
// a straight-line payment so an interest-free promo renders cleanly.
export function amortizedMonthlyPayment(principal: number, aprPct: number, termMonths: number): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(termMonths) || termMonths <= 0) return 0;
  const monthlyRate = Math.max(0, aprPct) / 100 / 12;
  if (monthlyRate === 0) return principal / termMonths;
  const factor = Math.pow(1 + monthlyRate, -termMonths);
  return (principal * monthlyRate) / (1 - factor);
}

export interface PaymentInputs {
  cashDown: number;
  termMonths: number;
  scenarioKey: string;
}

export interface ComputedPayment {
  scenario: DealRoomFinanceScenario;
  amountFinanced: number;
  monthlyPayment: number;
  totalCost: number;
  isCash: boolean;
}

// Given the quote and the customer's current inputs, return the
// re-computed numbers for the selected financing scenario. Cash scenarios
// short-circuit the math (no financing, total = customer_total - cash_down).
export function computePaymentFor(
  quote: DealRoomQuote,
  scenario: DealRoomFinanceScenario,
  inputs: PaymentInputs,
): ComputedPayment {
  const customerTotal = Math.max(0, quote.customer_total ?? 0);
  const cashDown = Math.min(Math.max(0, inputs.cashDown), customerTotal);
  const principal = Math.max(0, customerTotal - cashDown);
  const isCash = (scenario.type ?? "").toLowerCase() === "cash";
  if (isCash) {
    return {
      scenario,
      amountFinanced: 0,
      monthlyPayment: 0,
      totalCost: principal,
      isCash: true,
    };
  }
  const aprPct = scenario.apr ?? scenario.rate ?? 0;
  const term = inputs.termMonths > 0 ? inputs.termMonths : (scenario.term_months ?? 60);
  const monthly = amortizedMonthlyPayment(principal, aprPct, term);
  return {
    scenario,
    amountFinanced: principal,
    monthlyPayment: monthly,
    totalCost: monthly * term,
    isCash: false,
  };
}

// Unique key for a scenario — label is preferred (human-stable), with
// type as fallback so cash-only quotes still tab-select cleanly.
export function scenarioKey(scenario: DealRoomFinanceScenario): string {
  return (scenario.label ?? scenario.type ?? "scenario").trim();
}

// Filter cash-placeholder rows the rep-side didn't actually populate —
// matches the same heuristic the print HTML uses so customer-visible
// options stay consistent with the PDF.
export function filterDisplayableScenarios(
  scenarios: DealRoomFinanceScenario[],
): DealRoomFinanceScenario[] {
  return (scenarios ?? []).filter((s) =>
    s.type !== "cash"
    || (s.monthly_payment ?? null) != null
    || (s.term_months ?? 0) > 0
    || ((s.rate ?? s.apr ?? 0) > 0),
  );
}
