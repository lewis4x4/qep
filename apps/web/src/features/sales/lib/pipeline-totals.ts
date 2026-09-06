import type { RepPipelineDeal } from "./types";

/** Probabilities are persisted percentages (0–100), independent of display order. */
export function weightedPipelineValue(deals: Pick<RepPipelineDeal, "amount" | "stage_probability">[]): number | null {
  let total = 0;
  for (const deal of deals) {
    const probability = deal.stage_probability;
    if (probability == null || !Number.isFinite(probability) || probability < 0 || probability > 100) return null;
    total += (deal.amount ?? 0) * probability / 100;
  }
  return total;
}
