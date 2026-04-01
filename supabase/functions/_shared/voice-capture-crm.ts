import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type VoiceCaptureDealStage =
  | "initial_contact"
  | "follow_up"
  | "demo_scheduled"
  | "quote_sent"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

export type SignalConfidence = "high" | "medium" | "low" | "unknown";
export type DecisionMakerStatus =
  | "decision_maker"
  | "influencer"
  | "operator"
  | "gatekeeper"
  | "unknown";
export type PreferredContactChannel =
  | "call"
  | "text"
  | "email"
  | "in_person"
  | "unknown";
export type IntentLevel =
  | "curious"
  | "evaluating"
  | "quote_ready"
  | "demo_ready"
  | "ready_to_buy"
  | "unknown";
export type UrgencyLevel = "low" | "medium" | "high" | "urgent" | "unknown";
export type FinancingInterest =
  | "cash"
  | "finance"
  | "lease"
  | "rental"
  | "rent_to_own"
  | "unknown";
export type ConditionPreference = "new" | "used" | "either" | "unknown";
export type TradeInLikelihood =
  | "none"
  | "possible"
  | "likely"
  | "confirmed"
  | "unknown";
export type BudgetConfidence = "firm" | "soft" | "vague" | "unknown";
export type QuoteReadiness = "not_ready" | "partial" | "ready";
export type AvailabilitySensitivity =
  | "must_have_now"
  | "soon"
  | "flexible"
  | "unknown";
export type OperatorSkillLevel = "new" | "experienced" | "mixed" | "unknown";
export type Sentiment =
  | "positive"
  | "neutral"
  | "cautious"
  | "skeptical"
  | "frustrated"
  | "unknown";
export type ProbabilitySignal = "low" | "medium" | "high" | "unknown";
export type BuyerPersona =
  | "price_first"
  | "uptime_first"
  | "growth_owner"
  | "spec_driven"
  | "rental_first"
  | "unknown";
export type FollowUpMode =
  | "call"
  | "text"
  | "email"
  | "visit"
  | "quote"
  | "demo"
  | "unknown";

export interface VoiceCaptureEvidenceSnippet {
  field: string;
  quote: string;
  confidence?: SignalConfidence | null;
}

export interface VoiceCaptureExtractedDealData {
  record: {
    contactName: string | null;
    contactRole: string | null;
    companyName: string | null;
    companyType: string | null;
    decisionMakerStatus: DecisionMakerStatus;
    preferredContactChannel: PreferredContactChannel;
    locationContext: string | null;
    additionalStakeholders: string[];
  };
  opportunity: {
    machineInterest: string | null;
    equipmentCategory: string | null;
    equipmentMake: string | null;
    equipmentModel: string | null;
    attachmentsDiscussed: string[];
    applicationUseCase: string | null;
    dealStage: VoiceCaptureDealStage | null;
    intentLevel: IntentLevel;
    urgencyLevel: UrgencyLevel;
    timelineToBuy: string | null;
    financingInterest: FinancingInterest;
    newVsUsedPreference: ConditionPreference;
    tradeInLikelihood: TradeInLikelihood;
    budgetRange: string | null;
    budgetConfidence: BudgetConfidence;
    competitorsMentioned: string[];
    keyConcerns: string | null;
    objections: string[];
    quoteReadiness: QuoteReadiness;
    nextStep: string | null;
    nextStepDeadline: string | null;
    actionItems: string[];
    followUpDate: string | null;
  };
  operations: {
    branchRelevance: string | null;
    territorySignal: string | null;
    serviceOpportunity: boolean;
    partsOpportunity: boolean;
    rentalOpportunity: boolean;
    crossSellOpportunity: string[];
    existingFleetContext: string | null;
    replacementTrigger: string | null;
    availabilitySensitivity: AvailabilitySensitivity;
    uptimeSensitivity: ProbabilitySignal;
    jobsiteConditions: string[];
    operatorSkillLevel: OperatorSkillLevel;
  };
  guidance: {
    customerSentiment: Sentiment;
    probabilitySignal: ProbabilitySignal;
    stalledRisk: ProbabilitySignal;
    buyerPersona: BuyerPersona;
    managerAttentionFlag: boolean;
    recommendedNextAction: string | null;
    recommendedFollowUpMode: FollowUpMode;
    summaryForRep: string | null;
    summaryForManager: string | null;
  };
  evidence: {
    snippets: VoiceCaptureEvidenceSnippet[];
    confidence: Record<string, SignalConfidence>;
  };
}

interface LegacyVoiceCaptureExtractedDealData {
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
}

export interface LocalVoiceCaptureCrmSyncResult {
  saved: boolean;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  noteActivityId: string | null;
  taskActivityId: string | null;
}

interface LocalCrmTarget {
  dealId: string;
  contactId: string | null;
  companyId: string | null;
}

interface InsertErrorLike {
  code?: string;
}

const VALID_DEAL_STAGES = [
  "initial_contact",
  "follow_up",
  "demo_scheduled",
  "quote_sent",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
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
    ? value as T
    : fallback;
}

function toOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : null;
}

function createEmptyExtractedDealData(): VoiceCaptureExtractedDealData {
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

function normalizeEvidence(raw: unknown): VoiceCaptureExtractedDealData["evidence"] {
  const source = asObject(raw);
  const snippets = Array.isArray(source.snippets)
    ? source.snippets.flatMap((item) => {
      const snippet = asObject(item);
      const field = toStringOrNull(snippet.field);
      const quote = toStringOrNull(snippet.quote);
      if (!field || !quote) return [];
      return [{
        field,
        quote,
        confidence: toEnum(
          snippet.confidence,
          ["high", "medium", "low", "unknown"] as const,
          "unknown",
        ),
      }];
    })
    : [];

  const confidenceSource = asObject(source.confidence);
  const confidence: Record<string, SignalConfidence> = {};
  for (const [key, value] of Object.entries(confidenceSource)) {
    confidence[key] = toEnum(
      value,
      ["high", "medium", "low", "unknown"] as const,
      "unknown",
    );
  }

  return { snippets, confidence };
}

export function normalizeVoiceCaptureExtractedDealData(
  raw: unknown,
): VoiceCaptureExtractedDealData {
  const base = createEmptyExtractedDealData();
  const source = asObject(raw);

  const hasNestedShape = "record" in source || "opportunity" in source || "operations" in source ||
    "guidance" in source || "evidence" in source;

  if (!hasNestedShape) {
    const legacy = source as LegacyVoiceCaptureExtractedDealData;
    base.record.contactName = toStringOrNull(legacy.customer_name);
    base.record.companyName = toStringOrNull(legacy.company_name);
    base.opportunity.machineInterest = toStringOrNull(legacy.machine_interest);
    base.opportunity.attachmentsDiscussed = toStringList(
      typeof legacy.attachments_discussed === "string"
        ? legacy.attachments_discussed.split(",")
        : legacy.attachments_discussed,
    );
    base.opportunity.dealStage = toOptionalEnum(legacy.deal_stage, VALID_DEAL_STAGES);
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
    dealStage: toOptionalEnum(opportunity.dealStage, VALID_DEAL_STAGES),
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

  base.evidence = normalizeEvidence(source.evidence);
  return base;
}

export function getVoiceCaptureContactName(extracted: VoiceCaptureExtractedDealData): string | null {
  return extracted.record.contactName;
}

export function getVoiceCaptureCompanyName(extracted: VoiceCaptureExtractedDealData): string | null {
  return extracted.record.companyName;
}

export function getVoiceCaptureMachineLabel(
  extracted: VoiceCaptureExtractedDealData,
): string | null {
  if (extracted.opportunity.machineInterest) {
    return extracted.opportunity.machineInterest;
  }

  const explicitModel = [
    extracted.opportunity.equipmentMake,
    extracted.opportunity.equipmentModel,
  ].filter(Boolean).join(" ");
  if (explicitModel) {
    return explicitModel;
  }

  return extracted.opportunity.equipmentCategory;
}

export function getVoiceCapturePrimaryActionItems(
  extracted: VoiceCaptureExtractedDealData,
): string[] {
  return extracted.opportunity.actionItems;
}

export function buildVoiceCaptureNoteBody(
  transcript: string,
  extracted: VoiceCaptureExtractedDealData,
): string {
  const lines: string[] = [];
  const contactLine = [getVoiceCaptureContactName(extracted), getVoiceCaptureCompanyName(extracted)]
    .filter(Boolean)
    .join(" · ");

  if (contactLine) lines.push(contactLine);
  if (extracted.record.contactRole) lines.push(`Role: ${extracted.record.contactRole}`);

  const equipment = getVoiceCaptureMachineLabel(extracted);
  if (equipment) lines.push(`Equipment: ${equipment}`);
  if (extracted.opportunity.applicationUseCase) {
    lines.push(`Use case: ${extracted.opportunity.applicationUseCase}`);
  }
  if (extracted.opportunity.dealStage) {
    lines.push(`Stage: ${extracted.opportunity.dealStage}`);
  }
  if (extracted.opportunity.urgencyLevel !== "unknown") {
    lines.push(`Urgency: ${extracted.opportunity.urgencyLevel}`);
  }
  if (extracted.opportunity.financingInterest !== "unknown") {
    lines.push(`Financing: ${extracted.opportunity.financingInterest}`);
  }
  if (
    extracted.opportunity.tradeInLikelihood !== "unknown" &&
    extracted.opportunity.tradeInLikelihood !== "none"
  ) {
    lines.push(`Trade-in: ${extracted.opportunity.tradeInLikelihood}`);
  }
  if (extracted.opportunity.nextStep) {
    lines.push(`Next step: ${extracted.opportunity.nextStep}`);
  }
  if (extracted.opportunity.keyConcerns) {
    lines.push(`Concerns: ${extracted.opportunity.keyConcerns}`);
  }
  if (extracted.guidance.recommendedNextAction) {
    lines.push(`AI recommendation: ${extracted.guidance.recommendedNextAction}`);
  }
  if (extracted.opportunity.actionItems.length > 0) {
    lines.push(`Action items: ${extracted.opportunity.actionItems.join(" | ")}`);
  }

  lines.push("", transcript);
  return lines.join("\n").trim();
}

function buildCrmSummary(extracted: VoiceCaptureExtractedDealData) {
  return {
    contactName: extracted.record.contactName,
    companyName: extracted.record.companyName,
    machineInterest: getVoiceCaptureMachineLabel(extracted),
    applicationUseCase: extracted.opportunity.applicationUseCase,
    equipmentMake: extracted.opportunity.equipmentMake,
    equipmentModel: extracted.opportunity.equipmentModel,
    dealStage: extracted.opportunity.dealStage,
    urgencyLevel: extracted.opportunity.urgencyLevel,
    financingInterest: extracted.opportunity.financingInterest,
    tradeInLikelihood: extracted.opportunity.tradeInLikelihood,
    nextStep: extracted.opportunity.nextStep,
    followUpDate: extracted.opportunity.followUpDate,
    keyConcerns: extracted.opportunity.keyConcerns,
    competitorsMentioned: extracted.opportunity.competitorsMentioned,
    recommendedNextAction: extracted.guidance.recommendedNextAction,
    managerAttentionFlag: extracted.guidance.managerAttentionFlag,
  };
}

function getDueAt(followUpDate: string | null): string {
  if (followUpDate) {
    const dueAt = new Date(followUpDate);
    if (!Number.isNaN(dueAt.getTime())) {
      return dueAt.toISOString();
    }
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as InsertErrorLike).code === "23505";
}

async function findExistingVoiceCaptureActivityId(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  dealId: string,
  activityType: "note" | "task",
  captureId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("crm_activities")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("deal_id", dealId)
    .eq("activity_type", activityType)
    .is("deleted_at", null)
    .contains("metadata", {
      source: "voice_capture",
      voiceCaptureId: captureId,
      activityKind: activityType,
    })
    .maybeSingle();

  return data?.id ?? null;
}

async function resolveLocalTarget(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  dealId: string | null,
): Promise<LocalCrmTarget | null> {
  if (!dealId) return null;

  const { data, error } = await supabaseAdmin
    .from("crm_deals")
    .select("id, primary_contact_id, company_id")
    .eq("workspace_id", workspaceId)
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  return {
    dealId: data.id,
    contactId: data.primary_contact_id,
    companyId: data.company_id,
  };
}

async function ensureNoteActivity(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  actorUserId: string,
  captureId: string,
  occurredAtIso: string,
  target: LocalCrmTarget,
  transcript: string,
  extracted: VoiceCaptureExtractedDealData,
): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from("crm_activities")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("deal_id", target.dealId)
    .eq("activity_type", "note")
    .is("deleted_at", null)
    .contains("metadata", {
      source: "voice_capture",
      voiceCaptureId: captureId,
      activityKind: "note",
    })
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data, error } = await supabaseAdmin
    .from("crm_activities")
    .insert({
      workspace_id: workspaceId,
      activity_type: "note",
      body: buildVoiceCaptureNoteBody(transcript, extracted),
      occurred_at: occurredAtIso,
      // Exactly one of contact_id / deal_id / company_id (see crm_activities check constraint).
      deal_id: target.dealId,
      contact_id: null,
      company_id: null,
      created_by: actorUserId,
      metadata: {
        source: "voice_capture",
        voiceCaptureId: captureId,
        activityKind: "note",
        transcript,
        extractedSummary: buildCrmSummary(extracted),
        resolvedContactId: target.contactId,
        resolvedCompanyId: target.companyId,
      },
    })
    .select("id")
    .single();

  if (error) {
    if (isDuplicateKeyError(error)) {
      return await findExistingVoiceCaptureActivityId(
        supabaseAdmin,
        workspaceId,
        target.dealId,
        "note",
        captureId,
      );
    }
    throw error;
  }
  return data.id;
}

async function ensureTaskActivity(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  actorUserId: string,
  captureId: string,
  occurredAtIso: string,
  target: LocalCrmTarget,
  extracted: VoiceCaptureExtractedDealData,
): Promise<string | null> {
  if (!extracted.opportunity.nextStep && extracted.opportunity.actionItems.length === 0) {
    return null;
  }

  const { data: existing } = await supabaseAdmin
    .from("crm_activities")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("deal_id", target.dealId)
    .eq("activity_type", "task")
    .is("deleted_at", null)
    .contains("metadata", {
      source: "voice_capture",
      voiceCaptureId: captureId,
      activityKind: "task",
    })
    .maybeSingle();

  if (existing?.id) return existing.id;

  const taskBody = extracted.opportunity.nextStep
    ? `Field note follow-up: ${extracted.opportunity.nextStep}`
    : extracted.opportunity.actionItems[0] ?? "Review field note and follow up.";

  const { data, error } = await supabaseAdmin
    .from("crm_activities")
    .insert({
      workspace_id: workspaceId,
      activity_type: "task",
      body: taskBody,
      occurred_at: occurredAtIso,
      deal_id: target.dealId,
      contact_id: null,
      company_id: null,
      created_by: actorUserId,
      metadata: {
        source: "voice_capture",
        voiceCaptureId: captureId,
        activityKind: "task",
        task: {
          dueAt: getDueAt(extracted.opportunity.followUpDate),
          status: "open",
        },
        actionItems: extracted.opportunity.actionItems,
        extractedSummary: buildCrmSummary(extracted),
        resolvedContactId: target.contactId,
        resolvedCompanyId: target.companyId,
      },
    })
    .select("id")
    .single();

  if (error) {
    if (isDuplicateKeyError(error)) {
      return await findExistingVoiceCaptureActivityId(
        supabaseAdmin,
        workspaceId,
        target.dealId,
        "task",
        captureId,
      );
    }
    throw error;
  }
  return data.id;
}

export async function writeVoiceCaptureToLocalCrm(
  supabaseAdmin: SupabaseClient,
  input: {
    workspaceId: string;
    actorUserId: string;
    captureId: string;
    dealId: string | null;
    occurredAtIso: string;
    transcript: string;
    extracted: VoiceCaptureExtractedDealData;
  },
): Promise<LocalVoiceCaptureCrmSyncResult> {
  const target = await resolveLocalTarget(
    supabaseAdmin,
    input.workspaceId,
    input.dealId,
  );

  if (!target) {
    return {
      saved: false,
      dealId: input.dealId,
      contactId: null,
      companyId: null,
      noteActivityId: null,
      taskActivityId: null,
    };
  }

  const [noteActivityId, taskActivityId] = await Promise.all([
    ensureNoteActivity(
      supabaseAdmin,
      input.workspaceId,
      input.actorUserId,
      input.captureId,
      input.occurredAtIso,
      target,
      input.transcript,
      input.extracted,
    ),
    ensureTaskActivity(
      supabaseAdmin,
      input.workspaceId,
      input.actorUserId,
      input.captureId,
      input.occurredAtIso,
      target,
      input.extracted,
    ),
  ]);

  return {
    saved: true,
    dealId: target.dealId,
    contactId: target.contactId,
    companyId: target.companyId,
    noteActivityId,
    taskActivityId,
  };
}
