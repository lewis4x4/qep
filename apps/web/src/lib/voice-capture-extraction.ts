import type {
  ExtractedDealData,
  ExtractedEvidenceSnippet,
  SignalConfidence,
} from "./database.types";

type LegacyExtractedDealData = {
  customer_name?: unknown;
  company_name?: unknown;
  machine_interest?: unknown;
  attachments_discussed?: unknown;
  deal_stage?: unknown;
  budget_range?: unknown;
  key_concerns?: unknown;
  action_items?: unknown;
  next_step?: unknown;
  follow_up_date?: unknown;
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0
  ).map((item) => item.trim());
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function toOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : null;
}

function emptyExtractedDealData(): ExtractedDealData {
  return {
    record: {
      contactName: null,
      contactRole: null,
      companyName: null,
      companyType: null,
      decisionMakerStatus: "unknown",
      preferredContactChannel: "unknown",
      locationContext: null,
      additionalStakeholders: [],
    },
    opportunity: {
      machineInterest: null,
      equipmentCategory: null,
      equipmentMake: null,
      equipmentModel: null,
      attachmentsDiscussed: [],
      applicationUseCase: null,
      dealStage: null,
      intentLevel: "unknown",
      urgencyLevel: "unknown",
      timelineToBuy: null,
      financingInterest: "unknown",
      newVsUsedPreference: "unknown",
      tradeInLikelihood: "unknown",
      budgetRange: null,
      budgetConfidence: "unknown",
      competitorsMentioned: [],
      keyConcerns: null,
      objections: [],
      quoteReadiness: "not_ready",
      nextStep: null,
      nextStepDeadline: null,
      actionItems: [],
      followUpDate: null,
    },
    operations: {
      branchRelevance: null,
      territorySignal: null,
      serviceOpportunity: false,
      partsOpportunity: false,
      rentalOpportunity: false,
      crossSellOpportunity: [],
      existingFleetContext: null,
      replacementTrigger: null,
      availabilitySensitivity: "unknown",
      uptimeSensitivity: "unknown",
      jobsiteConditions: [],
      operatorSkillLevel: "unknown",
    },
    guidance: {
      customerSentiment: "unknown",
      probabilitySignal: "unknown",
      stalledRisk: "unknown",
      buyerPersona: "unknown",
      managerAttentionFlag: false,
      recommendedNextAction: null,
      recommendedFollowUpMode: "unknown",
      summaryForRep: null,
      summaryForManager: null,
    },
    evidence: {
      snippets: [],
      confidence: {},
    },
  };
}

export function normalizeExtractedDealData(raw: unknown): ExtractedDealData {
  const base = emptyExtractedDealData();
  const source = asObject(raw);
  const hasNestedShape = "record" in source || "opportunity" in source || "operations" in source ||
    "guidance" in source || "evidence" in source;

  if (!hasNestedShape) {
    const legacy = source as LegacyExtractedDealData;
    base.record.contactName = toStringOrNull(legacy.customer_name);
    base.record.companyName = toStringOrNull(legacy.company_name);
    base.opportunity.machineInterest = toStringOrNull(legacy.machine_interest);
    base.opportunity.attachmentsDiscussed = toStringList(
      typeof legacy.attachments_discussed === "string"
        ? legacy.attachments_discussed.split(",")
        : legacy.attachments_discussed,
    );
    base.opportunity.dealStage = toOptionalEnum(
      legacy.deal_stage,
      [
        "initial_contact",
        "follow_up",
        "demo_scheduled",
        "quote_sent",
        "negotiation",
        "closed_won",
        "closed_lost",
      ] as const,
    );
    base.opportunity.budgetRange = toStringOrNull(legacy.budget_range);
    base.opportunity.keyConcerns = toStringOrNull(legacy.key_concerns);
    base.opportunity.actionItems = toStringList(legacy.action_items);
    base.opportunity.nextStep = toStringOrNull(legacy.next_step);
    base.opportunity.followUpDate = toStringOrNull(legacy.follow_up_date);
    return base;
  }

  const record = asObject(source.record);
  const opportunity = asObject(source.opportunity);
  const operations = asObject(source.operations);
  const guidance = asObject(source.guidance);
  const evidence = asObject(source.evidence);

  base.record = {
    contactName: toStringOrNull(record.contactName),
    contactRole: toStringOrNull(record.contactRole),
    companyName: toStringOrNull(record.companyName),
    companyType: toStringOrNull(record.companyType),
    decisionMakerStatus: toEnum(
      record.decisionMakerStatus,
      ["decision_maker", "influencer", "operator", "gatekeeper", "unknown"] as const,
      "unknown",
    ),
    preferredContactChannel: toEnum(
      record.preferredContactChannel,
      ["call", "text", "email", "in_person", "unknown"] as const,
      "unknown",
    ),
    locationContext: toStringOrNull(record.locationContext),
    additionalStakeholders: toStringList(record.additionalStakeholders),
  };

  base.opportunity = {
    machineInterest: toStringOrNull(opportunity.machineInterest),
    equipmentCategory: toStringOrNull(opportunity.equipmentCategory),
    equipmentMake: toStringOrNull(opportunity.equipmentMake),
    equipmentModel: toStringOrNull(opportunity.equipmentModel),
    attachmentsDiscussed: toStringList(opportunity.attachmentsDiscussed),
    applicationUseCase: toStringOrNull(opportunity.applicationUseCase),
    dealStage: toOptionalEnum(
      opportunity.dealStage,
      [
        "initial_contact",
        "follow_up",
        "demo_scheduled",
        "quote_sent",
        "negotiation",
        "closed_won",
        "closed_lost",
      ] as const,
    ),
    intentLevel: toEnum(
      opportunity.intentLevel,
      ["curious", "evaluating", "quote_ready", "demo_ready", "ready_to_buy", "unknown"] as const,
      "unknown",
    ),
    urgencyLevel: toEnum(
      opportunity.urgencyLevel,
      ["low", "medium", "high", "urgent", "unknown"] as const,
      "unknown",
    ),
    timelineToBuy: toStringOrNull(opportunity.timelineToBuy),
    financingInterest: toEnum(
      opportunity.financingInterest,
      ["cash", "finance", "lease", "rental", "rent_to_own", "unknown"] as const,
      "unknown",
    ),
    newVsUsedPreference: toEnum(
      opportunity.newVsUsedPreference,
      ["new", "used", "either", "unknown"] as const,
      "unknown",
    ),
    tradeInLikelihood: toEnum(
      opportunity.tradeInLikelihood,
      ["none", "possible", "likely", "confirmed", "unknown"] as const,
      "unknown",
    ),
    budgetRange: toStringOrNull(opportunity.budgetRange),
    budgetConfidence: toEnum(
      opportunity.budgetConfidence,
      ["firm", "soft", "vague", "unknown"] as const,
      "unknown",
    ),
    competitorsMentioned: toStringList(opportunity.competitorsMentioned),
    keyConcerns: toStringOrNull(opportunity.keyConcerns),
    objections: toStringList(opportunity.objections),
    quoteReadiness: toEnum(
      opportunity.quoteReadiness,
      ["not_ready", "partial", "ready"] as const,
      "not_ready",
    ),
    nextStep: toStringOrNull(opportunity.nextStep),
    nextStepDeadline: toStringOrNull(opportunity.nextStepDeadline),
    actionItems: toStringList(opportunity.actionItems),
    followUpDate: toStringOrNull(opportunity.followUpDate),
  };

  base.operations = {
    branchRelevance: toStringOrNull(operations.branchRelevance),
    territorySignal: toStringOrNull(operations.territorySignal),
    serviceOpportunity: toBoolean(operations.serviceOpportunity),
    partsOpportunity: toBoolean(operations.partsOpportunity),
    rentalOpportunity: toBoolean(operations.rentalOpportunity),
    crossSellOpportunity: toStringList(operations.crossSellOpportunity),
    existingFleetContext: toStringOrNull(operations.existingFleetContext),
    replacementTrigger: toStringOrNull(operations.replacementTrigger),
    availabilitySensitivity: toEnum(
      operations.availabilitySensitivity,
      ["must_have_now", "soon", "flexible", "unknown"] as const,
      "unknown",
    ),
    uptimeSensitivity: toEnum(
      operations.uptimeSensitivity,
      ["low", "medium", "high", "unknown"] as const,
      "unknown",
    ),
    jobsiteConditions: toStringList(operations.jobsiteConditions),
    operatorSkillLevel: toEnum(
      operations.operatorSkillLevel,
      ["new", "experienced", "mixed", "unknown"] as const,
      "unknown",
    ),
  };

  base.guidance = {
    customerSentiment: toEnum(
      guidance.customerSentiment,
      ["positive", "neutral", "cautious", "skeptical", "frustrated", "unknown"] as const,
      "unknown",
    ),
    probabilitySignal: toEnum(
      guidance.probabilitySignal,
      ["low", "medium", "high", "unknown"] as const,
      "unknown",
    ),
    stalledRisk: toEnum(
      guidance.stalledRisk,
      ["low", "medium", "high", "unknown"] as const,
      "unknown",
    ),
    buyerPersona: toEnum(
      guidance.buyerPersona,
      ["price_first", "uptime_first", "growth_owner", "spec_driven", "rental_first", "unknown"] as const,
      "unknown",
    ),
    managerAttentionFlag: toBoolean(guidance.managerAttentionFlag),
    recommendedNextAction: toStringOrNull(guidance.recommendedNextAction),
    recommendedFollowUpMode: toEnum(
      guidance.recommendedFollowUpMode,
      ["call", "text", "email", "visit", "quote", "demo", "unknown"] as const,
      "unknown",
    ),
    summaryForRep: toStringOrNull(guidance.summaryForRep),
    summaryForManager: toStringOrNull(guidance.summaryForManager),
  };

  base.evidence = {
    snippets: Array.isArray(evidence.snippets)
      ? evidence.snippets.flatMap((item) => {
        const snippet = asObject(item);
        const field = toStringOrNull(snippet.field);
        const quote = toStringOrNull(snippet.quote);
        if (!field || !quote) return [];
        const extractedSnippet: ExtractedEvidenceSnippet = {
          field,
          quote,
          confidence: toEnum(
            snippet.confidence,
            ["high", "medium", "low", "unknown"] as const,
            "unknown",
          ),
        };
        return [extractedSnippet];
      })
      : [],
    confidence: Object.fromEntries(
      Object.entries(asObject(evidence.confidence)).map(([key, value]) => [
        key,
        toEnum(value, ["high", "medium", "low", "unknown"] as const, "unknown"),
      ]),
    ) as Record<string, SignalConfidence>,
  };

  return base;
}

export function getExtractedContactLabel(extracted: ExtractedDealData): string | null {
  return extracted.record.contactName;
}

export function getExtractedCompanyLabel(extracted: ExtractedDealData): string | null {
  return extracted.record.companyName;
}

export function getExtractedMachineLabel(extracted: ExtractedDealData): string | null {
  if (extracted.opportunity.machineInterest) return extracted.opportunity.machineInterest;
  const explicitModel = [
    extracted.opportunity.equipmentMake,
    extracted.opportunity.equipmentModel,
  ].filter(Boolean).join(" ");
  if (explicitModel) return explicitModel;
  return extracted.opportunity.equipmentCategory;
}

export function getEvidenceSnippet(
  extracted: ExtractedDealData,
  field: string,
): ExtractedEvidenceSnippet | null {
  return extracted.evidence.snippets.find((snippet) => snippet.field === field) ?? null;
}
