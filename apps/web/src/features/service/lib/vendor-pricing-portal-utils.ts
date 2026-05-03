export type PortalPriceRow = {
  id: string;
  partNumber: string;
  description: string | null;
  currentPrice: number | null;
  currency: string;
  effectiveDate: string;
};

export type PortalSubmissionRow = {
  id: string;
  partNumber: string;
  description: string | null;
  proposedPrice: number;
  currency: string;
  effectiveDate: string;
  notes: string | null;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
};

export type VendorPricingPortalPayload = {
  vendor: {
    id: string;
    name: string;
    supplierType: string;
    notes: string | null;
    label: string | null;
    contactName: string | null;
    contactEmail: string | null;
  };
  prices: PortalPriceRow[];
  submissions: PortalSubmissionRow[];
};

export type VendorPricingPortalResponse = VendorPricingPortalPayload & {
  error?: string;
};

export function buildVendorPricingPortalUrl(origin: string, accessKey: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/vendor/pricing/${accessKey}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function makeVendorAccessKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function normalizePortalPriceRows(rows: unknown): PortalPriceRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const partNumber = requiredString(value.partNumber);
    const currency = requiredString(value.currency);
    const effectiveDate = requiredString(value.effectiveDate);
    if (!id || !partNumber || !currency || !effectiveDate) return [];
    return [{
      id,
      partNumber,
      description: stringOrNull(value.description),
      currentPrice: numberOrNull(value.currentPrice),
      currency,
      effectiveDate,
    }];
  });
}

function normalizePortalSubmissionRows(rows: unknown): PortalSubmissionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const partNumber = requiredString(value.partNumber);
    const proposedPrice = numberOrNull(value.proposedPrice);
    const currency = requiredString(value.currency);
    const effectiveDate = requiredString(value.effectiveDate);
    const status = requiredString(value.status);
    const createdAt = requiredString(value.createdAt);
    if (!id || !partNumber || proposedPrice == null || !currency || !effectiveDate || !status || !createdAt) {
      return [];
    }
    return [{
      id,
      partNumber,
      description: stringOrNull(value.description),
      proposedPrice,
      currency,
      effectiveDate,
      notes: stringOrNull(value.notes),
      status,
      reviewNotes: stringOrNull(value.reviewNotes),
      createdAt,
    }];
  });
}

export function getVendorPricingPortalError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return stringOrNull(value.error);
}

export function normalizeVendorPricingPortalPayload(value: unknown): VendorPricingPortalPayload | null {
  if (!isRecord(value) || !isRecord(value.vendor)) return null;
  const id = requiredString(value.vendor.id);
  const name = requiredString(value.vendor.name);
  const supplierType = requiredString(value.vendor.supplierType);
  if (!id || !name || !supplierType) return null;
  return {
    vendor: {
      id,
      name,
      supplierType,
      notes: stringOrNull(value.vendor.notes),
      label: stringOrNull(value.vendor.label),
      contactName: stringOrNull(value.vendor.contactName),
      contactEmail: stringOrNull(value.vendor.contactEmail),
    },
    prices: normalizePortalPriceRows(value.prices),
    submissions: normalizePortalSubmissionRows(value.submissions),
  };
}
