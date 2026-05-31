export type EstimateAuthorizationStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "reauthorization_required";

export type EstimateApprovalKind =
  | "initial_estimate"
  | "scope_increase_reauthorization";

export type EstimateAuthorizationGateResult = {
  ok: boolean;
  code:
    | "estimate_authorization_not_required"
    | "estimate_authorization_approved"
    | "estimate_approval_required"
    | "estimate_reauthorization_required";
  reason: string;
  approvedAmount: number | null;
  thresholdAmount: number | null;
  scopeEstimateAmount: number | null;
  thresholdPct: number;
  status: EstimateAuthorizationStatus;
  scopeIncreasePct: number | null;
  documentedApproval: boolean;
};

export type ScopeIncreaseEvaluation = {
  requiresReauthorization: boolean;
  approvedAmount: number | null;
  proposedAmount: number | null;
  thresholdAmount: number | null;
  thresholdPct: number;
  scopeIncreasePct: number | null;
};

export const DEFAULT_REAUTHORIZATION_THRESHOLD_PCT = 10;

export function toPositiveMoney(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function normalizeThresholdPct(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_REAUTHORIZATION_THRESHOLD_PCT;
  }
  return parsed;
}

export function normalizeEstimateAuthorizationStatus(
  value: unknown,
): EstimateAuthorizationStatus {
  switch (value) {
    case "pending":
    case "approved":
    case "reauthorization_required":
    case "not_required":
      return value;
    default:
      return "pending";
  }
}

export function normalizeEstimateApprovalKind(
  value: unknown,
): EstimateApprovalKind | null {
  switch (value) {
    case "initial_estimate":
    case "scope_increase_reauthorization":
      return value;
    default:
      return null;
  }
}

export function evaluateScopeIncrease(input: {
  approvedAmount: unknown;
  proposedAmount: unknown;
  thresholdPct?: unknown;
}): ScopeIncreaseEvaluation {
  const approvedAmount = toPositiveMoney(input.approvedAmount);
  const proposedAmount = toPositiveMoney(input.proposedAmount);
  const thresholdPct = normalizeThresholdPct(input.thresholdPct);
  const thresholdAmount = approvedAmount == null
    ? null
    : Math.round(approvedAmount * (1 + thresholdPct / 100) * 100) / 100;
  const scopeIncreasePct = approvedAmount == null ||
      proposedAmount == null ||
      approvedAmount === 0
    ? null
    : Math.round(
      ((proposedAmount - approvedAmount) / approvedAmount) * 100 * 10000,
    ) /
      10000;

  return {
    requiresReauthorization: Boolean(
      approvedAmount != null &&
        proposedAmount != null &&
        thresholdAmount != null &&
        proposedAmount > thresholdAmount,
    ),
    approvedAmount,
    proposedAmount,
    thresholdAmount,
    thresholdPct,
    scopeIncreasePct,
  };
}

export function evaluateEstimateAuthorizationGate(input: {
  authorizationRequired: unknown;
  authorizationStatus: unknown;
  approvedAmount: unknown;
  approvedQuoteId?: unknown;
  approvedApprovalId?: unknown;
  thresholdPct?: unknown;
  scopeEstimateAmount?: unknown;
}): EstimateAuthorizationGateResult {
  const authorizationRequired = input.authorizationRequired === true;
  const status = normalizeEstimateAuthorizationStatus(
    input.authorizationStatus,
  );
  const thresholdPct = normalizeThresholdPct(input.thresholdPct);
  const approvedAmount = toPositiveMoney(input.approvedAmount);
  const documentedApproval = Boolean(
    input.approvedQuoteId != null &&
      input.approvedQuoteId !== "" &&
      input.approvedApprovalId != null &&
      input.approvedApprovalId !== "",
  );
  const scope = evaluateScopeIncrease({
    approvedAmount,
    proposedAmount: input.scopeEstimateAmount,
    thresholdPct,
  });

  if (!authorizationRequired || status === "not_required") {
    return {
      ok: true,
      code: "estimate_authorization_not_required",
      reason:
        "Estimate authorization is not required for this legacy service job.",
      approvedAmount,
      thresholdAmount: scope.thresholdAmount,
      scopeEstimateAmount: scope.proposedAmount,
      thresholdPct,
      status: "not_required",
      scopeIncreasePct: scope.scopeIncreasePct,
      documentedApproval,
    };
  }

  if (status !== "approved" || approvedAmount == null || !documentedApproval) {
    return {
      ok: false,
      code: status === "reauthorization_required"
        ? "estimate_reauthorization_required"
        : "estimate_approval_required",
      reason: status === "reauthorization_required"
        ? "Repair work is blocked because the current estimate exceeds the approved amount by more than the re-authorization threshold. Document customer re-authorization before proceeding."
        : "Repair work is blocked until a documented approved estimate is recorded for this service job.",
      approvedAmount,
      thresholdAmount: scope.thresholdAmount,
      scopeEstimateAmount: scope.proposedAmount,
      thresholdPct,
      status,
      scopeIncreasePct: scope.scopeIncreasePct,
      documentedApproval,
    };
  }

  if (scope.requiresReauthorization) {
    return {
      ok: false,
      code: "estimate_reauthorization_required",
      reason:
        "Repair work is blocked because the current estimate exceeds the approved amount by more than the re-authorization threshold. Document customer re-authorization before proceeding.",
      approvedAmount,
      thresholdAmount: scope.thresholdAmount,
      scopeEstimateAmount: scope.proposedAmount,
      thresholdPct,
      status,
      scopeIncreasePct: scope.scopeIncreasePct,
      documentedApproval,
    };
  }

  return {
    ok: true,
    code: "estimate_authorization_approved",
    reason: "A documented approved estimate is on file for this service job.",
    approvedAmount,
    thresholdAmount: scope.thresholdAmount,
    scopeEstimateAmount: scope.proposedAmount,
    thresholdPct,
    status,
    scopeIncreasePct: scope.scopeIncreasePct,
    documentedApproval,
  };
}
