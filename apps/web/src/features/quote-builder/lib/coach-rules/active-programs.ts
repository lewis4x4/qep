import type { DealCoachContext, RuleEvaluator, RuleResult } from "./types";

/**
 * Rule: Brand has active programs the draft hasn't acknowledged.
 *
 * QEP competes on program stacking (service credits, financing,
 * bridge rent-to-sales, etc.). Reps miss stackable incentives either
 * because the quote builder doesn't surface them or because they
 * default to the plainest pricing path.
 *
 * Fires when the equipment's brand has 1+ active qb_programs rows
 * AND the quote draft has no financing_scenarios (meaning no program
 * has been applied yet).
 *
 * Severity:
 *   ≥3 active programs unused → warning  (likely missing value)
 *   1-2 active programs unused → info    (opportunity reminder)
 */

export const activeProgramsRule: RuleEvaluator = (ctx: DealCoachContext): RuleResult | null => {
  const programs = ctx.activePrograms;
  if (programs.length === 0) return null;

  // If the draft already includes financing/recommendation info, assume the
  // rep has thought about programs. The rule's job is to nudge the
  // un-nudged, not to nag.
  const draftHasRecommendation = !!ctx.draft.recommendation;
  if (draftHasRecommendation) return null;

  const severity: "warning" | "info" = programs.length >= 3 ? "warning" : "info";

  // Group programs by brand for the body copy.
  const byBrand = new Map<string, string[]>();
  for (const p of programs) {
    const existing = byBrand.get(p.brandName) ?? [];
    existing.push(`${p.programCode} (${humanType(p.programType)})`);
    byBrand.set(p.brandName, existing);
  }

  const brandLines = [...byBrand.entries()]
    .map(([brand, progs]) => `${brand}: ${progs.slice(0, 3).join(", ")}${progs.length > 3 ? ` +${progs.length - 3} more` : ""}`)
    .join(" · ");

  return {
    ruleId: "active_programs",
    severity,
    title: `${programs.length} active program${programs.length === 1 ? "" : "s"} available`,
    body:
      `${brandLines}. ` +
      `Review which stack for this customer — service credit, financing, and rebates often compound.`,
    why:
      `Pulled from qb_programs where \`active = true\` and today falls inside \`effective_from\`/\`effective_to\`. ` +
      `Matches on the brand name of the equipment in your draft.`,
    action: {
      label: "Show programs",
      actionId: "open_programs_panel",
    },
    metrics: {
      active_program_count: programs.length,
      brand_count: byBrand.size,
    },
  };
};

function humanType(raw: string): string {
  switch (raw) {
    case "low_rate_financing":     return "financing";
    case "cash_in_lieu":            return "rebate";
    case "gmu_rebate":              return "GMU rebate";
    case "bridge_rent_to_sales":    return "bridge rent-to-sales";
    case "additional_rebate":       return "rebate";
    case "aged_inventory":          return "aged inventory";
    default:                        return raw.replace(/_/g, " ");
  }
}
