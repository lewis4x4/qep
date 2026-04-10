import type { CustomerProfileResponse } from "@/features/dge/types";

export interface CustomerOperatingAssessment {
  id: string;
  dealId: string;
  dealName: string;
  createdAt: string;
  application: string | null;
  workType: string | null;
  terrainMaterial: string | null;
  brandPreference: string | null;
  budgetType: string | null;
  monthlyPaymentTarget: number | null;
  financingPreference: string | null;
  nextStep: string | null;
  completenessPct: number | null;
  qrmNarrative: string | null;
}

export interface CustomerOperatingFacet {
  label: string;
  primary: string;
  supporting: string[];
}

export interface CustomerOperatingProfileBoard {
  summary: {
    assessments: number;
    latestAssessmentAt: string | null;
    monthlyTargetAssessments: number;
    financingTaggedAssessments: number;
  };
  workType: CustomerOperatingFacet;
  terrain: CustomerOperatingFacet;
  brandPreference: CustomerOperatingFacet;
  budgetBehavior: CustomerOperatingFacet;
  buyingStyle: CustomerOperatingFacet;
  recentAssessments: CustomerOperatingAssessment[];
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function titleize(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function monthLabel(month: number | null | undefined): string | null {
  if (!month || month < 1 || month > 12) return null;
  return new Date(2000, month - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

function topValue(values: Array<string | null | undefined>): { value: string | null; count: number } {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = normalize(raw);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return { value: best, count: bestCount };
}

function percentage(value: number | null | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function personaLabel(value: string | null | undefined): string | null {
  const normalized = normalize(value);
  return normalized ? titleize(normalized) : null;
}

function buyingStylePrimary(profile: CustomerProfileResponse | null): string {
  const persona = normalize(profile?.pricing_persona);
  switch (persona) {
    case "value_driven":
      return "Value-driven buying style";
    case "relationship_loyal":
      return "Relationship-led buying style";
    case "budget_constrained":
      return "Budget-constrained buying style";
    case "urgency_buyer":
      return "Urgency-led buying style";
    default: {
      const attachmentRate = profile?.behavioral_signals?.attachment_rate ?? 0;
      const serviceRate = profile?.behavioral_signals?.service_contract_rate ?? 0;
      if (attachmentRate >= 0.5 || serviceRate >= 0.5) {
        return "Lifecycle-minded buying style";
      }
      return "Buying style still forming";
    }
  }
}

function budgetBehaviorPrimary(
  profile: CustomerProfileResponse | null,
  assessments: CustomerOperatingAssessment[],
): string {
  const cycleMonth = monthLabel(profile?.budget_cycle_month);
  const topBudgetType = topValue(assessments.map((item) => item.budgetType)).value;
  const priceSensitivity = profile?.price_sensitivity_score ?? 0;

  if (cycleMonth) {
    return `${cycleMonth} budget-cycle motion`;
  }
  if (topBudgetType) {
    return `${titleize(topBudgetType)} budget motion`;
  }
  if (priceSensitivity >= 0.67) {
    return "Price-sensitive budget motion";
  }
  if (priceSensitivity <= 0.33 && profile) {
    return "Flexible budget motion";
  }
  return "Budget behavior still forming";
}

function facetFromCounts(
  label: string,
  fallback: string,
  values: Array<string | null | undefined>,
  suffix: string,
): CustomerOperatingFacet {
  const { value, count } = topValue(values);
  const total = values.map(normalize).filter(Boolean).length;
  if (!value || total === 0) {
    return { label, primary: fallback, supporting: ["No account-linked needs assessments recorded yet."] };
  }
  return {
    label,
    primary: titleize(value),
    supporting: [`Seen in ${count} of ${total} recent assessment${total === 1 ? "" : "s"}.`, suffix],
  };
}

export function buildCustomerOperatingProfileBoard(
  profile: CustomerProfileResponse | null,
  assessments: CustomerOperatingAssessment[],
): CustomerOperatingProfileBoard {
  const latestAssessmentAt = assessments[0]?.createdAt ?? null;
  const monthlyTargetAssessments = assessments.filter((item) => item.monthlyPaymentTarget != null).length;
  const financingTaggedAssessments = assessments.filter((item) => normalize(item.financingPreference)).length;

  const cycleMonth = monthLabel(profile?.budget_cycle_month);
  const topBudgetType = topValue(assessments.map((item) => item.budgetType));
  const topFinancing = topValue(assessments.map((item) => item.financingPreference));

  const budgetSupporting: string[] = [];
  if (cycleMonth) {
    budgetSupporting.push(`Budget cycle opens in ${cycleMonth}.`);
  }
  if (topBudgetType.value) {
    budgetSupporting.push(
      `${titleize(topBudgetType.value)} appears in ${topBudgetType.count} assessment${topBudgetType.count === 1 ? "" : "s"}.`,
    );
  }
  if (topFinancing.value) {
    budgetSupporting.push(`Preferred financing: ${titleize(topFinancing.value)}.`);
  }
  if (monthlyTargetAssessments > 0) {
    budgetSupporting.push(
      `${monthlyTargetAssessments} assessment${monthlyTargetAssessments === 1 ? "" : "s"} include a monthly payment target.`,
    );
  }
  if (budgetSupporting.length === 0) {
    budgetSupporting.push("Budget behavior evidence is still sparse.");
  }

  const buyingSupporting: string[] = [];
  const persona = personaLabel(profile?.pricing_persona);
  if (persona) {
    buyingSupporting.push(`DNA persona: ${persona} (${Math.round((profile?.persona_confidence ?? 0) * 100)}% confidence).`);
  }
  if (profile?.behavioral_signals) {
    buyingSupporting.push(`Attachment rate ${percentage(profile.behavioral_signals.attachment_rate)}.`);
    buyingSupporting.push(`Service contract rate ${percentage(profile.behavioral_signals.service_contract_rate)}.`);
    if (normalize(profile.behavioral_signals.seasonal_pattern)) {
      buyingSupporting.push(`Seasonal pattern: ${titleize(profile.behavioral_signals.seasonal_pattern as string)}.`);
    }
  } else {
    buyingSupporting.push("Behavioral signals are not available for this viewer.");
  }

  return {
    summary: {
      assessments: assessments.length,
      latestAssessmentAt,
      monthlyTargetAssessments,
      financingTaggedAssessments,
    },
    workType: facetFromCounts(
      "Work Type",
      "Work profile still forming",
      assessments.map((item) => item.workType ?? item.application),
      "Derived from account-linked needs assessments.",
    ),
    terrain: facetFromCounts(
      "Terrain",
      "Terrain profile still forming",
      assessments.map((item) => item.terrainMaterial),
      "Derived from terrain/material capture on needs assessments.",
    ),
    brandPreference: facetFromCounts(
      "Brand Preference",
      "Brand preference still forming",
      assessments.map((item) => item.brandPreference),
      "Derived from explicit brand-preference capture in needs assessments.",
    ),
    budgetBehavior: {
      label: "Budget Behavior",
      primary: budgetBehaviorPrimary(profile, assessments),
      supporting: budgetSupporting,
    },
    buyingStyle: {
      label: "Buying Style",
      primary: buyingStylePrimary(profile),
      supporting: buyingSupporting,
    },
    recentAssessments: assessments.slice(0, 6),
  };
}
