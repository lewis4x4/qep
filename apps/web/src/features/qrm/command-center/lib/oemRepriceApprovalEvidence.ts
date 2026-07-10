export interface OemRepriceLineEvidence {
  impactLineId: string | null;
  quotePackageLineItemId: string | null;
  modelCode: string | null;
  oldPriceCents: number | null;
  newPriceCents: number | null;
  quantity: number;
  suppressedByStockLock: boolean;
}

export interface OemRepriceApprovalEvidence {
  approvalKind: "oem_reprice";
  changeCategories: string[];
  reasons: string[];
  currentNetTotalCents: number | null;
  projectedNetTotalCents: number | null;
  totalDeltaCents: number | null;
  oldMarginPct: number | null;
  projectedMarginPct: number | null;
  marginFloorPct: number | null;
  belowMarginFloor: boolean;
  oldCommissionCents: number | null;
  projectedCommissionCents: number | null;
  commissionDeltaCents: number | null;
  customerCommunication: "none";
  lines: OemRepriceLineEvidence[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const normalized = stringOrNull(entry);
    return normalized ? [normalized] : [];
  });
}

function normalizeLine(value: unknown): OemRepriceLineEvidence | null {
  if (!isRecord(value)) return null;
  return {
    impactLineId: stringOrNull(value.impactLineId ?? value.impact_line_id),
    quotePackageLineItemId: stringOrNull(
      value.quotePackageLineItemId ?? value.quote_package_line_item_id,
    ),
    modelCode: stringOrNull(value.modelCode ?? value.model_code),
    oldPriceCents: numberOrNull(value.oldPriceCents ?? value.old_price_cents),
    newPriceCents: numberOrNull(value.newPriceCents ?? value.new_price_cents),
    quantity: Math.max(1, numberOrNull(value.quantity) ?? 1),
    suppressedByStockLock:
      value.suppressedByStockLock === true || value.suppressed_by_stock_lock === true,
  };
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * Convert the persisted approval evidence into the one manager-facing shape.
 * Every field is parsed fail-closed; malformed optional evidence is omitted
 * instead of being rendered as an invented zero-dollar result.
 */
export function extractOemRepriceApprovalEvidence(
  policySnapshot: unknown,
  reasonSummary: unknown,
): OemRepriceApprovalEvidence | null {
  const policy = isRecord(policySnapshot) ? policySnapshot : {};
  const reason = isRecord(reasonSummary) ? reasonSummary : {};
  const approvalKind = stringOrNull(reason.approval_kind ?? policy.approval_kind);
  if (approvalKind !== "oem_reprice") return null;

  const oemPolicy = isRecord(policy.oem_reprice) ? policy.oem_reprice : {};
  const economics = isRecord(oemPolicy.economics) ? oemPolicy.economics : {};
  const rawLines = Array.isArray(reason.lines) ? reason.lines : [];
  const lines = rawLines.flatMap((line) => {
    const normalized = normalizeLine(line);
    return normalized ? [normalized] : [];
  });

  return {
    approvalKind: "oem_reprice",
    changeCategories: stringArray(reason.change_categories ?? oemPolicy.change_categories),
    reasons: stringArray(reason.reasons ?? reason.approval_required_reasons),
    currentNetTotalCents: firstNumber(
      reason.current_net_total_cents,
      economics.current_net_total_cents,
    ),
    projectedNetTotalCents: firstNumber(
      reason.projected_net_total_cents,
      economics.projected_net_total_cents,
    ),
    totalDeltaCents: firstNumber(reason.total_delta_cents, economics.total_delta_cents),
    oldMarginPct: firstNumber(reason.old_margin_pct, economics.old_margin_pct),
    projectedMarginPct: firstNumber(
      reason.projected_margin_pct,
      economics.projected_margin_pct,
    ),
    marginFloorPct: firstNumber(reason.margin_floor_pct, economics.margin_floor_pct),
    belowMarginFloor:
      reason.below_margin_floor === true || economics.below_margin_floor === true,
    oldCommissionCents: firstNumber(
      reason.old_commission_cents,
      economics.old_commission_cents,
    ),
    projectedCommissionCents: firstNumber(
      reason.projected_commission_cents,
      economics.projected_commission_cents,
    ),
    commissionDeltaCents: firstNumber(
      reason.commission_delta_cents,
      economics.commission_delta_cents,
    ),
    customerCommunication: "none",
    lines,
  };
}

export function isOemRepriceDecisionNoteRequired(
  evidence: OemRepriceApprovalEvidence | null,
  decision: string,
): boolean {
  return evidence?.belowMarginFloor === true && decision === "approved";
}
