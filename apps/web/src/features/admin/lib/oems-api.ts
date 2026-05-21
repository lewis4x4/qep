import { supabase } from "@/lib/supabase";

export type OemAdminRow = {
  id: string;
  oemKey: string;
  parentOemKey: string | null;
  displayName: string;
  category: string | null;
  sourceFormat: string;
  priceSheetCadence: string;
  active: boolean;
};

export type ResolveOemCostInput = {
  oemKey: string;
  brandKey?: string | null;
  listPriceCents: number;
  effectiveOn?: string | null;
};

export type ResolvedOemCost = {
  dealerCostCents: number;
  discountOffListPct: number;
  tierId: string;
  oemId: string | null;
  parentOemKey: string;
  brandKey: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceReference: string | null;
};

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null | { message?: string } }>;
};

function db(): SupabaseLike {
  return supabase as unknown as SupabaseLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function chain<T>(value: unknown): T {
  return value as T;
}

export function normalizeOemRows(rows: unknown): OemAdminRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const oemKey = requiredString(row.oem_key);
    const displayName = requiredString(row.display_name);
    if (!id || !oemKey || !displayName) return [];

    return [{
      id,
      oemKey,
      parentOemKey: nullableString(row.parent_oem_key),
      displayName,
      category: nullableString(row.category),
      sourceFormat: requiredString(row.source_format) ?? "unknown",
      priceSheetCadence: requiredString(row.price_sheet_cadence) ?? "unknown",
      active: bool(row.active),
    }];
  });
}

export function normalizeResolvedOemCost(row: unknown): ResolvedOemCost | null {
  if (!isRecord(row)) return null;

  const dealerCostCents = numberOrNull(row.dealer_cost_cents);
  const discountOffListPct = numberOrNull(row.discount_off_list_pct);
  const tierId = requiredString(row.tier_id);
  const parentOemKey = requiredString(row.parent_oem_key);
  const brandKey = requiredString(row.brand_key);
  const effectiveFrom = requiredString(row.effective_from);

  if (
    dealerCostCents === null ||
    discountOffListPct === null ||
    !tierId ||
    !parentOemKey ||
    !brandKey ||
    !effectiveFrom
  ) {
    return null;
  }

  return {
    dealerCostCents,
    discountOffListPct,
    tierId,
    oemId: nullableString(row.oem_id),
    parentOemKey,
    brandKey,
    effectiveFrom,
    effectiveTo: nullableString(row.effective_to),
    sourceReference: nullableString(row.source_reference),
  };
}

export function parseDollarInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function formatCentsAsDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export async function listOems(): Promise<OemAdminRow[]> {
  const query = chain<{
    select: (columns: string) => unknown;
  }>(db().from("oems"));

  const selected = chain<{
    eq: (column: string, value: unknown) => unknown;
  }>(query.select("id,oem_key,parent_oem_key,display_name,category,source_format,price_sheet_cadence,active"));

  const active = chain<{
    is: (column: string, value: unknown) => unknown;
  }>(selected.eq("active", true));

  const notDeleted = chain<{
    order: (column: string, options?: Record<string, unknown>) => Promise<{ data: unknown; error: null | { message?: string } }>;
  }>(active.is("deleted_at", null));

  const { data, error } = await notDeleted.order("display_name", { ascending: true });
  if (error) throw new Error(error.message ?? "Failed to load OEM records");
  return normalizeOemRows(data);
}

export async function resolveOemDealerCost(input: ResolveOemCostInput): Promise<ResolvedOemCost | null> {
  const { data, error } = await db().rpc("resolve_oem_cost", {
    p_oem_key: input.oemKey,
    p_brand_key: input.brandKey ?? input.oemKey,
    p_list_price_cents: input.listPriceCents,
    p_effective_on: input.effectiveOn || null,
  });

  if (error) throw new Error(error.message ?? "Failed to resolve OEM dealer cost");
  const first = Array.isArray(data) ? data[0] : data;
  return normalizeResolvedOemCost(first);
}
