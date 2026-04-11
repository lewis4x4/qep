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

export function buildRentalConversionBoard(input: {
  deals: RentalConversionDeal[];
  rentalLinks: RentalConversionRentalLink[];
  voiceSignals: RentalConversionVoiceSignal[];
  openQuoteCount: number;
}): RentalConversionBoard {
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
