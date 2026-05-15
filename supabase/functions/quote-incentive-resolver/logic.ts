export type IncentiveDiscountType = "flat" | "pct" | "apr_buydown" | "cash_back";
export type IncentiveStackKind = "cash_alt" | "finance_addon" | "always_on";

export interface ResolverQuoteTotals {
  subtotal: number | null;
  equipment_total: number | null;
}

export interface NormalizedIncentive {
  id: string;
  manufacturer: string;
  program_name: string;
  discount_type: IncentiveDiscountType;
  discount_value: number;
  stackable: boolean;
  stack_kind: IncentiveStackKind;
  requires_approval: boolean;
}

export interface ResolvedIncentive {
  incentive: NormalizedIncentive;
  amount: number;
}

export interface SkippedIncentive {
  incentive: NormalizedIncentive;
  reason: string;
}

const DISCOUNT_TYPES = new Set<IncentiveDiscountType>(["flat", "pct", "apr_buydown", "cash_back"]);
const STACK_KINDS = new Set<IncentiveStackKind>(["cash_alt", "finance_addon", "always_on"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizedNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizedBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

export function normalizeStackKind(value: unknown, stackable: boolean): IncentiveStackKind {
  if (STACK_KINDS.has(value as IncentiveStackKind)) return value as IncentiveStackKind;
  return stackable ? "always_on" : "cash_alt";
}

export function normalizeIncentive(value: unknown): NormalizedIncentive | null {
  if (!isRecord(value)) return null;
  const id = normalizedText(value.id);
  const manufacturer = normalizedText(value.manufacturer) ?? normalizedText(value.oem_name);
  const programName = normalizedText(value.program_name) ?? normalizedText(value.name);
  const discountType = normalizedText(value.discount_type) as IncentiveDiscountType | null;
  const discountValue = normalizedNumber(value.discount_value);
  if (!id || !manufacturer || !programName || !discountType || !DISCOUNT_TYPES.has(discountType) || discountValue == null) {
    return null;
  }
  const stackable = normalizedBoolean(value.stackable);
  return {
    id,
    manufacturer,
    program_name: programName,
    discount_type: discountType,
    discount_value: discountValue,
    stackable,
    stack_kind: normalizeStackKind(value.stack_kind, stackable),
    requires_approval: normalizedBoolean(value.requires_approval),
  };
}

export function computeAmount(incentive: NormalizedIncentive, quote: ResolverQuoteTotals): number {
  const base = Number(quote.equipment_total ?? quote.subtotal ?? 0);
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 0;
  const discountValue = Number.isFinite(incentive.discount_value) ? Math.max(0, incentive.discount_value) : 0;
  switch (incentive.discount_type) {
    case "flat":
    case "cash_back":
      return Math.round(discountValue * 100) / 100;
    case "pct":
    case "apr_buydown":
      return Math.round(safeBase * (discountValue / 100) * 100) / 100;
  }
}

export function resolveIncentiveStack(
  incentives: readonly NormalizedIncentive[],
  quote: ResolverQuoteTotals,
): { applied: ResolvedIncentive[]; skipped: SkippedIncentive[] } {
  const byManufacturer = new Map<string, NormalizedIncentive[]>();
  for (const incentive of incentives) {
    const key = incentive.manufacturer.toLowerCase();
    byManufacturer.set(key, [...(byManufacturer.get(key) ?? []), incentive]);
  }

  const applied: ResolvedIncentive[] = [];
  const skipped: SkippedIncentive[] = [];

  for (const [, group] of byManufacturer) {
    const cashAlternatives = group.filter((item) => item.stack_kind === "cash_alt" || !item.stackable);
    const additive = group.filter((item) => !cashAlternatives.includes(item));
    for (const incentive of additive) {
      applied.push({ incentive, amount: computeAmount(incentive, quote) });
    }

    const chosenCashAlternative = cashAlternatives.length > 0
      ? cashAlternatives.reduce((best, candidate) =>
        computeAmount(candidate, quote) > computeAmount(best, quote) ? candidate : best
      )
      : null;
    if (chosenCashAlternative) {
      applied.push({ incentive: chosenCashAlternative, amount: computeAmount(chosenCashAlternative, quote) });
      for (const incentive of cashAlternatives) {
        if (incentive.id !== chosenCashAlternative.id) {
          skipped.push({ incentive, reason: "cash alternative, lower value than selected peer" });
        }
      }
    }
  }

  return { applied, skipped };
}
