import type { QrmWeightedDeal } from "./types";
import type { CompetitiveDefenseRow, CompetitiveTakeShareRow } from "./competitive-displacement";

export type CompetitiveThreatConfidence = "high" | "medium" | "low";

export interface CompetitiveThreatServiceLink {
  branchId: string | null;
  companyId: string | null;
}

export interface CompetitiveThreatRow {
  id: string;
  label: string;
  threatenedAccounts: number;
  weightedRevenue: number;
  confidence: CompetitiveThreatConfidence;
  trace: string[];
}

export interface CompetitiveThreatMapBoard {
  summary: {
    threatenedAccounts: number;
    threatenedReps: number;
    threatenedBranches: number;
    takeShareWindows: number;
  };
  accountRows: CompetitiveThreatRow[];
  repRows: CompetitiveThreatRow[];
  branchRows: CompetitiveThreatRow[];
  marketRows: CompetitiveTakeShareRow[];
}

function confidenceForThreat(input: {
  threatenedAccounts: number;
  weightedRevenue: number;
  staleListings?: number;
  competitorMentions?: number;
}): CompetitiveThreatConfidence {
  if (
    input.threatenedAccounts >= 2 ||
    input.weightedRevenue >= 250_000 ||
    (input.staleListings ?? 0) >= 2 ||
    (input.competitorMentions ?? 0) >= 3
  ) {
    return "high";
  }
  if (
    input.threatenedAccounts >= 1 ||
    input.weightedRevenue >= 50_000 ||
    (input.staleListings ?? 0) >= 1 ||
    (input.competitorMentions ?? 0) >= 1
  ) {
    return "medium";
  }
  return "low";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function buildCompetitiveThreatMapBoard(input: {
  defenseRows: CompetitiveDefenseRow[];
  takeShareRows: CompetitiveTakeShareRow[];
  deals: QrmWeightedDeal[];
  repNameById: Map<string, string>;
  branchNameById: Map<string, string>;
  serviceLinks: CompetitiveThreatServiceLink[];
}): CompetitiveThreatMapBoard {
  const accountRows: CompetitiveThreatRow[] = input.defenseRows.map((row) => ({
    id: row.companyId,
    label: row.companyName,
    threatenedAccounts: 1,
    weightedRevenue: row.weightedRevenue,
    confidence: confidenceForThreat({
      threatenedAccounts: 1,
      weightedRevenue: row.weightedRevenue,
      staleListings: row.staleListings,
      competitorMentions: row.competitorMentionCount,
    }),
    trace: row.reasons,
  }));

  const defenseByCompany = new Map(input.defenseRows.map((row) => [row.companyId, row]));

  const repBuckets = new Map<string, {
    weightedRevenue: number;
    companyIds: string[];
    competitorMentions: number;
    staleListings: number;
    traces: string[];
  }>();
  for (const deal of input.deals) {
    if (!deal.assignedRepId || !deal.companyId) continue;
    const defense = defenseByCompany.get(deal.companyId);
    if (!defense) continue;
    const bucket = repBuckets.get(deal.assignedRepId) ?? {
      weightedRevenue: 0,
      companyIds: [],
      competitorMentions: 0,
      staleListings: 0,
      traces: [],
    };
    bucket.weightedRevenue += deal.weightedAmount ?? 0;
    bucket.companyIds.push(deal.companyId);
    bucket.competitorMentions += defense.competitorMentionCount;
    bucket.staleListings += defense.staleListings;
    bucket.traces.push(...defense.reasons);
    repBuckets.set(deal.assignedRepId, bucket);
  }

  const repRows: CompetitiveThreatRow[] = [...repBuckets.entries()]
    .map(([repId, bucket]) => ({
      id: repId,
      label: input.repNameById.get(repId) ?? "Unassigned rep",
      threatenedAccounts: unique(bucket.companyIds).length,
      weightedRevenue: bucket.weightedRevenue,
      confidence: confidenceForThreat({
        threatenedAccounts: unique(bucket.companyIds).length,
        weightedRevenue: bucket.weightedRevenue,
        staleListings: bucket.staleListings,
        competitorMentions: bucket.competitorMentions,
      }),
      trace: unique(bucket.traces).slice(0, 4),
    }))
    .sort((a, b) => b.weightedRevenue - a.weightedRevenue);

  const branchBuckets = new Map<string, {
    weightedRevenue: number;
    companyIds: string[];
    competitorMentions: number;
    staleListings: number;
    traces: string[];
  }>();
  for (const link of input.serviceLinks) {
    if (!link.branchId || !link.companyId) continue;
    const defense = defenseByCompany.get(link.companyId);
    if (!defense) continue;
    const bucket = branchBuckets.get(link.branchId) ?? {
      weightedRevenue: 0,
      companyIds: [],
      competitorMentions: 0,
      staleListings: 0,
      traces: [],
    };
    bucket.weightedRevenue += defense.weightedRevenue;
    bucket.companyIds.push(link.companyId);
    bucket.competitorMentions += defense.competitorMentionCount;
    bucket.staleListings += defense.staleListings;
    bucket.traces.push(...defense.reasons);
    branchBuckets.set(link.branchId, bucket);
  }

  const branchRows: CompetitiveThreatRow[] = [...branchBuckets.entries()]
    .map(([branchId, bucket]) => ({
      id: branchId,
      label: input.branchNameById.get(branchId) ?? branchId,
      threatenedAccounts: unique(bucket.companyIds).length,
      weightedRevenue: bucket.weightedRevenue,
      confidence: confidenceForThreat({
        threatenedAccounts: unique(bucket.companyIds).length,
        weightedRevenue: bucket.weightedRevenue,
        staleListings: bucket.staleListings,
        competitorMentions: bucket.competitorMentions,
      }),
      trace: unique(bucket.traces).slice(0, 4),
    }))
    .sort((a, b) => b.weightedRevenue - a.weightedRevenue);

  return {
    summary: {
      threatenedAccounts: accountRows.length,
      threatenedReps: repRows.length,
      threatenedBranches: branchRows.length,
      takeShareWindows: input.takeShareRows.length,
    },
    accountRows,
    repRows,
    branchRows,
    marketRows: input.takeShareRows,
  };
}
