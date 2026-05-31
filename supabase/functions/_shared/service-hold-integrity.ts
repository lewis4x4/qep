export const SERVICE_HOLD_STATES = [
  "waiting_on_parts_sublet",
  "waiting_on_approval",
  "waiting_on_customer",
  "waiting_on_warranty_authorization",
  "waiting_on_payment",
] as const;

export type ServiceHoldState = typeof SERVICE_HOLD_STATES[number];

const SERVICE_HOLD_STATE_SET = new Set<string>(SERVICE_HOLD_STATES);

function holdStateKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeServiceHoldState(
  value: unknown,
): ServiceHoldState | null {
  const key = holdStateKey(value);
  if (SERVICE_HOLD_STATE_SET.has(key)) return key as ServiceHoldState;

  if (
    [
      "waiting_warranty_authorization",
      "warranty_authorization",
      "warranty_auth",
      "waiting_warranty",
      "warranty",
      "oem_authorization",
      "manufacturer_authorization",
    ].includes(key) ||
    key.includes("warranty") ||
    key.includes("oem") ||
    key.includes("manufacturer")
  ) {
    return "waiting_on_warranty_authorization";
  }

  if (
    [
      "waiting_on_parts",
      "waiting_parts",
      "parts_shortage",
      "parts_pending",
      "waiting_on_sublet",
      "waiting_sublet",
      "sublet",
      "waiting_vendor",
      "vendor_wait",
      "vendor",
      "po_wait",
      "waiting_po",
    ].includes(key) ||
    key.includes("part") ||
    key.includes("sublet") ||
    key.includes("vendor") ||
    key.includes("purchase_order") ||
    key.startsWith("po_")
  ) {
    return "waiting_on_parts_sublet";
  }

  if (
    [
      "waiting_approval",
      "approval",
      "authorization",
      "waiting_authorization",
      "estimate_approval",
      "customer_approval",
      "waiting_customer_approval",
    ].includes(key) ||
    key.includes("approval") ||
    key.includes("authorization") ||
    key.includes("authorisation") ||
    key.includes("estimate")
  ) {
    return "waiting_on_approval";
  }

  if (
    [
      "waiting_customer",
      "customer",
      "client",
      "waiting_client",
      "waiting_on_client",
      "other",
    ].includes(key) ||
    key.includes("customer") ||
    key.includes("client")
  ) {
    return "waiting_on_customer";
  }

  if (
    [
      "waiting_payment",
      "payment",
      "deposit",
      "invoice_payment",
      "ar_hold",
      "accounts_receivable",
    ].includes(key) ||
    key.includes("payment") ||
    key.includes("deposit") ||
    key.includes("invoice") ||
    key.includes("receivable") ||
    key.includes("billing")
  ) {
    return "waiting_on_payment";
  }

  return null;
}

export function isServiceHoldState(value: unknown): value is ServiceHoldState {
  return normalizeServiceHoldState(value) === value;
}

function parseDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function calculateHoldDurationHours(input: {
  createdAt: unknown;
  resolvedAt?: unknown;
  now?: unknown;
}): number {
  const createdAt = parseDate(input.createdAt);
  const closedAt = parseDate(input.resolvedAt) ?? parseDate(input.now) ??
    new Date();
  if (!createdAt || closedAt <= createdAt) return 0;
  return Math.round(
    ((closedAt.getTime() - createdAt.getTime()) / 3_600_000) * 10_000,
  ) / 10_000;
}

export function excludeHoldHoursFromActual(input: {
  actualHours: unknown;
  holdHours: unknown;
}): {
  actualHoursBeforeHold: number;
  holdHoursExcluded: number;
  actualHours: number;
} {
  const actualHoursBeforeHold = Math.max(0, Number(input.actualHours) || 0);
  const holdHours = Math.max(0, Number(input.holdHours) || 0);
  const holdHoursExcluded = Math.min(actualHoursBeforeHold, holdHours);

  return {
    actualHoursBeforeHold,
    holdHoursExcluded,
    actualHours: Math.max(0, actualHoursBeforeHold - holdHoursExcluded),
  };
}
