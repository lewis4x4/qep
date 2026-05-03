export interface AppliedIncentive {
  id: string;
  incentive_id: string;
  applied_amount: number;
  auto_applied: boolean;
  removed_at: string | null;
  manufacturer_incentives: {
    program_name: string;
    manufacturer: string;
    discount_type: string;
    requires_approval: boolean;
    stackable: boolean;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string | null {
  const normalized = stringOrNull(value)?.trim();
  return normalized ? normalized : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanOrFalse(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function normalizeManufacturerIncentive(value: unknown): AppliedIncentive["manufacturer_incentives"] {
  const record = firstRecord(value);
  if (!record) return null;
  const programName = requiredString(record.program_name);
  const discountType = requiredString(record.discount_type);
  if (!programName || !discountType) return null;
  return {
    program_name: programName,
    manufacturer: requiredString(record.manufacturer) ?? "Unknown manufacturer",
    discount_type: discountType,
    requires_approval: booleanOrFalse(record.requires_approval),
    stackable: booleanOrFalse(record.stackable),
  };
}

export function normalizeAppliedIncentives(rows: unknown): AppliedIncentive[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const incentiveId = requiredString(value.incentive_id);
    const appliedAmount = numberOrNull(value.applied_amount);
    if (!id || !incentiveId || appliedAmount == null) return [];
    return [{
      id,
      incentive_id: incentiveId,
      applied_amount: appliedAmount,
      auto_applied: booleanOrFalse(value.auto_applied),
      removed_at: stringOrNull(value.removed_at),
      manufacturer_incentives: normalizeManufacturerIncentive(value.manufacturer_incentives),
    }];
  });
}
