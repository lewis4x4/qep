export const MATERIALITY_LINE_PCT_GT = 2;
export const MATERIALITY_QUOTE_DELTA_CENTS_GT = 100_000;
export const COMMISSION_RATE_OF_GROSS_MARGIN = 0.15;

export type MaterialityTrigger = "line_pct" | "quote_delta" | "both" | "quiet";

export interface MaterialityInput {
  maxAbsLineDeltaPct: number | null | undefined;
  totalDeltaCents: number | null | undefined;
  linePctGt?: number;
  quoteDeltaCentsGt?: number;
}

export function classifyMateriality(
  input: MaterialityInput,
): MaterialityTrigger {
  const lineThreshold = input.linePctGt ?? MATERIALITY_LINE_PCT_GT;
  const quoteThreshold = input.quoteDeltaCentsGt ??
    MATERIALITY_QUOTE_DELTA_CENTS_GT;
  const lineHit =
    Math.abs(Number(input.maxAbsLineDeltaPct ?? 0)) > lineThreshold;
  const quoteHit =
    Math.abs(Number(input.totalDeltaCents ?? 0)) > quoteThreshold;
  if (lineHit && quoteHit) return "both";
  if (lineHit) return "line_pct";
  if (quoteHit) return "quote_delta";
  return "quiet";
}

export function normalizeModelCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return normalized.length ? normalized : null;
}

export function deltaPct(
  oldCents: number | null | undefined,
  newCents: number | null | undefined,
): number | null {
  const oldValue = Number(oldCents ?? 0);
  const newValue = Number(newCents ?? 0);
  if (
    !Number.isFinite(oldValue) || !Number.isFinite(newValue) || oldValue === 0
  ) return null;
  return Number((((newValue - oldValue) / oldValue) * 100).toFixed(2));
}

export function dollarsToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number"
    ? value
    : Number(String(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

export function centsValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number"
    ? value
    : Number(String(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

/**
 * Extract the large/small freight amounts (cents) from a freight payload —
 * either a price-sheet freight item's `extracted` or a qb_freight_zones row.
 * Both store `freight_large_cents` / `freight_small_cents` as integer cents.
 */
export function freightValuesFromExtracted(
  value: unknown,
): { largeCents: number | null; smallCents: number | null } {
  const obj = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    largeCents: centsValue(obj.freight_large_cents),
    smallCents: centsValue(obj.freight_small_cents),
  };
}

export function isStockLockedLine(
  input: { sourceLocation?: unknown; isYardStock?: unknown },
): boolean {
  return input.sourceLocation === "yard_stock" || input.isYardStock === true;
}

export function normalizePercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number"
    ? value
    : Number(String(value).replace(/%/g, ""));
  if (!Number.isFinite(num)) return null;
  return Math.abs(num) <= 1
    ? Number((num * 100).toFixed(2))
    : Number(num.toFixed(2));
}

/**
 * Parse a percent that is ALREADY stored as a whole-number percent — e.g.
 * qb_margin_thresholds.min_margin_pct and quote_packages.margin_pct, both
 * numeric in [0,100] where 25.00 = 25%. Unlike normalizePercent(), this does
 * NOT apply the "<=1 means a fraction" heuristic, so a legitimate sub-1% value
 * (1.00 = 1%, 0.5 = 0.5%) is preserved instead of being scaled to 100% / 50%.
 */
export function parseStoredPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number"
    ? value
    : Number(String(value).replace(/%/g, ""));
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(2));
}

export interface MarginGateInput {
  oldNetTotalCents: number | null | undefined;
  totalDeltaCents: number;
  oldMarginPct?: number | null;
  oldMarginCents?: number | null;
  costBasisCents?: number | null;
  marginFloorPct?: number | null;
  policyRequiresManagerReview?: boolean;
  stockLocked?: boolean;
}

export interface MarginGateResult {
  oldMarginPct: number | null;
  projectedMarginPct: number | null;
  marginFloorPct: number | null;
  belowMarginFloor: boolean;
  oldCommissionCents: number | null;
  projectedCommissionCents: number | null;
  commissionDeltaCents: number | null;
  approvalRequiredReasons: string[];
  requiresManagerReview: boolean;
}

const roundPct = (value: number): number => Number(value.toFixed(2));
const roundCents = (value: number): number => Math.round(value);

export function evaluateMarginGate(input: MarginGateInput): MarginGateResult {
  const reasons: string[] = [];
  if (input.policyRequiresManagerReview) reasons.push("manager_review_policy");
  if (input.stockLocked) reasons.push("stock_lock");

  const oldNet = Number(input.oldNetTotalCents ?? 0);
  const projectedNet = oldNet + Number(input.totalDeltaCents ?? 0);
  const floor = parseStoredPercent(input.marginFloorPct);
  let oldMarginPct = parseStoredPercent(input.oldMarginPct);
  let oldMarginCents = input.oldMarginCents ?? null;
  let costBasis = input.costBasisCents ?? null;

  if (oldMarginCents === null && oldMarginPct !== null && oldNet > 0) {
    oldMarginCents = roundCents(oldNet * (oldMarginPct / 100));
  }
  if (costBasis === null && oldMarginCents !== null) {
    costBasis = oldNet - oldMarginCents;
  }
  if (oldMarginPct === null && oldMarginCents !== null && oldNet > 0) {
    oldMarginPct = roundPct((oldMarginCents / oldNet) * 100);
  }

  const oldCommissionCents = oldMarginCents === null
    ? null
    : roundCents(oldMarginCents * COMMISSION_RATE_OF_GROSS_MARGIN);
  if (floor === null) reasons.push("missing_margin_floor");

  let projectedMarginPct: number | null = null;
  let projectedCommissionCents: number | null = null;
  let belowMarginFloor = false;

  if (costBasis === null || projectedNet <= 0) {
    reasons.push("missing_cost_basis");
  } else {
    const projectedMarginCents = projectedNet - costBasis;
    projectedMarginPct = roundPct((projectedMarginCents / projectedNet) * 100);
    projectedCommissionCents = roundCents(
      projectedMarginCents * COMMISSION_RATE_OF_GROSS_MARGIN,
    );
    if (floor !== null && projectedMarginPct < floor) {
      belowMarginFloor = true;
      reasons.push("below_margin_floor");
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const commissionDeltaCents =
    oldCommissionCents !== null && projectedCommissionCents !== null
      ? projectedCommissionCents - oldCommissionCents
      : null;

  return {
    oldMarginPct,
    projectedMarginPct,
    marginFloorPct: floor,
    belowMarginFloor,
    oldCommissionCents,
    projectedCommissionCents,
    commissionDeltaCents,
    approvalRequiredReasons: uniqueReasons,
    requiresManagerReview: uniqueReasons.length > 0,
  };
}

export function impactStateFor(
  trigger: MaterialityTrigger,
): "quiet" | "visible" {
  return trigger === "quiet" ? "quiet" : "visible";
}
