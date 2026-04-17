/**
 * QEP Program Engine — Program Recommender (Slice 03)
 *
 * recommendPrograms() fetches all active qb_programs for the brand,
 * runs isEligible() on each, and returns the full list with eligibility.
 *
 * The edge function (qb-recommend-programs) calls this with a Supabase client
 * that carries the user's JWT so RLS applies.
 *
 * No LLM calls. Pure DB + deterministic eligibility logic.
 */

import type { QuoteContext, ProgramRecommendation } from "./types.ts";

/** Minimal duck-type for a Supabase client — avoids a bare npm import in Deno. */
interface SupabaseLike {
  from: (table: string) => any;
}
import { isEligible } from "./eligibility.ts";

export async function recommendPrograms(
  context: QuoteContext,
  supabase: SupabaseLike,
): Promise<ProgramRecommendation[]> {
  // Single query: all active programs for this brand that overlap with dealDate.
  // The eligibility function handles the fine-grained date check in TS so we
  // cast here — this just pre-filters to a small set.
  const dealIso = context.dealDate.toISOString().split("T")[0];

  const { data: programs, error } = await supabase
    .from("qb_programs")
    .select("*")
    .eq("brand_id", context.brandId)
    .eq("active", true)
    .lte("effective_from", dealIso)
    .or(`effective_to.is.null,effective_to.gte.${dealIso}`);

  if (error) {
    throw new Error(`Failed to load programs for brand ${context.brandId}: ${error.message}`);
  }

  const recommendations: ProgramRecommendation[] = [];

  for (const program of programs ?? []) {
    const eligibility = isEligible(program as any, context);

    let estimatedCustomerBenefitCents: number | undefined;
    let estimatedDealerCostCents: number | undefined;

    if (eligibility.eligible && eligibility.amountCents) {
      estimatedCustomerBenefitCents = eligibility.amountCents;
    }

    // For financing: dealer participation cost at the lowest-participation term
    if (program.program_type === "low_rate_financing" && eligibility.eligible) {
      const details = program.details as any;
      const terms = (details?.terms ?? []) as Array<{
        months: number;
        rate_pct: number;
        dealer_participation_pct: number;
      }>;
      const minDealerCostTerm = terms.reduce(
        (min: any, t: any) => (min === null || t.dealer_participation_pct < min.dealer_participation_pct ? t : min),
        null as any,
      );
      if (minDealerCostTerm && minDealerCostTerm.dealer_participation_pct > 0) {
        estimatedDealerCostCents = Math.round(
          context.listPriceCents * minDealerCostTerm.dealer_participation_pct,
        );
      }
    }

    const notes: string[] = [];
    if (!eligibility.eligible && eligibility.requirements?.length) {
      notes.push(...eligibility.requirements);
    }

    recommendations.push({
      programId: program.id,
      programCode: program.program_code,
      name: program.name,
      programType: program.program_type as any,
      eligibility,
      estimatedCustomerBenefitCents,
      estimatedDealerCostCents,
      notes,
    });
  }

  // Sort: eligible first, then by customer benefit descending
  return recommendations.sort((a, b) => {
    if (a.eligibility.eligible && !b.eligibility.eligible) return -1;
    if (!a.eligibility.eligible && b.eligibility.eligible) return 1;
    return (b.estimatedCustomerBenefitCents ?? 0) - (a.estimatedCustomerBenefitCents ?? 0);
  });
}
