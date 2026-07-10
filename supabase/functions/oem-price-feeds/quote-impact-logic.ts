import type { CanonicalPriceSheetDiff } from "./price-sheet-diff.ts";

export interface BrandScope {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
}

export interface CustomerPriceLockSnapshot {
  priceLockActive?: boolean | null;
  priceLockExpiresAt?: string | null;
  deletedAt?: string | null;
}

export interface CatalogQuoteContext {
  deliveryState?: string | null;
  selectedPromotionIds?: string[] | null;
  programIdByNormalizedCode?: Readonly<Record<string, string>>;
}

export interface CurrentQuoteAssignmentContext {
  workspaceId: string;
  dealId?: string | null;
  createdBy?: string | null;
  deal?: {
    workspaceId?: string | null;
    assignedRepId?: string | null;
    deletedAt?: string | null;
  } | null;
}

export interface ContextualCatalogChange {
  itemType: "freight" | "rebate" | "incentive";
  changeKind: CanonicalPriceSheetDiff["changeKind"];
  nameDisplay: string | null;
  oldCatalogAmountCents: number | null;
  newCatalogAmountCents: number | null;
  catalogDeltaCents: number;
  quoteDeltaCents: null;
  contextStatus:
    | "delivery_state_missing"
    | "destination_zone_match"
    | "zone_mapping_missing"
    | "selected_program"
    | "program_selection_missing";
  metadata: Record<string, unknown>;
}

export function normalizeBrandIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return normalized || null;
}

/** Exact code/name identity only; model-code equality can never imply brand. */
export function lineMatchesBrand(
  make: unknown,
  brand: BrandScope,
): boolean {
  const normalizedMake = normalizeBrandIdentity(make);
  if (!normalizedMake) return false;
  return normalizedMake === normalizeBrandIdentity(brand.code) ||
    normalizedMake === normalizeBrandIdentity(brand.name);
}

/**
 * Authorize against current CRM ownership, never the assignment captured when
 * an impact was scanned. A live deal's unassigned owner falls back to the
 * quote creator; a missing/deleted/cross-workspace deal fails closed.
 */
export function currentQuoteAssignedRepId(
  context: CurrentQuoteAssignmentContext,
): string | null {
  if (!context.dealId) return context.createdBy?.trim() || null;
  const deal = context.deal;
  if (
    !deal || deal.deletedAt || deal.workspaceId !== context.workspaceId
  ) return null;
  return deal.assignedRepId?.trim() || context.createdBy?.trim() || null;
}

export function isCustomerPriceLockActive(
  snapshot: CustomerPriceLockSnapshot | null | undefined,
  todayIso: string,
): boolean {
  if (!snapshot || snapshot.deletedAt || snapshot.priceLockActive !== true) {
    return false;
  }
  const expiry = snapshot.priceLockExpiresAt;
  if (!expiry) return true;
  return expiry.slice(0, 10) >= todayIso.slice(0, 10);
}

function normalizedProgramCode(diff: CanonicalPriceSheetDiff): string | null {
  return normalizeBrandIdentity(diff.metadata.program_code);
}

/**
 * Attach catalog changes to a brand-matched quote only when its persisted
 * context makes the relationship plausible. quoteDeltaCents intentionally
 * remains null: destination/equipment class or program eligibility is not
 * complete enough here to manufacture a customer-dollar result.
 */
export function contextualCatalogChangesForQuote(
  diffs: readonly CanonicalPriceSheetDiff[],
  context: CatalogQuoteContext,
): ContextualCatalogChange[] {
  const deliveryState = typeof context.deliveryState === "string"
    ? context.deliveryState.trim().toUpperCase()
    : "";
  const selectedIds = new Set(context.selectedPromotionIds ?? []);
  const result: ContextualCatalogChange[] = [];

  for (const diff of diffs) {
    if (
      diff.changeKind === "unchanged" || diff.itemType === "list_price"
    ) continue;
    if (diff.itemType === "freight") {
      const states = Array.isArray(diff.metadata.state_codes)
        ? diff.metadata.state_codes.map((state) => String(state).toUpperCase())
        : [];
      if (deliveryState && states.length && !states.includes(deliveryState)) {
        continue;
      }
      result.push({
        itemType: "freight",
        changeKind: diff.changeKind,
        nameDisplay: diff.nameDisplay,
        oldCatalogAmountCents: diff.oldPriceCents,
        newCatalogAmountCents: diff.newPriceCents,
        catalogDeltaCents: diff.deltaCents,
        quoteDeltaCents: null,
        contextStatus: !deliveryState
          ? "delivery_state_missing"
          : states.length
          ? "destination_zone_match"
          : "zone_mapping_missing",
        metadata: diff.metadata,
      });
      continue;
    }

    const programCode = normalizedProgramCode(diff);
    const programId = programCode
      ? context.programIdByNormalizedCode?.[programCode]
      : undefined;
    if (selectedIds.size && programId && !selectedIds.has(programId)) continue;
    result.push({
      itemType: diff.itemType,
      changeKind: diff.changeKind,
      nameDisplay: diff.nameDisplay,
      oldCatalogAmountCents: diff.oldPriceCents,
      newCatalogAmountCents: diff.newPriceCents,
      catalogDeltaCents: diff.deltaCents,
      quoteDeltaCents: null,
      contextStatus: programId && selectedIds.has(programId)
        ? "selected_program"
        : "program_selection_missing",
      metadata: diff.metadata,
    });
  }

  return result.sort((left, right) => {
    const itemOrder = { freight: 0, rebate: 1, incentive: 2 } as const;
    const typeDelta = itemOrder[left.itemType] - itemOrder[right.itemType];
    if (typeDelta !== 0) return typeDelta;
    return String(left.nameDisplay ?? "").localeCompare(
      String(right.nameDisplay ?? ""),
    );
  });
}

export function orderedChangeCategories(
  values: Iterable<string>,
): Array<"list_price" | "freight" | "rebate" | "incentive"> {
  const present = new Set(values);
  return (["list_price", "freight", "rebate", "incentive"] as const).filter(
    (value) => present.has(value),
  );
}
