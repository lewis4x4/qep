import type { QuoteFinanceScenario } from "../../../../../../shared/qep-moonshot-contracts";

export interface CustomFinanceInput {
  enabled: boolean;
  amountFinanced: number;
  ratePct: number | null;
  termMonths: number | null;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildCustomFinanceScenario(input: CustomFinanceInput): QuoteFinanceScenario | null {
  if (!input.enabled || input.amountFinanced <= 0) return null;

  const ratePct = typeof input.ratePct === "number" && Number.isFinite(input.ratePct)
    ? Math.max(0, input.ratePct)
    : null;
  const termMonths = typeof input.termMonths === "number" && Number.isFinite(input.termMonths)
    ? Math.max(0, Math.round(input.termMonths))
    : null;

  if (ratePct == null || termMonths == null || termMonths <= 0) {
    return null;
  }

  const monthlyRate = ratePct / 100 / 12;
  const monthlyPayment = monthlyRate > 0
    ? (input.amountFinanced * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
      (Math.pow(1 + monthlyRate, termMonths) - 1)
    : input.amountFinanced / termMonths;

  return {
    type: "finance",
    label: `Custom Finance ${termMonths} mo`,
    monthlyPayment: roundCurrency(monthlyPayment),
    apr: roundCurrency(ratePct),
    rate: roundCurrency(ratePct),
    termMonths,
    totalCost: roundCurrency(monthlyPayment * termMonths),
    lender: "Custom terms",
  };
}
