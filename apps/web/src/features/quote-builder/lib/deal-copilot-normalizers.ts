import type {
  CopilotExtractedSignals,
  CopilotInputSource,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import type {
  WinProbabilityFactor,
  WinProbabilityLift,
  WinProbabilityLiftId,
} from "./win-probability-scorer";

export type TurnStatus = "pending" | "streaming" | "complete" | "error";

export interface CopilotTurnViewModel {
  key: string;
  status: TurnStatus;
  turnIndex: number | null;
  inputSource: CopilotInputSource;
  rawInput: string;
  extractedSignals: CopilotExtractedSignals;
  copilotReply: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export type DealCopilotSseEvent =
  | { type: "status"; message: string }
  | { type: "extracted"; signals: CopilotExtractedSignals; confidence: Record<string, number> }
  | {
      type: "draftPatch";
      patch: Partial<QuoteWorkspaceDraft>;
      changedPaths: string[];
    }
  | {
      type: "score";
      before: number | null;
      after: number;
      factors: WinProbabilityFactor[];
      lifts: WinProbabilityLift[];
    }
  | { type: "reply"; text: string }
  | { type: "complete"; turnId: string | null; turnIndex: number | null; latencyMs: number }
  | { type: "error"; message: string; fatal: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = asString(item).trim();
        return text ? [text] : [];
      })
    : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeInputSource(value: unknown): CopilotInputSource {
  return value === "voice"
    || value === "photo_caption"
    || value === "email_paste"
    || value === "system"
    ? value
    : "text";
}

function normalizeTimelinePressure(
  value: unknown,
): NonNullable<CopilotExtractedSignals["customerSignals"]>["timelinePressure"] | undefined {
  return value === "immediate" || value === "weeks" || value === "months" || value === null
    ? value
    : undefined;
}

function normalizeFinancingPref(value: unknown): CopilotExtractedSignals["financingPref"] | undefined {
  return value === "cash" || value === "financing" || value === "open" || value === null
    ? value
    : undefined;
}

function normalizeCustomerWarmth(value: unknown): CopilotExtractedSignals["customerWarmth"] | undefined {
  return value === "warm" || value === "cool" || value === "dormant" || value === "new" || value === null
    ? value
    : undefined;
}

export function normalizeCopilotSignals(value: unknown): CopilotExtractedSignals {
  const record = isRecord(value) ? value : {};
  const customerSignalsRecord = isRecord(record.customerSignals ?? record.customer_signals)
    ? (record.customerSignals ?? record.customer_signals)
    : null;
  const customerSignals: CopilotExtractedSignals["customerSignals"] = {};
  if (isRecord(customerSignalsRecord)) {
    const objections = asStringArray(customerSignalsRecord.objections);
    if (objections.length > 0) customerSignals.objections = objections;
    const timelinePressure = normalizeTimelinePressure(
      customerSignalsRecord.timelinePressure ?? customerSignalsRecord.timeline_pressure,
    );
    if (timelinePressure !== undefined) customerSignals.timelinePressure = timelinePressure;
    const competitorMentions = asStringArray(
      customerSignalsRecord.competitorMentions ?? customerSignalsRecord.competitor_mentions,
    );
    if (competitorMentions.length > 0) customerSignals.competitorMentions = competitorMentions;
  }
  const financingPref = normalizeFinancingPref(record.financingPref ?? record.financing_pref);
  const customerWarmth = normalizeCustomerWarmth(record.customerWarmth ?? record.customer_warmth);
  const notes = asStringArray(record.notes);
  return {
    ...(Object.keys(customerSignals).length > 0 ? { customerSignals } : {}),
    ...(financingPref !== undefined ? { financingPref } : {}),
    ...(customerWarmth !== undefined ? { customerWarmth } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function normalizeConfidence(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const confidence = asNumber(raw);
    if (confidence != null) out[key] = confidence;
  }
  return out;
}

function normalizeFactorKind(value: unknown): WinProbabilityFactor["kind"] {
  return value === "engagement" || value === "commercial" || value === "fit"
    ? value
    : "relationship";
}

function normalizeFactors(value: unknown): WinProbabilityFactor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = asString(item.label);
    const weight = asNumber(item.weight);
    if (!label || weight == null) return [];
    return [{
      label,
      weight,
      rationale: asString(item.rationale),
      kind: normalizeFactorKind(item.kind),
    }];
  });
}

function normalizeLiftId(value: unknown): WinProbabilityLiftId {
  return value === "select_equipment"
    || value === "ai_recommendation"
    || value === "reconnect_customer"
    || value === "raise_margin"
    || value === "address_objection"
    || value === "lock_financing_pref"
    || value === "counter_competitor"
    ? value
    : "capture_trade";
}

function normalizeLifts(value: unknown): WinProbabilityLift[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = asString(item.label);
    const deltaPts = asNumber(item.deltaPts ?? item.delta_pts);
    if (!label || deltaPts == null) return [];
    return [{
      id: normalizeLiftId(item.id),
      label,
      deltaPts,
      rationale: asString(item.rationale),
      actionHint: asString(item.actionHint ?? item.action_hint),
    }];
  });
}

export function normalizeCopilotDraftPatch(value: unknown): Partial<QuoteWorkspaceDraft> {
  if (!isRecord(value)) return {};
  const patch: Partial<QuoteWorkspaceDraft> = {};
  const signals = normalizeCopilotSignals(value.customerSignals ? { customerSignals: value.customerSignals } : {});
  if (signals.customerSignals) {
    patch.customerSignals = {
      openDeals: 0,
      openDealValueCents: 0,
      lastContactDaysAgo: null,
      pastQuoteCount: 0,
      pastQuoteValueCents: 0,
      ...signals.customerSignals,
    };
  }
  const financingPref = normalizeFinancingPref(value.financingPref);
  if (financingPref !== undefined) patch.financingPref = financingPref;
  const customerWarmth = normalizeCustomerWarmth(value.customerWarmth);
  if (customerWarmth !== undefined) patch.customerWarmth = customerWarmth;
  return patch;
}

export function normalizeCopilotTurnRow(value: unknown): CopilotTurnViewModel | null {
  if (!isRecord(value)) return null;
  const key = asString(value.id);
  const rawInput = asString(value.raw_input ?? value.rawInput);
  if (!key && !rawInput) return null;
  return {
    key: key || `persisted-${asString(value.turn_index ?? value.turnIndex) || "unknown"}`,
    status: "complete",
    turnIndex: asNumber(value.turn_index ?? value.turnIndex),
    inputSource: normalizeInputSource(value.input_source ?? value.inputSource),
    rawInput,
    extractedSignals: normalizeCopilotSignals(value.extracted_signals ?? value.extractedSignals),
    copilotReply: asNullableString(value.copilot_reply ?? value.copilotReply),
    scoreBefore: asNumber(value.score_before ?? value.scoreBefore),
    scoreAfter: asNumber(value.score_after ?? value.scoreAfter),
    errorMessage: null,
    createdAt: asString(value.created_at ?? value.createdAt) || new Date().toISOString(),
  };
}

export function normalizeCopilotTurnRows(value: unknown): CopilotTurnViewModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const normalized = normalizeCopilotTurnRow(row);
    return normalized ? [normalized] : [];
  });
}

export function normalizeDealCopilotSseEvent(value: unknown): DealCopilotSseEvent | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "status":
      return { type: "status", message: asString(value.message) };
    case "extracted":
      return {
        type: "extracted",
        signals: normalizeCopilotSignals(value.signals),
        confidence: normalizeConfidence(value.confidence),
      };
    case "draftPatch":
      return {
        type: "draftPatch",
        patch: normalizeCopilotDraftPatch(value.patch),
        changedPaths: asStringArray(value.changedPaths ?? value.changed_paths),
      };
    case "score": {
      const after = asNumber(value.after);
      if (after == null) return null;
      return {
        type: "score",
        before: asNumber(value.before),
        after,
        factors: normalizeFactors(value.factors),
        lifts: normalizeLifts(value.lifts),
      };
    }
    case "reply":
      return { type: "reply", text: asString(value.text) };
    case "complete":
      return {
        type: "complete",
        turnId: asNullableString(value.turnId ?? value.turn_id),
        turnIndex: asNumber(value.turnIndex ?? value.turn_index),
        latencyMs: asNumber(value.latencyMs ?? value.latency_ms) ?? 0,
      };
    case "error":
      return { type: "error", message: asString(value.message), fatal: value.fatal === true };
    default:
      return null;
  }
}

export function parseDealCopilotSseEvent(json: string): DealCopilotSseEvent | null {
  try {
    return normalizeDealCopilotSseEvent(JSON.parse(json));
  } catch {
    return null;
  }
}

export function isAbortError(value: unknown): boolean {
  return isRecord(value) && value.name === "AbortError";
}
