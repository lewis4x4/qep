import type { QrmWeightedDeal } from "./types";

export interface CompetitorListingSignal {
  id: string;
  make: string;
  model: string;
  askingPrice: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  source: string;
  location: string | null;
}

export interface CompetitorAccountEquipment {
  companyId: string | null;
  companyName: string | null;
  make: string | null;
  model: string | null;
}

export interface CompetitorVoiceSignal {
  companyId: string | null;
  mentions: string[];
}

export interface CompetitiveDefenseRow {
  companyId: string;
  companyName: string;
  weightedRevenue: number;
  competitorMentionCount: number;
  matchingListings: number;
  staleListings: number;
  reasons: string[];
}

export interface CompetitiveTakeShareRow {
  make: string;
  model: string;
  listingCount: number;
  staleListingCount: number;
  avgAsk: number | null;
  matchingAccounts: number;
  weightedRevenue: number;
}

export interface CompetitiveDisplacementSummary {
  threatenedAccounts: number;
  takeShareWindows: number;
  activeListings: number;
  staleListings: number;
}

export interface CompetitiveDisplacementBoard {
  summary: CompetitiveDisplacementSummary;
  defenseRows: CompetitiveDefenseRow[];
  takeShareRows: CompetitiveTakeShareRow[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeModelKey(make: string | null | undefined, model: string | null | undefined): string | null {
  if (!make || !model) return null;
  return `${make.trim().toLowerCase()}::${model.trim().toLowerCase()}`;
}

export function buildCompetitiveDisplacementBoard(input: {
  listings: CompetitorListingSignal[];
  equipment: CompetitorAccountEquipment[];
  voiceSignals: CompetitorVoiceSignal[];
  deals: QrmWeightedDeal[];
  nowTime?: number;
}): CompetitiveDisplacementBoard {
  const nowTime = input.nowTime ?? Date.now();
  const listingByKey = new Map<string, CompetitorListingSignal[]>();
  let staleListings = 0;

  for (const listing of input.listings) {
    const key = makeModelKey(listing.make, listing.model);
    if (!key) continue;
    const bucket = listingByKey.get(key) ?? [];
    bucket.push(listing);
    listingByKey.set(key, bucket);

    const firstSeen = parseTime(listing.firstSeenAt);
    if (firstSeen != null && firstSeen <= nowTime - 21 * 86_400_000) {
      staleListings += 1;
    }
  }

  const mentionsByCompany = new Map<string, string[]>();
  for (const signal of input.voiceSignals) {
    if (!signal.companyId) continue;
    const bucket = mentionsByCompany.get(signal.companyId) ?? [];
    bucket.push(...signal.mentions);
    mentionsByCompany.set(signal.companyId, bucket);
  }

  const weightedRevenueByCompany = new Map<string, number>();
  for (const deal of input.deals) {
    if (!deal.companyId) continue;
    weightedRevenueByCompany.set(
      deal.companyId,
      (weightedRevenueByCompany.get(deal.companyId) ?? 0) + (deal.weightedAmount ?? 0),
    );
  }

  const defenseMap = new Map<string, CompetitiveDefenseRow>();
  const takeShareMap = new Map<string, CompetitiveTakeShareRow>();

  for (const eq of input.equipment) {
    const key = makeModelKey(eq.make, eq.model);
    if (!key || !eq.companyId) continue;
    const listings = listingByKey.get(key) ?? [];
    const staleForKey = listings.filter((listing) => {
      const firstSeen = parseTime(listing.firstSeenAt);
      return firstSeen != null && firstSeen <= nowTime - 21 * 86_400_000;
    });

    const mentions = mentionsByCompany.get(eq.companyId) ?? [];
    if (mentions.length > 0 || listings.length > 0) {
      const current = defenseMap.get(eq.companyId) ?? {
        companyId: eq.companyId,
        companyName: eq.companyName ?? "Account",
        weightedRevenue: weightedRevenueByCompany.get(eq.companyId) ?? 0,
        competitorMentionCount: 0,
        matchingListings: 0,
        staleListings: 0,
        reasons: [],
      };
      current.competitorMentionCount += mentions.length;
      current.matchingListings += listings.length;
      current.staleListings += staleForKey.length;
      if (mentions.length > 0) current.reasons.push(`${mentions.length} competitor mention${mentions.length === 1 ? "" : "s"}`);
      if (staleForKey.length > 0) current.reasons.push(`${staleForKey.length} stale competitor listing${staleForKey.length === 1 ? "" : "s"} on matching iron`);
      defenseMap.set(eq.companyId, current);
    }

    if (listings.length > 0) {
      const current = takeShareMap.get(key) ?? {
        make: eq.make ?? "Unknown",
        model: eq.model ?? "Unknown",
        listingCount: 0,
        staleListingCount: 0,
        avgAsk: null,
        matchingAccounts: 0,
        weightedRevenue: 0,
      };
      current.listingCount = listings.length;
      current.staleListingCount = staleForKey.length;
      current.matchingAccounts += 1;
      current.weightedRevenue += weightedRevenueByCompany.get(eq.companyId) ?? 0;
      const asks = listings.map((listing) => listing.askingPrice).filter((value): value is number => typeof value === "number");
      current.avgAsk = asks.length > 0 ? asks.reduce((sum, value) => sum + value, 0) / asks.length : null;
      takeShareMap.set(key, current);
    }
  }

  const defenseRows = [...defenseMap.values()].sort((a, b) => {
    if (b.competitorMentionCount !== a.competitorMentionCount) return b.competitorMentionCount - a.competitorMentionCount;
    return b.weightedRevenue - a.weightedRevenue;
  });

  const takeShareRows = [...takeShareMap.values()].sort((a, b) => {
    if (b.staleListingCount !== a.staleListingCount) return b.staleListingCount - a.staleListingCount;
    return b.weightedRevenue - a.weightedRevenue;
  });

  return {
    summary: {
      threatenedAccounts: defenseRows.length,
      takeShareWindows: takeShareRows.length,
      activeListings: input.listings.length,
      staleListings,
    },
    defenseRows,
    takeShareRows,
  };
}
