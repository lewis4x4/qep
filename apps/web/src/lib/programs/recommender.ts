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

import type { QbProgram, QbProgramType, QuoteContext, ProgramRecommendation } from "./types.ts";

/** Minimal duck-type for a Supabase client — avoids a bare npm import in Deno. */
interface SupabaseLike {
  from: <Row>(table: string) => SupabaseQueryBuilder<Row>;
}
import { isEligible } from "./eligibility.ts";

interface SupabaseQueryResult<Data> {
  data: Data | null;
  error: { message: string } | null;
}

interface SupabaseQueryBuilder<Row> extends PromiseLike<SupabaseQueryResult<Row[]>> {
  select(columns: string): SupabaseQueryBuilder<Row>;
  eq(column: string, value: unknown): SupabaseQueryBuilder<Row>;
  lte(column: string, value: unknown): SupabaseQueryBuilder<Row>;
  or(filters: string): SupabaseQueryBuilder<Row>;
}

type ProgramRow = Omit<QbProgram, "program_type"> & {
  program_type: QbProgramType;
};

interface FinancingTerm {
  months: number;
  rate_pct: number;
  dealer_participation_pct: number;
}

function isFinancingTerm(value: unknown): value is FinancingTerm {
  if (typeof value !== "object" || value === null) return false;
  const term = value as Record<string, unknown>;
  return (
    typeof term.months === "number" &&
    typeof term.rate_pct === "number" &&
    typeof term.dealer_participation_pct === "number"
  );
}

function financingTerms(details: Record<string, unknown>): FinancingTerm[] {
  const terms = details.terms;
  return Array.isArray(terms) ? terms.filter(isFinancingTerm) : [];
}

function lowestDealerParticipationTerm(terms: FinancingTerm[]): FinancingTerm | undefined {
  return terms.reduce<FinancingTerm | undefined>(
    (min, term) =>
      min === undefined || term.dealer_participation_pct < min.dealer_participation_pct ? term : min,
    undefined,
  );
}

export async function recommendPrograms(
  context: QuoteContext,
  supabase: SupabaseLike,
): Promise<ProgramRecommendation[]> {
  // Single query: all active programs for this brand that overlap with dealDate.
  // The eligibility function handles the fine-grained date check in TS so we
  // cast here — this just pre-filters to a small set.
  const dealIso = context.dealDate.toISOString().split("T")[0];

  const { data: programs, error } = await supabase
    .from<ProgramRow>("qb_programs")
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
    const eligibility = isEligible(program, context);

    let estimatedCustomerBenefitCents: number | undefined;
    let estimatedDealerCostCents: number | undefined;

    if (eligibility.eligible && eligibility.amountCents) {
      estimatedCustomerBenefitCents = eligibility.amountCents;
    }

    // For financing: dealer participation cost at the lowest-participation term
    if (program.program_type === "low_rate_financing" && eligibility.eligible) {
      const minDealerCostTerm = lowestDealerParticipationTerm(financingTerms(program.details));
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
      programType: program.program_type,
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
