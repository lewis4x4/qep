export type SeasonalOpportunityConfidence = "high" | "medium" | "low";

export interface SeasonalOpportunityEquipment {
  companyId: string | null;
  companyName: string | null;
  lat: number | null;
  lng: number | null;
}

export interface SeasonalOpportunityProfile {
  companyId: string;
  companyName: string | null;
  seasonalPattern: string | null;
  budgetCycleMonth: number | null;
}

export interface SeasonalOpportunityVisitRecommendation {
  companyId: string | null;
}

export interface SeasonalOpportunityDeal {
  companyId: string | null;
  weightedAmount: number | null;
}

export interface SeasonalOpportunityRow {
  id: string;
  companyId: string;
  label: string;
  lat: number;
  lng: number;
  weightedRevenue: number;
  visitTargets: number;
  seasonalPattern: string | null;
  budgetCycleMonth: number | null;
  confidence: SeasonalOpportunityConfidence;
  score: number;
  reasons: string[];
}

export interface SeasonalOpportunitySummary {
  mappedAccounts: number;
  seasonalAccounts: number;
  budgetCycleAccounts: number;
  visitTargets: number;
  weightedRevenue: number;
}

export interface SeasonalOpportunityBoard {
  summary: SeasonalOpportunitySummary;
  rows: SeasonalOpportunityRow[];
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function titleize(value: string | null | undefined): string | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isSeasonalPattern(pattern: string | null | undefined): boolean {
  const normalized = normalize(pattern);
  return normalized != null && normalized !== "steady" && normalized !== "unknown";
}

function isBudgetCycleNear(month: number | null | undefined, now = new Date()): boolean {
  if (!month || month < 1 || month > 12) return false;
  const currentMonth = now.getMonth() + 1;
  const distance = Math.min(
    Math.abs(month - currentMonth),
    12 - Math.abs(month - currentMonth),
  );
  return distance <= 2;
}

function confidenceFor(score: number): SeasonalOpportunityConfidence {
  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
}

export function buildSeasonalOpportunityBoard(input: {
  equipment: SeasonalOpportunityEquipment[];
  profiles: SeasonalOpportunityProfile[];
  visitRecommendations: SeasonalOpportunityVisitRecommendation[];
  deals: SeasonalOpportunityDeal[];
  now?: Date;
}): SeasonalOpportunityBoard {
  const now = input.now ?? new Date();
  const rows = new Map<string, SeasonalOpportunityRow>();
  const siteKeysByCompany = new Map<string, string[]>();
  const profileByCompany = new Map(input.profiles.map((profile) => [profile.companyId, profile]));

  for (const eq of input.equipment) {
    if (!eq.companyId || !Number.isFinite(eq.lat) || !Number.isFinite(eq.lng)) continue;
    const key = `seasonal:${eq.companyId}:${eq.lat}:${eq.lng}`;
    if (!rows.has(key)) {
      const profile = profileByCompany.get(eq.companyId) ?? null;
      rows.set(key, {
        id: key,
        companyId: eq.companyId,
        label: eq.companyName ?? profile?.companyName ?? "Account",
        lat: eq.lat as number,
        lng: eq.lng as number,
        weightedRevenue: 0,
        visitTargets: 0,
        seasonalPattern: profile?.seasonalPattern ?? null,
        budgetCycleMonth: profile?.budgetCycleMonth ?? null,
        confidence: "low",
        score: 0,
        reasons: [],
      });
    }
    const siteKeys = siteKeysByCompany.get(eq.companyId) ?? [];
    if (!siteKeys.includes(key)) siteKeys.push(key);
    siteKeysByCompany.set(eq.companyId, siteKeys);
  }

  for (const deal of input.deals) {
    if (!deal.companyId) continue;
    const siteKeys = siteKeysByCompany.get(deal.companyId) ?? [];
    if (siteKeys.length === 0) continue;
    const share = Number(deal.weightedAmount ?? 0) / siteKeys.length;
    for (const key of siteKeys) {
      const row = rows.get(key);
      if (!row) continue;
      row.weightedRevenue += share;
    }
  }

  for (const visit of input.visitRecommendations) {
    if (!visit.companyId) continue;
    const siteKeys = siteKeysByCompany.get(visit.companyId) ?? [];
    if (siteKeys.length === 0) continue;
    const row = rows.get(siteKeys[0]!);
    if (row) row.visitTargets += 1;
  }

  const list = [...rows.values()]
    .map((row) => {
      const reasons: string[] = [];
      let score = 0;
      let hasRouteableSignal = false;

      if (isSeasonalPattern(row.seasonalPattern)) {
        reasons.push(`Seasonal pattern: ${titleize(row.seasonalPattern)}.`);
        score += 3;
        hasRouteableSignal = true;
      }

      if (isBudgetCycleNear(row.budgetCycleMonth, now)) {
        reasons.push(`Budget cycle is near month ${row.budgetCycleMonth}.`);
        score += 3;
        hasRouteableSignal = true;
      }

      if (row.visitTargets > 0) {
        reasons.push(`${row.visitTargets} predictive visit target${row.visitTargets === 1 ? "" : "s"} already on the account.`);
        score += 2;
        hasRouteableSignal = true;
      }

      if (row.weightedRevenue > 0) {
        reasons.push(`$${Math.round(row.weightedRevenue).toLocaleString()} weighted pipeline already tied to the account.`);
        score += 1;
      }

      return {
        ...row,
        reasons,
        score,
        confidence: confidenceFor(score),
        hasRouteableSignal,
      };
    })
    .filter((row) => row.hasRouteableSignal)
    .map(({ hasRouteableSignal: _hasRouteableSignal, ...row }) => row)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.weightedRevenue - a.weightedRevenue;
    });

  return {
    summary: {
      mappedAccounts: list.length,
      seasonalAccounts: list.filter((row) => isSeasonalPattern(row.seasonalPattern)).length,
      budgetCycleAccounts: list.filter((row) => isBudgetCycleNear(row.budgetCycleMonth, now)).length,
      visitTargets: list.reduce((sum, row) => sum + row.visitTargets, 0),
      weightedRevenue: list.reduce((sum, row) => sum + row.weightedRevenue, 0),
    },
    rows: list,
  };
}
