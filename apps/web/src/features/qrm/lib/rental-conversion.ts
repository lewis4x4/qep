import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";

export interface RentalConversionDeal {
  id: string;
  name: string;
  createdAt: string;
}

export interface RentalConversionRentalLink {
  dealId: string;
  equipmentId: string;
  make: string | null;
  model: string | null;
  year: number | null;
  name: string;
  dailyRentalRate: number | null;
  currentMarketValue: number | null;
}

export interface RentalConversionVoiceSignal {
  createdAt: string;
  extractedData: ExtractedDealData | null;
}

export interface RentalConversionCandidate {
  id: string;
  title: string;
  rentalDealCount: number;
  rentalFirstSignals: number;
  rentToOwnSignals: number;
  purchaseReadySignals: number;
  openQuoteCount: number;
  confidence: "high" | "medium" | "low";
  estimatedPurchaseValue: number | null;
  reasons: string[];
  equipmentIds: string[];
  /** Present when ranked from rental_conversion_board. */
  companyId?: string;
  rankScore?: number;
}

export interface RentalConversionBoard {
  summary: {
    candidates: number;
    repeatRentalCandidates: number;
    rentalIntentSignals: number;
    purchaseReadySignals: number;
    openQuotes: number;
  };
  candidates: RentalConversionCandidate[];
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function groupKey(link: RentalConversionRentalLink): string {
  return [
    normalize(link.make) ?? "unknown",
    normalize(link.model) ?? "unknown",
    link.year ?? "unknown",
  ].join(":");
}

function findGroupKeyByMakeModel(
  groups: Map<string, RentalConversionCandidate>,
  make: string | null | undefined,
  model: string | null | undefined,
): string | null {
  const normalizedMake = normalize(make) ?? "unknown";
  const normalizedModel = normalize(model) ?? "unknown";
  for (const key of groups.keys()) {
    const [groupMake, groupModel] = key.split(":");
    if (groupMake === normalizedMake && groupModel === normalizedModel) {
      return key;
    }
  }
  return null;
}

function titleForLink(link: RentalConversionRentalLink): string {
  const parts = [link.year, link.make, link.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : link.name;
}

function confidenceForCandidate(input: {
  rentalDealCount: number;
  rentalFirstSignals: number;
  rentToOwnSignals: number;
  purchaseReadySignals: number;
  openQuoteCount: number;
}): RentalConversionCandidate["confidence"] {
  if (
    input.rentalDealCount >= 2 &&
    (input.rentToOwnSignals > 0 || input.purchaseReadySignals > 0 || input.openQuoteCount > 0)
  ) {
    return "high";
  }
  if (input.rentalDealCount >= 2 || input.rentalFirstSignals > 0 || input.rentToOwnSignals > 0) {
    return "medium";
  }
  return "low";
}

export interface RentalTruthCandidate {
  companyId: string;
  companyName: string;
  contractCount: number;
  openContractCount: number;
  trailing90dBilledCents: number;
  rpoAccruedCents: number;
  activeRpoCount: number;
  maxRpoPurchasePriceCents: number | null;
  rankScore: number;
  confidence: "high" | "medium" | "low";
}

/** Rank companies from live rental/RPO truth (Wave 2 primary board). */
export function buildRentalTruthConversionBoard(
  rows: RentalTruthCandidate[],
): RentalConversionBoard {
  const candidates: RentalConversionCandidate[] = rows.map((row) => {
    const reasons: string[] = [];
    if (row.activeRpoCount > 0) {
      reasons.push(
        `${row.activeRpoCount} active RPO with ${formatRough(row.rpoAccruedCents)} accrued credit.`,
      );
    }
    if (row.contractCount > 0) {
      reasons.push(
        `${row.contractCount} rental contract${row.contractCount === 1 ? "" : "s"} (${row.openContractCount} open).`,
      );
    }
    if (row.trailing90dBilledCents > 0) {
      reasons.push(
        `${formatRough(row.trailing90dBilledCents)} billed in the trailing 90 days.`,
      );
    }
    return {
      id: row.companyId,
      title: row.companyName,
      rentalDealCount: row.contractCount,
      rentalFirstSignals: row.openContractCount,
      rentToOwnSignals: row.activeRpoCount,
      purchaseReadySignals:
        row.activeRpoCount > 0 &&
          row.maxRpoPurchasePriceCents != null &&
          row.rpoAccruedCents >= row.maxRpoPurchasePriceCents / 2
          ? 1
          : 0,
      openQuoteCount: 0,
      confidence: row.confidence,
      estimatedPurchaseValue:
        row.maxRpoPurchasePriceCents != null
          ? row.maxRpoPurchasePriceCents / 100
          : null,
      reasons,
      equipmentIds: [],
      companyId: row.companyId,
      rankScore: row.rankScore,
    };
  }).sort((a, b) => {
    if ((b.rankScore ?? 0) !== (a.rankScore ?? 0)) {
      return (b.rankScore ?? 0) - (a.rankScore ?? 0);
    }
    return b.rentalDealCount - a.rentalDealCount;
  });

  return {
    summary: {
      candidates: candidates.length,
      repeatRentalCandidates: candidates.filter((c) => c.rentalDealCount >= 2).length,
      rentalIntentSignals: candidates.reduce(
        (sum, c) => sum + c.rentalFirstSignals + c.rentToOwnSignals,
        0,
      ),
      purchaseReadySignals: candidates.reduce(
        (sum, c) => sum + c.purchaseReadySignals,
        0,
      ),
      openQuotes: 0,
    },
    candidates,
  };
}

function formatRough(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

export function buildRentalConversionBoard(input: {
  deals: RentalConversionDeal[];
  rentalLinks: RentalConversionRentalLink[];
  voiceSignals: RentalConversionVoiceSignal[];
  openQuoteCount: number;
  /** When present, rental-truth candidates are ranked first (Wave 2). */
  rentalTruthPrimary?: RentalTruthCandidate[];
}): RentalConversionBoard {
  if (input.rentalTruthPrimary && input.rentalTruthPrimary.length > 0) {
    return buildRentalTruthConversionBoard(input.rentalTruthPrimary);
  }

  const byGroup = new Map<string, RentalConversionCandidate>();

  for (const link of input.rentalLinks) {
    const key = groupKey(link);
    const existing = byGroup.get(key) ?? {
      id: key,
      title: titleForLink(link),
      rentalDealCount: 0,
      rentalFirstSignals: 0,
      rentToOwnSignals: 0,
      purchaseReadySignals: 0,
      openQuoteCount: input.openQuoteCount,
      confidence: "low",
      estimatedPurchaseValue: link.currentMarketValue,
      reasons: [],
      equipmentIds: [],
    };
    existing.rentalDealCount += 1;
    if (!existing.equipmentIds.includes(link.equipmentId)) existing.equipmentIds.push(link.equipmentId);
    if (existing.estimatedPurchaseValue == null && link.currentMarketValue != null) {
      existing.estimatedPurchaseValue = link.currentMarketValue;
    }
    byGroup.set(key, existing);
  }

  for (const signal of input.voiceSignals) {
    const data = signal.extractedData;
    const key =
      findGroupKeyByMakeModel(
        byGroup,
        data?.opportunity.equipmentMake,
        data?.opportunity.equipmentModel,
      ) ??
      [
        normalize(data?.opportunity.equipmentMake) ?? "unknown",
        normalize(data?.opportunity.equipmentModel) ?? "unknown",
        "unknown",
      ].join(":");
    const buyerPersona = normalize(data?.guidance.buyerPersona);
    const financing = normalize(data?.opportunity.financingInterest);
    const intent = normalize(data?.opportunity.intentLevel);
    const rentalOpportunity = data?.operations.rentalOpportunity === true;

    const existing = byGroup.get(key) ?? {
      id: key,
      title: [data?.opportunity.equipmentMake, data?.opportunity.equipmentModel].filter(Boolean).join(" ") || "Rental-first motion",
      rentalDealCount: 0,
      rentalFirstSignals: 0,
      rentToOwnSignals: 0,
      purchaseReadySignals: 0,
      openQuoteCount: input.openQuoteCount,
      confidence: "low",
      estimatedPurchaseValue: null,
      reasons: [],
      equipmentIds: [],
    };

    if (buyerPersona === "rental_first") {
      existing.rentalFirstSignals += 1;
    }
    if (rentalOpportunity) {
      existing.rentalFirstSignals += 1;
    }
    if (financing === "rent_to_own") {
      existing.rentToOwnSignals += 1;
    }
    if (intent === "quote_ready" || intent === "ready_to_buy") {
      existing.purchaseReadySignals += 1;
    }
    byGroup.set(key, existing);
  }

  const candidates = [...byGroup.values()]
    .map((candidate) => {
      const reasons: string[] = [];
      if (candidate.rentalDealCount > 0) {
        reasons.push(`${candidate.rentalDealCount} rental-linked deal${candidate.rentalDealCount === 1 ? "" : "s"} on this account.`);
      }
      if (candidate.rentalFirstSignals > 0) {
        reasons.push(`${candidate.rentalFirstSignals} rental-first signal${candidate.rentalFirstSignals === 1 ? "" : "s"} from field notes.`);
      }
      if (candidate.rentToOwnSignals > 0) {
        reasons.push(`${candidate.rentToOwnSignals} rent-to-own signal${candidate.rentToOwnSignals === 1 ? "" : "s"}.`);
      }
      if (candidate.purchaseReadySignals > 0) {
        reasons.push(`${candidate.purchaseReadySignals} purchase-ready signal${candidate.purchaseReadySignals === 1 ? "" : "s"}.`);
      }
      if (candidate.openQuoteCount > 0) {
        reasons.push(`${candidate.openQuoteCount} open quote${candidate.openQuoteCount === 1 ? "" : "s"} already on the account.`);
      }

      return {
        ...candidate,
        reasons,
        confidence: confidenceForCandidate(candidate),
      };
    })
    .filter((candidate) => candidate.rentalDealCount > 0 || candidate.rentalFirstSignals > 0 || candidate.rentToOwnSignals > 0)
    .sort((a, b) => {
      const confidenceWeight = { high: 3, medium: 2, low: 1 };
      if (confidenceWeight[b.confidence] !== confidenceWeight[a.confidence]) {
        return confidenceWeight[b.confidence] - confidenceWeight[a.confidence];
      }
      if (b.rentalDealCount !== a.rentalDealCount) return b.rentalDealCount - a.rentalDealCount;
      return b.purchaseReadySignals - a.purchaseReadySignals;
    });

  return {
    summary: {
      candidates: candidates.length,
      repeatRentalCandidates: candidates.filter((candidate) => candidate.rentalDealCount >= 2).length,
      rentalIntentSignals: candidates.reduce((sum, candidate) => sum + candidate.rentalFirstSignals + candidate.rentToOwnSignals, 0),
      purchaseReadySignals: candidates.reduce((sum, candidate) => sum + candidate.purchaseReadySignals, 0),
      openQuotes: input.openQuoteCount,
    },
    candidates,
  };
}
