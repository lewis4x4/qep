// deno-lint-ignore-file no-import-prefix no-explicit-any
/**
 * oem-price-feeds — Phase 1 server API for OEM price-feed preview/publish.
 * Scope is server contract only: no admin/sales UI work here.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import {
  centsValue,
  classifyMateriality,
  deltaPct,
  dollarsToCents,
  evaluateMarginGate,
  impactStateFor,
  isStockLockedLine,
  MATERIALITY_LINE_PCT_GT,
  MATERIALITY_QUOTE_DELTA_CENTS_GT,
  type MaterialityTrigger,
  normalizeModelCode,
  parseStoredPercent,
} from "./impact-logic.ts";
import {
  canonicalizePriceSheetRows,
  type CanonicalPriceSheetDiff,
  diffCanonicalPriceSheetRows,
  laneForPriceSheetItemType,
  lanesForPriceSheetType,
  type PriceSheetHeader,
  type PriceSheetItemSourceRow,
  type PriceSheetLane,
  type PriceSheetProgramSourceRow,
  type PriorPriceSheetIdsByLane,
  selectPriorPriceSheetIdsByLane,
} from "./price-sheet-diff.ts";
import {
  collectAllKeysetRows,
  type KeysetCollection,
  type KeysetPage,
} from "./keyset-pagination.ts";
import {
  type BrandScope,
  type ContextualCatalogChange,
  contextualCatalogChangesForQuote,
  currentQuoteAssignedRepId,
  isCustomerPriceLockActive,
  lineMatchesBrand,
  normalizeBrandIdentity,
  orderedChangeCategories,
} from "./quote-impact-logic.ts";

const OPEN_QUOTE_STATUSES = [
  "draft",
  "draft_low_margin",
  "pending_approval",
  "approved",
  "approved_with_conditions",
  "changes_requested",
  "ready",
  "sent",
  "viewed",
];
const APPROVAL_POLICY = {
  numericApprovalThresholds: "margin_floor_only",
  requireManagerReviewForChangeTypes: [
    "list_price",
    "freight",
    "rebate",
    "incentive",
  ],
  autoSendCustomer: false,
};

type ServiceClient = SupabaseClient<any, "public", any>;
type JsonObject = Record<string, unknown>;
type IdJsonObject = JsonObject & { id: string };

interface AuthContext {
  userId: string;
  role: string;
  workspaceId: string;
  callerClient: ServiceClient;
  admin: ServiceClient;
  origin: string | null;
}

interface PriceSheetRow extends PriceSheetHeader {
  brand_id: string;
  effective_from: string | null;
  published_at: string | null;
}

type ItemDiff = CanonicalPriceSheetDiff;

interface ImpactLineDraft {
  quotePackageLineItemId: string | null;
  equipmentLineId: string | null;
  modelCode: string;
  make: string | null;
  quantity: number;
  oldListPriceCents: number | null;
  newListPriceCents: number | null;
  deltaCents: number;
  deltaPct: number | null;
  sourceLocation: string | null;
  isYardStock: boolean;
  suppressedByStockLock: boolean;
  suppressionReason: string | null;
  quoteLineSnapshot: JsonObject;
  metadata: JsonObject;
}

interface ImpactDraft {
  quotePackageId: string;
  dealId: string | null;
  assignedRepId: string | null;
  quoteStatusSnapshot: string | null;
  quoteUpdatedAtSnapshot: string | null;
  totalDeltaCents: number;
  maxLineDeltaPct: number | null;
  oldMarginPct: number | null;
  projectedMarginPct: number | null;
  marginFloorPct: number | null;
  belowMarginFloor: boolean;
  materialityTrigger: MaterialityTrigger;
  requiresManagerReview: boolean;
  approvalRequiredReasons: string[];
  oldCommissionCents: number | null;
  projectedCommissionCents: number | null;
  commissionDeltaCents: number | null;
  changeCategories: Array<"list_price" | "freight" | "rebate" | "incentive">;
  catalogChanges: ContextualCatalogChange[];
  contextSnapshot: JsonObject;
  customerCompanyId: string | null;
  suppressedByCustomerLock: boolean;
  customerPriceLockReason: string | null;
  customerPriceLockExpiresAt: string | null;
  state: "quiet" | "visible";
  lines: ImpactLineDraft[];
}

interface ScanEvidence {
  scanStartedAt: string;
  scanCompletedAt: string;
  candidateQuoteCount: number;
  candidateLineCount: number;
  quotePageCount: number;
  linePageCount: number;
  quotePricingEpoch: number;
  scanComplete: true;
}

interface StreamPreview {
  streamKind: PriceSheetLane;
  priorPriceSheetId: string | null;
  itemDiffs: ItemDiff[];
  impacts: ImpactDraft[];
}

interface PreviewBuild {
  sheet: PriceSheetRow;
  priorPriceSheetId: string | null;
  priorPriceSheetIdsByLane: PriorPriceSheetIdsByLane;
  itemDiffs: ItemDiff[];
  impacts: ImpactDraft[];
  streams: StreamPreview[];
  scanEvidence: ScanEvidence;
}

const createAdminClient = (): ServiceClient =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const asObject = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function firstCents(...values: unknown[]): number | null {
  for (const value of values) {
    const cents = centsValue(value);
    if (cents !== null) return cents;
  }
  return null;
}
function firstDollarsAsCents(...values: unknown[]): number | null {
  for (const value of values) {
    const cents = dollarsToCents(value);
    if (cents !== null) return cents;
  }
  return null;
}
/**
 * Exhaust a query with `id > cursor`, stable ascending id order, and no global
 * row ceiling. Any page error/order violation rejects the whole scan rather
 * than returning partial coverage as a successful preview/publish.
 */
function loadAllById<T extends { id: string }>(
  build: (
    afterId: string | null,
    limit: number,
  ) => PromiseLike<KeysetPage<T>>,
  label: string,
  pageSize = 1000,
): Promise<KeysetCollection<T>> {
  return collectAllKeysetRows(build, label, (row) => row.id, pageSize);
}

async function loadSheet(
  admin: ServiceClient,
  priceSheetId: string,
): Promise<PriceSheetRow> {
  const { data, error } = await admin.from("qb_price_sheets").select(
    "id, workspace_id, brand_id, status, sheet_type, effective_from, published_at, supersedes_price_sheet_id",
  ).eq("id", priceSheetId).maybeSingle();
  if (error) throw new Error(`Failed to load price sheet: ${error.message}`);
  if (!data) throw new Error("Price sheet not found");
  return data as PriceSheetRow;
}

const PRICE_SHEET_HEADER_COLUMNS =
  "id, workspace_id, brand_id, status, sheet_type, effective_from, published_at, supersedes_price_sheet_id";

async function loadPriceSheetsByIds(
  admin: ServiceClient,
  ids: string[],
): Promise<Map<string, PriceSheetRow>> {
  if (!ids.length) return new Map();
  const { data, error } = await admin.from("qb_price_sheets").select(
    PRICE_SHEET_HEADER_COLUMNS,
  ).in("id", [...new Set(ids)]);
  if (error) {
    throw new Error(`Failed to load predecessor sheets: ${error.message}`);
  }
  return new Map(
    ((data ?? []) as PriceSheetRow[]).map((sheet) => [sheet.id, sheet]),
  );
}

async function loadPriorPriceSheetsByLane(
  admin: ServiceClient,
  sheet: PriceSheetRow,
): Promise<{
  ids: PriorPriceSheetIdsByLane;
  sheets: Partial<Record<PriceSheetLane, PriceSheetRow | null>>;
}> {
  const { data: pinned, error: pinnedError } = await admin.from(
    "qb_price_sheet_lineage",
  ).select("lane, predecessor_price_sheet_id").eq("price_sheet_id", sheet.id);
  if (pinnedError) {
    throw new Error(
      `Failed to load price-sheet lineage: ${pinnedError.message}`,
    );
  }

  let ids: PriorPriceSheetIdsByLane;
  if ((pinned ?? []).length) {
    ids = {};
    for (const row of pinned as JsonObject[]) {
      const lane = firstString(row.lane) as PriceSheetLane | null;
      if (lane !== "price_book" && lane !== "retail_programs") continue;
      ids[lane] = firstString(row.predecessor_price_sheet_id);
    }
    for (const lane of lanesForPriceSheetType(sheet.sheet_type)) {
      if (!(lane in ids)) {
        throw new Error(
          `Pinned price-sheet lineage is missing the ${lane} lane`,
        );
      }
    }
  } else {
    const candidates = (await loadAllById<PriceSheetRow>(
      (afterId, limit) => {
        let query = admin.from("qb_price_sheets").select(
          PRICE_SHEET_HEADER_COLUMNS,
        ).eq("workspace_id", sheet.workspace_id).eq("brand_id", sheet.brand_id)
          .in("status", ["published", "superseded"]).neq("id", sheet.id)
          .order("id", { ascending: true }).limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return query;
      },
      "prior price sheets",
    )).rows;
    ids = selectPriorPriceSheetIdsByLane(sheet, candidates);
  }

  const byId = await loadPriceSheetsByIds(
    admin,
    Object.values(ids).filter((id): id is string => Boolean(id)),
  );
  const sheets: Partial<Record<PriceSheetLane, PriceSheetRow | null>> = {};
  for (const lane of lanesForPriceSheetType(sheet.sheet_type)) {
    const id = ids[lane] ?? null;
    const prior = id ? byId.get(id) ?? null : null;
    if (id && !prior) {
      throw new Error(`Pinned ${lane} predecessor ${id} was not found`);
    }
    if (
      prior &&
      (prior.workspace_id !== sheet.workspace_id ||
        prior.brand_id !== sheet.brand_id)
    ) {
      throw new Error(`Pinned ${lane} predecessor is outside the sheet scope`);
    }
    sheets[lane] = prior;
  }
  return { ids, sheets };
}

interface PriceSheetSourceRows {
  items: PriceSheetItemSourceRow[];
  programs: PriceSheetProgramSourceRow[];
}

async function loadPriceSheetSourceRows(
  admin: ServiceClient,
  priceSheetId: string,
): Promise<PriceSheetSourceRows> {
  const [items, programs] = await Promise.all([
    loadAllById<PriceSheetItemSourceRow>(
      (afterId, limit) => {
        let query = admin.from("qb_price_sheet_items").select(
          "id, item_type, extracted, action, review_status, applied_at",
        ).eq("price_sheet_id", priceSheetId).order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return query;
      },
      `price-sheet items for ${priceSheetId}`,
    ),
    loadAllById<PriceSheetProgramSourceRow>(
      (afterId, limit) => {
        let query = admin.from("qb_price_sheet_programs").select(
          "id, program_code, program_type, extracted, action, review_status, applied_at",
        ).eq("price_sheet_id", priceSheetId).order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return query;
      },
      `price-sheet programs for ${priceSheetId}`,
    ),
  ]);
  return { items: items.rows, programs: programs.rows };
}

async function buildItemDiffs(
  admin: ServiceClient,
  sheet: PriceSheetRow,
  priorSheets: Partial<Record<PriceSheetLane, PriceSheetRow | null>>,
): Promise<ItemDiff[]> {
  const uniquePriors = [...new Map(
    Object.values(priorSheets).filter((value): value is PriceSheetRow =>
      Boolean(value)
    )
      .map((value) => [value.id, value]),
  ).values()];
  const [incomingSource, ...priorSources] = await Promise.all([
    loadPriceSheetSourceRows(admin, sheet.id),
    ...uniquePriors.map((prior) => loadPriceSheetSourceRows(admin, prior.id)),
  ]);
  const supportedLanes = new Set(lanesForPriceSheetType(sheet.sheet_type));
  const incomingRows = canonicalizePriceSheetRows(
    sheet,
    incomingSource.items,
    incomingSource.programs,
    { mode: sheet.status === "published" ? "published" : "candidate" },
  ).filter((row) =>
    supportedLanes.has(laneForPriceSheetItemType(row.itemType))
  );
  const priorSourceById = new Map(
    uniquePriors.map((prior, index) => [prior.id, priorSources[index]]),
  );
  const priorRows = lanesForPriceSheetType(sheet.sheet_type).flatMap((lane) => {
    const prior = priorSheets[lane];
    if (!prior) return [];
    const source = priorSourceById.get(prior.id);
    if (!source) return [];
    return canonicalizePriceSheetRows(
      prior,
      source.items,
      source.programs,
      { mode: "published" },
    ).filter((row) => laneForPriceSheetItemType(row.itemType) === lane);
  });
  return diffCanonicalPriceSheetRows(priorRows, incomingRows);
}

function quoteLinesFromLegacyEquipment(quote: JsonObject): JsonObject[] {
  const equipment = Array.isArray(quote.equipment) ? quote.equipment : [];
  return equipment.map((entry, index) => {
    const obj = asObject(entry);
    return {
      id: null,
      equipment_line_id: String(obj.id ?? obj.line_id ?? index),
      model: obj.model ?? obj.model_code ?? obj.modelCode,
      make: obj.make ?? obj.brand,
      quantity: obj.quantity ?? obj.qty ?? 1,
      quoted_list_price: obj.price ?? obj.list_price ?? obj.quoted_list_price,
      quoted_list_price_cents: obj.price_cents ?? obj.list_price_cents,
      quoted_dealer_cost: obj.dealer_cost ?? obj.cost,
      quoted_dealer_cost_cents: obj.dealer_cost_cents ?? obj.cost_cents,
      source_location: obj.source_location,
      is_yard_stock: obj.is_yard_stock,
      _legacy: true,
    };
  });
}
function quoteLinePriceCents(line: JsonObject): number | null {
  return firstCents(
    line.quoted_list_price_cents,
    line.list_price_cents,
    line.price_cents,
  ) ?? firstDollarsAsCents(line.quoted_list_price, line.list_price, line.price);
}
function quoteLineCostCents(line: JsonObject): number | null {
  return firstCents(
    line.quoted_dealer_cost_cents,
    line.dealer_cost_cents,
    line.cost_cents,
  ) ??
    firstDollarsAsCents(line.quoted_dealer_cost, line.dealer_cost, line.cost);
}

async function loadMarginFloor(
  admin: ServiceClient,
  workspaceId: string,
  brandId: string,
): Promise<number | null> {
  const { data: brandFloor, error: brandErr } = await admin.from(
    "qb_margin_thresholds",
  ).select("min_margin_pct").eq("workspace_id", workspaceId).eq(
    "brand_id",
    brandId,
  ).maybeSingle();
  if (brandErr) {
    throw new Error(`Failed to load brand margin floor: ${brandErr.message}`);
  }
  if (brandFloor) {
    return parseStoredPercent((brandFloor as JsonObject).min_margin_pct);
  }
  const { data: defaultFloor, error: defaultErr } = await admin.from(
    "qb_margin_thresholds",
  ).select("min_margin_pct").eq("workspace_id", workspaceId).is(
    "brand_id",
    null,
  ).maybeSingle();
  if (defaultErr) {
    throw new Error(
      `Failed to load default margin floor: ${defaultErr.message}`,
    );
  }
  return defaultFloor
    ? parseStoredPercent((defaultFloor as JsonObject).min_margin_pct)
    : null;
}

async function loadBrandScope(
  admin: ServiceClient,
  sheet: PriceSheetRow,
): Promise<BrandScope> {
  const { data, error } = await admin.from("qb_brands").select(
    "id, workspace_id, code, name",
  ).eq("id", sheet.brand_id).eq("workspace_id", sheet.workspace_id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load OEM brand: ${error.message}`);
  if (!data) throw new Error("OEM brand is outside the sheet workspace");
  return {
    id: String(data.id),
    workspaceId: String(data.workspace_id),
    code: String(data.code),
    name: String(data.name),
  };
}

async function loadProgramIdMap(
  admin: ServiceClient,
  sheet: PriceSheetRow,
): Promise<Record<string, string>> {
  const collection = await loadAllById<IdJsonObject>(
    (afterId, limit) => {
      let query = admin.from("qb_programs").select("id, program_code").eq(
        "workspace_id",
        sheet.workspace_id,
      ).eq("brand_id", sheet.brand_id).order("id", { ascending: true }).limit(
        limit,
      );
      if (afterId) query = query.gt("id", afterId);
      return query;
    },
    "OEM program context",
  );
  const result: Record<string, string> = {};
  for (const row of collection.rows) {
    const code = normalizeBrandIdentity(row.program_code);
    if (!code) continue;
    if (result[code] && result[code] !== row.id) {
      throw new Error(`Ambiguous normalized OEM program code ${code}`);
    }
    result[code] = row.id;
  }
  return result;
}

async function loadPriceLockCompanies(
  admin: ServiceClient,
  workspaceId: string,
  companyIds: string[],
): Promise<Map<string, JsonObject>> {
  const result = new Map<string, JsonObject>();
  const uniqueIds = [...new Set(companyIds)].sort();
  const ID_CHUNK = 200;
  for (let index = 0; index < uniqueIds.length; index += ID_CHUNK) {
    const batch = uniqueIds.slice(index, index + ID_CHUNK);
    const collection = await loadAllById<IdJsonObject>(
      (afterId, limit) => {
        let query = admin.from("qrm_companies").select(
          "id, workspace_id, price_lock_active, price_lock_reason, price_lock_expires_at, deleted_at",
        ).eq("workspace_id", workspaceId).in("id", batch).is(
          "deleted_at",
          null,
        ).order("id", { ascending: true }).limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return query;
      },
      "customer price-lock context",
    );
    for (const row of collection.rows) result.set(row.id, row);
  }
  return result;
}

async function loadQuotePricingEpoch(
  admin: ServiceClient,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await admin.from("qb_workspace_pricing_epochs")
    .select(
      "epoch",
    ).eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    throw new Error(`Failed to load quote-pricing epoch: ${error.message}`);
  }
  const epoch = Number((data as JsonObject | null)?.epoch ?? 0);
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error("Quote-pricing epoch is outside the safe integer range");
  }
  return epoch;
}

interface ImpactScanResult {
  impacts: ImpactDraft[];
  evidence: ScanEvidence;
}

async function buildQuoteImpacts(
  admin: ServiceClient,
  sheet: PriceSheetRow,
  itemDiffs: ItemDiff[],
): Promise<ImpactScanResult> {
  const scanStartedAt = new Date().toISOString();
  // This is read before any candidate query. The persistence RPC later locks
  // and compares the same epoch, so inserts and previously-unmatched edits are
  // detected even though they are absent from the impact payload.
  const quotePricingEpoch = await loadQuotePricingEpoch(
    admin,
    sheet.workspace_id,
  );
  const todayIso = scanStartedAt.slice(0, 10);
  const brand = await loadBrandScope(admin, sheet);
  const changedDiffs = itemDiffs.filter((diff) =>
    diff.changeKind !== "unchanged"
  );
  const listPriceDiffs = changedDiffs.filter((diff) =>
    diff.itemType === "list_price" && diff.normalizedCode
  );
  const byCode = new Map<string, ItemDiff>();
  for (const diff of listPriceDiffs) byCode.set(diff.normalizedCode!, diff);
  const [marginFloorPct, programIdByNormalizedCode] = await Promise.all([
    loadMarginFloor(admin, sheet.workspace_id, sheet.brand_id),
    loadProgramIdMap(admin, sheet),
  ]);

  const quoteCollection = await loadAllById<IdJsonObject>(
    (afterId, limit) => {
      let query = admin.from("quote_packages").select(
        "id, workspace_id, deal_id, status, updated_at, equipment, net_total, margin_amount, margin_pct, created_by, delivery_state, selected_promotion_ids, crm_deals(assigned_rep_id, company_id)",
      ).eq("workspace_id", sheet.workspace_id).in("status", OPEN_QUOTE_STATUSES)
        .order("id", { ascending: true }).limit(limit);
      if (afterId) query = query.gt("id", afterId);
      return query;
    },
    "open quote scan",
  );
  const quotes = quoteCollection.rows;
  const quoteIds = quotes.map((quote) => quote.id);
  const linesByQuote = new Map<string, JsonObject[]>();
  let candidateLineCount = 0;
  let linePageCount = 0;
  const QUOTE_ID_CHUNK = 200;
  for (let index = 0; index < quoteIds.length; index += QUOTE_ID_CHUNK) {
    const batch = quoteIds.slice(index, index + QUOTE_ID_CHUNK);
    const lineCollection = await loadAllById<IdJsonObject>(
      (afterId, limit) => {
        let query = admin.from("quote_package_line_items").select("*").eq(
          "workspace_id",
          sheet.workspace_id,
        ).in("quote_package_id", batch).order("id", { ascending: true }).limit(
          limit,
        );
        if (afterId) query = query.gt("id", afterId);
        return query;
      },
      "quote line scan",
    );
    candidateLineCount += lineCollection.rows.length;
    linePageCount += lineCollection.pageCount;
    for (const row of lineCollection.rows) {
      const quoteId = String(row.quote_package_id);
      const list = linesByQuote.get(quoteId) ?? [];
      list.push(row);
      linesByQuote.set(quoteId, list);
    }
  }

  const joinedDealFor = (quote: JsonObject): JsonObject =>
    asObject(
      Array.isArray(quote.crm_deals) ? quote.crm_deals[0] : quote.crm_deals,
    );
  const companyIds = quotes.flatMap((quote) => {
    const companyId = firstString(joinedDealFor(quote).company_id);
    return companyId ? [companyId] : [];
  });
  const priceLockCompanies = await loadPriceLockCompanies(
    admin,
    sheet.workspace_id,
    companyIds,
  );

  const impacts: ImpactDraft[] = [];
  for (const quote of quotes) {
    const quoteId = quote.id;
    const persistedLines = linesByQuote.get(quoteId) ?? [];
    const sourceLines = persistedLines.length
      ? persistedLines
      : quoteLinesFromLegacyEquipment(quote);
    if (!persistedLines.length) candidateLineCount += sourceLines.length;
    const brandLines = sourceLines.filter((line) =>
      (line._legacy === true || line.line_type === "equipment") &&
      lineMatchesBrand(firstString(line.make, line.brand), brand)
    );
    if (!brandLines.length) continue;

    const impactLines: ImpactLineDraft[] = [];
    const categories = new Set<string>();
    let proposedTotalDeltaCents = 0;
    let maxAbsLinePct = 0;
    let anyStockLocked = false;
    let allLineCostBasisCents = 0;
    let everyLineHasCost = sourceLines.length > 0;

    for (const line of sourceLines) {
      const quantity = Math.max(1, Number(line.quantity ?? 1) || 1);
      const lineCost = quoteLineCostCents(line);
      if (lineCost === null) everyLineHasCost = false;
      else allLineCostBasisCents += lineCost * quantity;
    }

    for (const line of brandLines) {
      const modelCode = firstString(
        line.model,
        line.model_code,
        line.modelCode,
      );
      const normalized = normalizeModelCode(modelCode);
      if (!normalized) continue;
      const diff = byCode.get(normalized);
      if (!diff) continue;
      categories.add("list_price");
      const quantity = Math.max(1, Number(line.quantity ?? 1) || 1);
      const quotedListPrice = quoteLinePriceCents(line);
      const quotedDealerCost = quoteLineCostCents(line);
      const oldListPrice = quotedListPrice ?? diff.oldPriceCents;
      const newListPrice = diff.newPriceCents;
      const stockLocked = isStockLockedLine({
        sourceLocation: line.source_location,
        isYardStock: line.is_yard_stock,
      });
      if (stockLocked) anyStockLocked = true;

      let lineDelta = 0;
      let pct: number | null = null;
      let catalogOnlyReason: string | null = null;
      if (oldListPrice === null || newListPrice === null) {
        catalogOnlyReason = newListPrice === null
          ? "model_removed_or_discontinued"
          : "missing_quote_line_price";
      } else {
        lineDelta = (newListPrice - oldListPrice) * quantity;
        pct = deltaPct(oldListPrice, newListPrice);
        if (!stockLocked) {
          proposedTotalDeltaCents += lineDelta;
          const rawPct = oldListPrice !== 0
            ? ((newListPrice - oldListPrice) / oldListPrice) * 100
            : null;
          if (rawPct !== null) {
            maxAbsLinePct = Math.max(maxAbsLinePct, Math.abs(rawPct));
          }
        }
      }
      impactLines.push({
        quotePackageLineItemId: typeof line.id === "string" ? line.id : null,
        equipmentLineId: firstString(line.equipment_line_id),
        modelCode: modelCode ?? normalized,
        make: firstString(line.make, line.brand),
        quantity,
        oldListPriceCents: oldListPrice,
        newListPriceCents: newListPrice,
        deltaCents: lineDelta,
        deltaPct: pct,
        sourceLocation: firstString(line.source_location),
        isYardStock: stockLocked,
        suppressedByStockLock: stockLocked,
        suppressionReason: stockLocked ? "yard_stock_price_locked" : null,
        quoteLineSnapshot: {
          make: firstString(line.make, line.brand),
          model: firstString(line.model, line.model_code, line.modelCode),
          quantity,
          quoted_list_price_cents: quotedListPrice,
          quoted_dealer_cost_cents: quotedDealerCost,
          source_location: firstString(line.source_location),
        },
        metadata: {
          normalized_code: normalized,
          brand_id: brand.id,
          change_kind: diff.changeKind,
          catalog_only_reason: catalogOnlyReason,
          source: line._legacy
            ? "quote_packages.equipment"
            : "quote_package_line_items",
        },
      });
    }

    const catalogChanges = contextualCatalogChangesForQuote(changedDiffs, {
      deliveryState: firstString(quote.delivery_state),
      selectedPromotionIds: Array.isArray(quote.selected_promotion_ids)
        ? quote.selected_promotion_ids.map(String)
        : [],
      programIdByNormalizedCode,
    });
    for (const change of catalogChanges) categories.add(change.itemType);
    if (!impactLines.length && !catalogChanges.length) continue;

    const changeCategories = orderedChangeCategories(categories);
    const joinedDeal = joinedDealFor(quote);
    const customerCompanyId = firstString(joinedDeal.company_id);
    const company = customerCompanyId
      ? priceLockCompanies.get(customerCompanyId)
      : undefined;
    const suppressedByCustomerLock = isCustomerPriceLockActive(
      company
        ? {
          priceLockActive: company.price_lock_active === true,
          priceLockExpiresAt: firstString(company.price_lock_expires_at),
          deletedAt: firstString(company.deleted_at),
        }
        : null,
      todayIso,
    );
    const effectiveTotalDeltaCents = suppressedByCustomerLock
      ? 0
      : proposedTotalDeltaCents;
    const effectiveMaxLinePct = suppressedByCustomerLock ? 0 : maxAbsLinePct;
    const trigger = classifyMateriality({
      maxAbsLineDeltaPct: effectiveMaxLinePct,
      totalDeltaCents: effectiveTotalDeltaCents,
    });
    const oldNetTotalCents = firstDollarsAsCents(quote.net_total);
    const oldMarginCents = firstDollarsAsCents(quote.margin_amount);
    const oldMarginPct = parseStoredPercent(quote.margin_pct);
    const costBasisCents = oldNetTotalCents !== null && oldMarginCents !== null
      ? oldNetTotalCents - oldMarginCents
      : everyLineHasCost
      ? allLineCostBasisCents
      : null;
    const gate = evaluateMarginGate({
      oldNetTotalCents,
      totalDeltaCents: effectiveTotalDeltaCents,
      oldMarginPct,
      oldMarginCents,
      costBasisCents,
      marginFloorPct,
      policyRequiresManagerReview: !suppressedByCustomerLock &&
        changeCategories.length > 0,
      stockLocked: anyStockLocked,
    });
    const approvalRequiredReasons = suppressedByCustomerLock
      ? ["customer_price_lock"]
      : [
        ...new Set([
          ...gate.approvalRequiredReasons,
          `price_change_categories:${changeCategories.join(",")}`,
        ]),
      ];
    const assignedRepId = firstString(
      joinedDeal.assigned_rep_id,
      quote.created_by,
    );
    impacts.push({
      quotePackageId: quoteId,
      dealId: firstString(quote.deal_id),
      assignedRepId,
      quoteStatusSnapshot: firstString(quote.status),
      quoteUpdatedAtSnapshot: firstString(quote.updated_at),
      totalDeltaCents: effectiveTotalDeltaCents,
      maxLineDeltaPct: effectiveMaxLinePct || null,
      oldMarginPct: gate.oldMarginPct,
      projectedMarginPct: gate.projectedMarginPct,
      marginFloorPct: gate.marginFloorPct,
      belowMarginFloor: gate.belowMarginFloor,
      materialityTrigger: trigger,
      requiresManagerReview: !suppressedByCustomerLock &&
        changeCategories.length > 0,
      approvalRequiredReasons,
      oldCommissionCents: gate.oldCommissionCents,
      projectedCommissionCents: gate.projectedCommissionCents,
      commissionDeltaCents: gate.commissionDeltaCents,
      changeCategories,
      catalogChanges,
      contextSnapshot: {
        brand_id: brand.id,
        brand_code: brand.code,
        matched_brand_line_count: brandLines.length,
        delivery_state: firstString(quote.delivery_state),
        selected_promotion_ids: Array.isArray(quote.selected_promotion_ids)
          ? quote.selected_promotion_ids
          : [],
        unlocked_total_delta_cents: proposedTotalDeltaCents,
        catalog_change_count: catalogChanges.length,
      },
      customerCompanyId,
      suppressedByCustomerLock,
      customerPriceLockReason: firstString(company?.price_lock_reason),
      customerPriceLockExpiresAt: firstString(company?.price_lock_expires_at),
      state: suppressedByCustomerLock ? "quiet" : impactStateFor(trigger),
      lines: impactLines,
    });
  }

  return {
    impacts,
    evidence: {
      scanStartedAt,
      scanCompletedAt: new Date().toISOString(),
      candidateQuoteCount: quotes.length,
      candidateLineCount,
      quotePageCount: quoteCollection.pageCount,
      linePageCount,
      quotePricingEpoch,
      scanComplete: true,
    },
  };
}

function approvalReasonsForStream(
  impact: ImpactDraft,
  categories: ImpactDraft["changeCategories"],
  streamKind: PriceSheetLane,
): string[] {
  if (impact.suppressedByCustomerLock) return ["customer_price_lock"];
  const retained = impact.approvalRequiredReasons.filter((reason) =>
    !reason.startsWith("price_change_categories:") &&
    (streamKind === "price_book" ||
      !["stock_lock", "below_margin_floor", "missing_cost_basis"].includes(
        reason,
      ))
  );
  return [
    ...new Set([
      ...retained,
      "manager_review_policy",
      `price_change_categories:${categories.join(",")}`,
    ]),
  ];
}

function impactForStream(
  impact: ImpactDraft,
  streamKind: PriceSheetLane,
): ImpactDraft | null {
  const categorySet = streamKind === "price_book"
    ? new Set(["list_price", "freight"])
    : new Set(["rebate", "incentive"]);
  const changeCategories = impact.changeCategories.filter((category) =>
    categorySet.has(category)
  );
  const catalogChanges = impact.catalogChanges.filter((change) =>
    categorySet.has(change.itemType)
  );
  const lines = streamKind === "price_book" ? impact.lines : [];
  if (!changeCategories.length || (!lines.length && !catalogChanges.length)) {
    return null;
  }

  if (streamKind === "price_book") {
    const trigger = classifyMateriality({
      maxAbsLineDeltaPct: impact.maxLineDeltaPct,
      totalDeltaCents: impact.totalDeltaCents,
    });
    return {
      ...impact,
      changeCategories,
      catalogChanges,
      lines,
      materialityTrigger: trigger,
      requiresManagerReview: !impact.suppressedByCustomerLock,
      approvalRequiredReasons: approvalReasonsForStream(
        impact,
        changeCategories,
        streamKind,
      ),
      state: impact.suppressedByCustomerLock
        ? "quiet"
        : impactStateFor(trigger),
    };
  }

  return {
    ...impact,
    totalDeltaCents: 0,
    maxLineDeltaPct: null,
    projectedMarginPct: impact.oldMarginPct,
    belowMarginFloor: false,
    projectedCommissionCents: impact.oldCommissionCents,
    commissionDeltaCents: impact.oldCommissionCents === null ? null : 0,
    materialityTrigger: "quiet",
    requiresManagerReview: !impact.suppressedByCustomerLock,
    approvalRequiredReasons: approvalReasonsForStream(
      impact,
      changeCategories,
      streamKind,
    ),
    changeCategories,
    catalogChanges,
    lines: [],
    state: "quiet",
  };
}

function buildStreamPreviews(
  sheet: PriceSheetRow,
  priorIds: PriorPriceSheetIdsByLane,
  itemDiffs: ItemDiff[],
  impacts: ImpactDraft[],
): StreamPreview[] {
  return lanesForPriceSheetType(sheet.sheet_type).map((streamKind) => ({
    streamKind,
    priorPriceSheetId: priorIds[streamKind] ?? null,
    itemDiffs: itemDiffs.filter((item) =>
      laneForPriceSheetItemType(item.itemType) === streamKind
    ),
    impacts: impacts.flatMap((impact) => {
      const scoped = impactForStream(impact, streamKind);
      return scoped ? [scoped] : [];
    }),
  }));
}

async function buildPreview(
  admin: ServiceClient,
  priceSheetId: string,
  workspaceId: string,
): Promise<PreviewBuild> {
  const sheet = await loadSheet(admin, priceSheetId);
  if (sheet.workspace_id !== workspaceId) {
    throw new Error("Price sheet is outside caller workspace");
  }
  // Resolve the exact predecessor first: the pure diff must compare immutable
  // predecessor rows, never whichever catalog values happen to be current.
  const prior = await loadPriorPriceSheetsByLane(admin, sheet);
  const priorIds = [
    ...new Set(
      Object.values(prior.ids).filter((id): id is string => Boolean(id)),
    ),
  ];
  // Retained for backward-compatible preview consumers. A composed `both`
  // lineage intentionally reports null here and exposes the per-lane map.
  const priorPriceSheetId = priorIds.length === 1 ? priorIds[0] : null;
  const itemDiffs = await buildItemDiffs(admin, sheet, prior.sheets);
  const impactScan = await buildQuoteImpacts(admin, sheet, itemDiffs);
  const streams = buildStreamPreviews(
    sheet,
    prior.ids,
    itemDiffs,
    impactScan.impacts,
  );
  return {
    sheet,
    priorPriceSheetId,
    priorPriceSheetIdsByLane: prior.ids,
    itemDiffs,
    impacts: impactScan.impacts,
    streams,
    scanEvidence: impactScan.evidence,
  };
}

function previewPayload(preview: PreviewBuild) {
  const material = preview.impacts.filter((impact) =>
    impact.state === "visible"
  );
  const quiet = preview.impacts.filter((impact) => impact.state === "quiet");
  return {
    ok: true,
    diff: {
      priceSheetId: preview.sheet.id,
      priorPriceSheetId: preview.priorPriceSheetId,
      priorPriceSheetIdsByLane: preview.priorPriceSheetIdsByLane,
      brandId: preview.sheet.brand_id,
      changedItemCount:
        preview.itemDiffs.filter((item) => item.changeKind !== "unchanged")
          .length,
      items: preview.itemDiffs,
      approvalPolicy: APPROVAL_POLICY,
      materialityRule: {
        line_pct_gt: MATERIALITY_LINE_PCT_GT,
        quote_delta_cents_gt: MATERIALITY_QUOTE_DELTA_CENTS_GT,
      },
    },
    impactPreview: {
      scanEvidence: preview.scanEvidence,
      totalQuotesAffected: preview.impacts.length,
      materialQuotesAffected: material.length,
      quietQuotesAffected: quiet.length,
      totalDeltaCents: material.reduce(
        (sum, impact) => sum + impact.totalDeltaCents,
        0,
      ),
      stockLockedLineCount:
        preview.impacts.flatMap((impact) => impact.lines).filter((line) =>
          line.suppressedByStockLock
        ).length,
      needsApprovalCount:
        material.filter((impact) => impact.requiresManagerReview).length,
      // Return up to 100 (not 10) so the admin review list reconciles with the
      // materialQuotesAffected headline for realistic sheets. The count above
      // stays the true total; the UI labels "showing N of M" if it's exceeded.
      topQuotes: material.slice().sort((a, b) =>
        Math.abs(b.totalDeltaCents) - Math.abs(a.totalDeltaCents)
      ).slice(0, 100),
    },
  };
}

async function maybeReturnExistingEvent(
  admin: ServiceClient,
  workspaceId: string,
  priceSheetId: string,
  origin: string | null,
): Promise<Response | null> {
  const { data: eventRows, error } = await admin.from("qb_price_change_events")
    .select("id, price_sheet_id, status, stream_kind, publish_group_id")
    .eq("workspace_id", workspaceId).eq("price_sheet_id", priceSheetId)
    .order("stream_kind", { ascending: true });
  if (error) {
    throw new Error(`Failed to inspect existing event: ${error.message}`);
  }
  const events = (eventRows ?? []) as JsonObject[];
  if (!events.length) return null;
  const statuses = new Set(events.map((event) => String(event.status ?? "")));
  // building/failed → rebuildable; let the caller proceed to (re)build.
  if ([...statuses].some((status) => ["building", "failed"].includes(status))) {
    return null;
  }
  // superseded → a newer sheet replaced this event. Don't silently rebuild
  // (unique(price_sheet_id) + ON DELETE CASCADE make that destructive); return
  // an explicit, honest result instead of a misleading 0-impact "idempotent
  // success".
  if (statuses.has("superseded")) {
    return safeJsonError(
      "This price sheet's publish was superseded by a newer sheet. Re-extract the sheet to publish it again.",
      409,
      origin,
    );
  }
  // active/closed → genuine idempotent hit; report the existing event.
  const eventIds = events.map((event) => String(event.id));
  const eventIdByStream = Object.fromEntries(events.map((event) => [
    String(event.stream_kind ?? "price_book"),
    String(event.id),
  ]));
  const eventId = eventIdByStream.price_book ?? eventIds[0];
  const { data: impacts } = await admin.from("qb_quote_reprice_impacts").select(
    "total_delta_cents, state",
  ).in("event_id", eventIds);
  const { data: items } = await admin.from("qb_price_change_items").select(
    "change_kind, item_type",
  ).in("event_id", eventIds);
  const programTypes = ["rebate", "incentive", "freight"];
  const changedItems = ((items ?? []) as JsonObject[]).filter((item) =>
    String(item.change_kind ?? "") !== "unchanged"
  );
  // Exclude quiet/dismissed/superseded; only the rep-visible states count as
  // "material", matching handleRepImpacts.
  const material = ((impacts ?? []) as JsonObject[]).filter((impact) =>
    ["visible", "draft_created", "approval_pending", "approved"].includes(
      String(impact.state ?? ""),
    )
  );
  return safeJsonOk({
    ok: true,
    eventId,
    eventIds: eventIdByStream,
    publishGroupId: firstString(events[0]?.publish_group_id),
    priceSheetId,
    idempotent: true,
    // Count only changed items (exclude 'unchanged'), and split programs out
    // rather than hardcoding 0, so the idempotent response matches the
    // fresh-publish response.
    itemsApplied: changedItems.filter((item) =>
      !programTypes.includes(String(item.item_type))
    ).length,
    programsApplied: changedItems.filter((item) =>
      programTypes.includes(String(item.item_type))
    ).length,
    materialQuotesAffected: material.length,
    totalDeltaCents: material.reduce(
      (sum, impact) =>
        sum + Number(impact.total_delta_cents ?? 0),
      0,
    ),
  }, origin);
}

async function invokePublish(
  ctx: AuthContext,
  priceSheetId: string,
  autoApprove: boolean,
): Promise<{ itemsApplied: number; programsApplied: number }> {
  const { data, error } = await ctx.callerClient.functions.invoke(
    "publish-price-sheet",
    { body: { priceSheetId, auto_approve: autoApprove } },
  );
  if (error) throw new Error(`publish-price-sheet failed: ${error.message}`);
  const payload = asObject(data);
  const itemsSkipped = Number(payload.itemsSkipped ?? 0);
  const programsSkipped = Number(payload.programsSkipped ?? 0);
  if (itemsSkipped !== 0 || programsSkipped !== 0) {
    throw new Error(
      `Atomic price-sheet publish reported partial work (${itemsSkipped} items, ${programsSkipped} programs skipped)`,
    );
  }
  return {
    itemsApplied: Number(payload.itemsApplied ?? 0),
    programsApplied: Number(payload.programsApplied ?? 0),
  };
}

async function pinResolvedLineage(
  admin: ServiceClient,
  preview: PreviewBuild,
): Promise<void> {
  const lineage = preview.streams.map((stream) => ({
    lane: stream.streamKind,
    predecessorPriceSheetId: stream.priorPriceSheetId,
  }));
  const { error } = await admin.rpc("pin_qb_price_sheet_lineage", {
    p_workspace_id: preview.sheet.workspace_id,
    p_price_sheet_id: preview.sheet.id,
    p_lineage: lineage,
  });
  if (error) {
    throw new Error(`Failed to pin price-sheet lineage: ${error.message}`);
  }
}

class OemScanConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OemScanConflictError";
  }
}

interface PersistedEventGroup {
  eventId: string;
  eventIds: Record<string, string>;
  publishGroupId: string;
}

async function persistEvent(
  ctx: AuthContext,
  preview: PreviewBuild,
): Promise<PersistedEventGroup> {
  const sourceMetadata = {
    sheet_status_at_scan: preview.sheet.status,
    scan_complete: preview.scanEvidence.scanComplete,
    scan_started_at: preview.scanEvidence.scanStartedAt,
    scan_completed_at: preview.scanEvidence.scanCompletedAt,
    candidate_quote_count: preview.scanEvidence.candidateQuoteCount,
    candidate_line_count: preview.scanEvidence.candidateLineCount,
    quote_page_count: preview.scanEvidence.quotePageCount,
    line_page_count: preview.scanEvidence.linePageCount,
    quote_pricing_epoch: preview.scanEvidence.quotePricingEpoch,
    canonical_diff_item_count: preview.itemDiffs.length,
    stream_kinds: preview.streams.map((stream) => stream.streamKind),
  };
  const publishGroupId = crypto.randomUUID();
  const { data, error } = await ctx.admin.rpc(
    "persist_qb_oem_price_change_event",
    {
      p_workspace_id: preview.sheet.workspace_id,
      p_brand_id: preview.sheet.brand_id,
      p_price_sheet_id: preview.sheet.id,
      p_publish_group_id: publishGroupId,
      p_created_by: ctx.userId,
      p_source_metadata: sourceMetadata,
      p_effective_date: preview.sheet.effective_from,
      p_quote_pricing_epoch: preview.scanEvidence.quotePricingEpoch,
      p_materiality_rule: {
        line_pct_gt: MATERIALITY_LINE_PCT_GT,
        quote_delta_cents_gt: MATERIALITY_QUOTE_DELTA_CENTS_GT,
      },
      p_approval_policy: APPROVAL_POLICY,
      p_streams: preview.streams,
    },
  );
  if (error) {
    const message = error.message ?? "Atomic OEM event persistence failed";
    if (
      error.code === "40001" || message.includes("OEM_SCAN_CONFLICT") ||
      message.includes("predecessor changed") ||
      message.includes("epoch changed") ||
      message.includes("stream changed")
    ) {
      throw new OemScanConflictError(message);
    }
    throw new Error(`Atomic OEM event persistence failed: ${message}`);
  }
  const payload = asObject(data);
  const eventIdsPayload = asObject(payload.event_ids ?? payload.eventIds);
  const eventIds = Object.fromEntries(
    Object.entries(eventIdsPayload).flatMap(([stream, value]) => {
      const id = firstString(value);
      return id ? [[stream, id]] : [];
    }),
  );
  const eventId = firstString(
    payload.event_id,
    payload.eventId,
    eventIds.price_book,
    Object.values(eventIds)[0],
  );
  if (!eventId) throw new Error("Atomic OEM persistence returned no event id");
  return {
    eventId,
    eventIds,
    publishGroupId: firstString(
      payload.publish_group_id,
      payload.publishGroupId,
      publishGroupId,
    )!,
  };
}

async function handlePreview(
  ctx: AuthContext,
  req: Request,
): Promise<Response> {
  if (!["admin", "manager", "owner"].includes(ctx.role)) {
    return safeJsonError(
      "OEM price feed preview requires admin, manager, or owner role",
      403,
      ctx.origin,
    );
  }
  const body = await req.json().catch(() => ({}));
  const priceSheetId = typeof body.priceSheetId === "string"
    ? body.priceSheetId
    : null;
  if (!priceSheetId) {
    return safeJsonError("priceSheetId required", 400, ctx.origin);
  }
  return safeJsonOk(
    previewPayload(
      await buildPreview(ctx.admin, priceSheetId, ctx.workspaceId),
    ),
    ctx.origin,
  );
}

async function handlePublish(
  ctx: AuthContext,
  req: Request,
): Promise<Response> {
  if (!["admin", "manager", "owner"].includes(ctx.role)) {
    return safeJsonError(
      "OEM price feed publish requires admin, manager, or owner role",
      403,
      ctx.origin,
    );
  }
  const body = await req.json().catch(() => ({}));
  const priceSheetId = typeof body.priceSheetId === "string"
    ? body.priceSheetId
    : null;
  if (!priceSheetId) {
    return safeJsonError("priceSheetId required", 400, ctx.origin);
  }
  const existing = await maybeReturnExistingEvent(
    ctx.admin,
    ctx.workspaceId,
    priceSheetId,
    ctx.origin,
  );
  if (existing) return existing;
  let preview = await buildPreview(ctx.admin, priceSheetId, ctx.workspaceId);
  if (!["extracted", "published"].includes(preview.sheet.status)) {
    return safeJsonError(
      `Sheet must be extracted or already published before OEM publish; got ${preview.sheet.status}`,
      409,
      ctx.origin,
    );
  }
  // Persist fallback resolution before any catalog mutation. Replays and event
  // rebuilds then compare against the exact same predecessor.
  await pinResolvedLineage(ctx.admin, preview);
  const didPublish = preview.sheet.status !== "published";
  const publishCounts = didPublish
    ? await invokePublish(ctx, priceSheetId, body.autoApprovePending !== false)
    : { itemsApplied: 0, programsApplied: 0 };
  if (didPublish) {
    // Rebuild from the now-published, approved/applied row set. This matters
    // when autoApprovePending=false: the event must never include a candidate
    // row that publish-price-sheet did not actually apply.
    preview = await buildPreview(ctx.admin, priceSheetId, ctx.workspaceId);
  }
  let persisted: PersistedEventGroup;
  try {
    persisted = await persistEvent(ctx, preview);
  } catch (error) {
    if (!(error instanceof OemScanConflictError)) throw error;
    // One bounded retry closes the normal race where a rep saved a quote after
    // the read-only scan but before the transaction acquired quote locks.
    preview = await buildPreview(ctx.admin, priceSheetId, ctx.workspaceId);
    try {
      persisted = await persistEvent(ctx, preview);
    } catch (retryError) {
      if (!(retryError instanceof OemScanConflictError)) throw retryError;
      return safeJsonError(
        "A quote changed while OEM impacts were being scanned. No impact rows or requote flags were committed; retry publish.",
        409,
        ctx.origin,
      );
    }
  }
  const material = preview.impacts.filter((impact) =>
    impact.state === "visible"
  );
  const changedItemCount =
    preview.itemDiffs.filter((item) => item.changeKind !== "unchanged").length;
  return safeJsonOk({
    ok: true,
    eventId: persisted.eventId,
    eventIds: persisted.eventIds,
    publishGroupId: persisted.publishGroupId,
    priceSheetId,
    // When we actually invoked publish, report its true applied count (even 0)
    // rather than masking a real zero with the changed-item count. When the
    // sheet was already published we skip publish, so report the changed-item
    // count as informational scope.
    itemsApplied: didPublish ? publishCounts.itemsApplied : changedItemCount,
    programsApplied: publishCounts.programsApplied,
    materialQuotesAffected: material.length,
    totalDeltaCents: material.reduce(
      (sum, impact) => sum + impact.totalDeltaCents,
      0,
    ),
  }, ctx.origin);
}

const ACTIVE_IMPACT_STATES = [
  "visible",
  "draft_created",
  "approval_pending",
  "approved",
  "applied",
];
const IMPACT_ENRICHMENT_SELECT =
  "*, qb_quote_reprice_impact_lines(*), qb_quote_reprice_drafts(id,status,approval_case_id,applied_at,reversed_at), qb_price_change_events!inner(status,stream_kind,publish_group_id)";

function joinedDealForAssignment(quote: JsonObject): JsonObject | null {
  const joined = Array.isArray(quote.crm_deals)
    ? quote.crm_deals[0]
    : quote.crm_deals;
  return joined && typeof joined === "object" ? asObject(joined) : null;
}

async function loadCurrentQuoteAssignees(
  admin: ServiceClient,
  workspaceId: string,
  quoteIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const uniqueIds = [...new Set(quoteIds)].sort();
  const ID_CHUNK = 200;
  for (let index = 0; index < uniqueIds.length; index += ID_CHUNK) {
    const batch = uniqueIds.slice(index, index + ID_CHUNK);
    const collection = await loadAllById<IdJsonObject>(
      (afterId, limit) => {
        let query = admin.from("quote_packages").select(
          "id, workspace_id, deal_id, created_by, crm_deals(id,workspace_id,assigned_rep_id,deleted_at)",
        ).eq("workspace_id", workspaceId).in("id", batch).order("id", {
          ascending: true,
        }).limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return query;
      },
      "current quote assignment",
    );
    for (const quote of collection.rows) {
      const deal = joinedDealForAssignment(quote);
      result.set(
        quote.id,
        currentQuoteAssignedRepId({
          workspaceId,
          dealId: firstString(quote.deal_id),
          createdBy: firstString(quote.created_by),
          deal: deal
            ? {
              workspaceId: firstString(deal.workspace_id),
              assignedRepId: firstString(deal.assigned_rep_id),
              deletedAt: firstString(deal.deleted_at),
            }
            : null,
        }),
      );
    }
  }
  return result;
}

async function loadEnrichedImpacts(
  ctx: AuthContext,
  authorizedImpactIds?: string[],
): Promise<IdJsonObject[]> {
  if (authorizedImpactIds && !authorizedImpactIds.length) return [];
  const idBatches = authorizedImpactIds
    ? Array.from(
      { length: Math.ceil(authorizedImpactIds.length / 200) },
      (_, index) => authorizedImpactIds.slice(index * 200, (index + 1) * 200),
    )
    : [null];
  const result: IdJsonObject[] = [];
  for (const batch of idBatches) {
    const collection = await loadAllById<IdJsonObject>((afterId, limit) => {
      let query = ctx.admin.from("qb_quote_reprice_impacts").select(
        IMPACT_ENRICHMENT_SELECT,
      ).eq("workspace_id", ctx.workspaceId).eq(
        "qb_price_change_events.status",
        "active",
      ).in("state", ACTIVE_IMPACT_STATES).order("id", { ascending: true })
        .limit(limit);
      if (batch) query = query.in("id", batch);
      if (afterId) query = query.gt("id", afterId);
      return query;
    }, "enriched rep impacts");
    result.push(...collection.rows);
  }
  return result;
}

async function attachAuthorizedRepriceHistory(
  ctx: AuthContext,
  impacts: IdJsonObject[],
): Promise<IdJsonObject[]> {
  if (!impacts.length) return impacts;
  const impactIds = impacts.map((impact) => impact.id);
  const audits: IdJsonObject[] = [];
  for (let index = 0; index < impactIds.length; index += 200) {
    const batch = impactIds.slice(index, index + 200);
    const collection = await loadAllById<IdJsonObject>((afterId, limit) => {
      let query = ctx.admin.from("qb_quote_reprice_audits").select(
        "id,impact_id,action,apply_audit_id,draft_id,actor_role,before_version_number,after_version_number,created_at",
      ).eq("workspace_id", ctx.workspaceId).in("impact_id", batch).order("id", {
        ascending: true,
      }).limit(limit);
      if (afterId) query = query.gt("id", afterId);
      return query;
    }, "authorized OEM reprice audit history");
    audits.push(...collection.rows);
  }

  const auditsByImpact = new Map<string, IdJsonObject[]>();
  for (const audit of audits) {
    const impactId = String(audit.impact_id ?? "");
    if (!impactId) continue;
    auditsByImpact.set(impactId, [
      ...(auditsByImpact.get(impactId) ?? []),
      audit,
    ]);
  }
  const now = Date.now();
  return impacts.map((impact) => {
    const impactAudits = auditsByImpact.get(impact.id) ?? [];
    const reversalByApply = new Map<string, string>();
    for (const audit of impactAudits) {
      if (audit.action === "reverse" && typeof audit.apply_audit_id === "string") {
        reversalByApply.set(audit.apply_audit_id, audit.id);
      }
    }
    const drafts = Array.isArray(impact.qb_quote_reprice_drafts)
      ? impact.qb_quote_reprice_drafts.map(asObject)
      : [];
    const appliedDraftIds = new Set(
      drafts.filter((draft) => draft.status === "applied").map((draft) =>
        String(draft.id)
      ),
    );
    const history = impactAudits.map((audit) => {
      const createdAt = typeof audit.created_at === "string"
        ? audit.created_at
        : "";
      const createdAtMs = Date.parse(createdAt);
      const reversalDeadlineMs = Number.isFinite(createdAtMs)
        ? createdAtMs + 7 * 24 * 60 * 60 * 1000
        : Number.NaN;
      const reversedByAuditId = audit.action === "apply"
        ? reversalByApply.get(audit.id) ?? null
        : null;
      return {
        ...audit,
        created_at: createdAt,
        can_reverse: audit.action === "apply" &&
          impact.state === "applied" &&
          appliedDraftIds.has(String(audit.draft_id)) &&
          reversedByAuditId === null &&
          Number.isFinite(reversalDeadlineMs) &&
          now <= reversalDeadlineMs,
        reversal_deadline: Number.isFinite(reversalDeadlineMs)
          ? new Date(reversalDeadlineMs).toISOString()
          : null,
        reversed_by_audit_id: reversedByAuditId,
        customer_communication: "none",
      };
    }).sort((left, right) =>
      Date.parse(String(right.created_at)) - Date.parse(String(left.created_at))
    );
    return { ...impact, reprice_history: history };
  });
}

async function handleRepImpacts(ctx: AuthContext): Promise<Response> {
  if (!["rep", "admin", "manager", "owner"].includes(ctx.role)) {
    return safeJsonError("Forbidden", 403, ctx.origin);
  }
  let impacts: IdJsonObject[];
  try {
    if (ctx.role === "rep") {
      // Phase one intentionally loads no lines/drafts/history. Enrichment is
      // allowed only after current CRM assignment has been checked.
      const scopes = (await loadAllById<IdJsonObject>((afterId, limit) => {
        let query = ctx.admin.from("qb_quote_reprice_impacts").select(
          "id, quote_package_id, qb_price_change_events!inner(status)",
        ).eq("workspace_id", ctx.workspaceId).eq(
          "qb_price_change_events.status",
          "active",
        ).in("state", ACTIVE_IMPACT_STATES).order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return query;
      }, "rep impact authorization scope")).rows;
      const assignees = await loadCurrentQuoteAssignees(
        ctx.admin,
        ctx.workspaceId,
        scopes.map((impact) => String(impact.quote_package_id)),
      );
      const authorizedIds = scopes.filter((impact) =>
        assignees.get(String(impact.quote_package_id)) === ctx.userId
      ).map((impact) => impact.id);
      impacts = await loadEnrichedImpacts(ctx, authorizedIds);
      // Re-check after enrichment so a reassignment between the two reads can
      // only remove data from the response, never expose it to the former rep.
      const currentAssignees = await loadCurrentQuoteAssignees(
        ctx.admin,
        ctx.workspaceId,
        impacts.map((impact) => String(impact.quote_package_id)),
      );
      impacts = impacts.filter((impact) =>
        currentAssignees.get(String(impact.quote_package_id)) === ctx.userId
      );
    } else {
      impacts = await loadEnrichedImpacts(ctx);
    }
    // Audit rows are attached only after current assignment/workspace
    // authorization; a former rep never receives immutable pricing history.
    impacts = await attachAuthorizedRepriceHistory(ctx, impacts);
    // Applied impacts remain operational only for their inclusive seven-day
    // reversal window. They never count in the Today action summary below.
    impacts = impacts.filter((impact) =>
      impact.state !== "applied" ||
      (Array.isArray(impact.reprice_history) &&
        impact.reprice_history.some((entry) =>
          asObject(entry).can_reverse === true
        ))
    );
  } catch (err) {
    return safeJsonError(
      `Failed to load OEM quote impacts: ${errorMessage(err)}`,
      500,
      ctx.origin,
    );
  }
  const actionableImpacts = impacts.filter((impact) => impact.state !== "applied");
  return safeJsonOk({
    summary: {
      visibleImpactCount: actionableImpacts.length,
      affectedQuoteCount: new Set(actionableImpacts.map((impact) =>
        impact.quote_package_id
      )).size,
      totalDeltaCents: actionableImpacts.reduce(
        (sum, impact) => sum + Number(impact.total_delta_cents ?? 0),
        0,
      ),
      needsApprovalCount:
        actionableImpacts.filter((impact) =>
          impact.requires_manager_review === true
        )
          .length,
    },
    impacts,
  }, ctx.origin);
}

async function loadImpactForAction(
  ctx: AuthContext,
  impactId: string,
): Promise<JsonObject> {
  if (!["rep", "admin", "manager", "owner"].includes(ctx.role)) {
    throw new Error("Forbidden");
  }
  const { data: scope, error: scopeError } = await ctx.admin.from(
    "qb_quote_reprice_impacts",
  ).select("id, quote_package_id, qb_price_change_events!inner(status)")
    .eq("id", impactId).eq("workspace_id", ctx.workspaceId)
    .eq("qb_price_change_events.status", "active").maybeSingle();
  if (scopeError) {
    throw new Error(`Failed to load impact: ${scopeError.message}`);
  }
  if (!scope) throw new Error("Impact not found");
  const quotePackageId = String((scope as JsonObject).quote_package_id);
  if (ctx.role === "rep") {
    const assignees = await loadCurrentQuoteAssignees(
      ctx.admin,
      ctx.workspaceId,
      [quotePackageId],
    );
    if (assignees.get(quotePackageId) !== ctx.userId) {
      throw new Error("Forbidden");
    }
  }

  // Fetch line and draft history only after current assignment authorization.
  const { data, error } = await ctx.admin.from("qb_quote_reprice_impacts")
    .select(
      IMPACT_ENRICHMENT_SELECT,
    )
    .eq("id", impactId).eq(
      "workspace_id",
      ctx.workspaceId,
    ).eq("qb_price_change_events.status", "active").maybeSingle();
  if (error) throw new Error(`Failed to load impact: ${error.message}`);
  if (!data) throw new Error("Impact not found");
  const impact = data as JsonObject;
  if (ctx.role === "rep") {
    const assignees = await loadCurrentQuoteAssignees(
      ctx.admin,
      ctx.workspaceId,
      [quotePackageId],
    );
    if (assignees.get(quotePackageId) !== ctx.userId) {
      throw new Error("Forbidden");
    }
  }
  const [withHistory] = await attachAuthorizedRepriceHistory(ctx, [
    impact as IdJsonObject,
  ]);
  return withHistory ?? impact;
}

async function handleDismiss(
  ctx: AuthContext,
  impactId: string,
  req: Request,
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 500) {
    return safeJsonError("reason required (1-500 chars)", 400, ctx.origin);
  }
  let impact: JsonObject;
  try {
    impact = await loadImpactForAction(ctx, impactId);
  } catch (err) {
    return safeJsonError(
      errorMessage(err),
      errorMessage(err) === "Forbidden" ? 403 : 404,
      ctx.origin,
    );
  }
  // State guard: a rep may only dismiss an impact that is still 'visible' (or
  // 'quiet'). Dismissing one already in review/approved would silently discard
  // work and bypass the approval trail — reserve that for a manager/owner.
  const dismissState = String(impact.state ?? "");
  if (dismissState === "dismissed") {
    return safeJsonOk(
      { ok: true, impactId, state: "dismissed", idempotent: true },
      ctx.origin,
    );
  }
  const privileged = ["manager", "owner", "admin"].includes(ctx.role);
  if (!["visible", "quiet"].includes(dismissState) && !privileged) {
    return safeJsonError(
      `Cannot dismiss an impact in state "${dismissState}"; ask a manager to override.`,
      409,
      ctx.origin,
    );
  }
  const { data, error } = await ctx.admin.rpc(
    "dismiss_qb_oem_reprice_impact",
    {
      p_workspace_id: ctx.workspaceId,
      p_impact_id: impactId,
      p_actor_id: ctx.userId,
      p_actor_role: ctx.role,
      p_reason: reason,
    },
  );
  if (error) {
    return safeJsonError(
      `Failed to dismiss impact: ${error.message}`,
      error.code === "42501"
        ? 403
        : error.code === "P0002"
        ? 404
        : error.code === "40001" || error.code === "55000"
        ? 409
        : 500,
      ctx.origin,
    );
  }
  return safeJsonOk({
    ok: true,
    impactId,
    state: "dismissed",
    idempotent: asObject(data).idempotent === true,
  }, ctx.origin);
}

async function handleDraft(
  ctx: AuthContext,
  impactId: string,
  req: Request,
): Promise<Response> {
  let impact: JsonObject;
  try {
    impact = await loadImpactForAction(ctx, impactId);
  } catch (err) {
    return safeJsonError(
      errorMessage(err),
      errorMessage(err) === "Forbidden" ? 403 : 404,
      ctx.origin,
    );
  }
  // The governed RPC owns the active-draft idempotency key. Permit the two
  // post-submit states so a network retry returns its existing draft/case;
  // every terminal/non-actionable state remains blocked here and in SQL.
  const draftState = String(impact.state ?? "");
  if (!["visible", "approval_pending", "approved"].includes(draftState)) {
    return safeJsonError(
      `A reprice draft can only be created from a visible impact; this one is "${draftState}".`,
      409,
      ctx.origin,
    );
  }
  const body = await req.json().catch(() => ({})) as JsonObject;
  const submissionNote = typeof body.submissionNote === "string"
    ? body.submissionNote.trim().slice(0, 1000)
    : typeof body.submission_note === "string"
    ? body.submission_note.trim().slice(0, 1000)
    : "";
  const { data, error } = await ctx.admin.rpc(
    "create_qb_oem_reprice_draft_for_approval",
    {
      p_workspace_id: ctx.workspaceId,
      p_impact_id: impactId,
      p_actor_id: ctx.userId,
      p_actor_role: ctx.role,
      p_submission_note: submissionNote || null,
    },
  );
  if (error) {
    return safeJsonError(
      `Failed to create governed reprice draft: ${error.message}`,
      mutationErrorStatus(error.code),
      ctx.origin,
    );
  }
  const result = asObject(data);
  const idempotent = result.idempotent === true;
  return safeJsonOk(
    {
      ok: true,
      draftId: String(result.draft_id ?? ""),
      approvalCaseId: typeof result.approval_case_id === "string"
        ? result.approval_case_id
        : null,
      status: String(result.status ?? "approval_pending"),
      approvalRequired: result.approval_required !== false,
      approvalReasons: Array.isArray(impact.approval_required_reasons)
        ? impact.approval_required_reasons
        : [],
      emailDraftId: null,
      customerCommunication: "none",
      idempotent,
    },
    ctx.origin,
    idempotent ? 200 : 201,
  );
}

function mutationErrorStatus(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023") return 400;
  if (code === "40001" || code === "55000" || code === "23505") return 409;
  return 500;
}

async function handleApplyDraft(
  ctx: AuthContext,
  draftId: string,
): Promise<Response> {
  const { data: draft, error } = await ctx.admin.from("qb_quote_reprice_drafts")
    .select("id, created_by, workspace_id").eq("id", draftId).eq(
      "workspace_id",
      ctx.workspaceId,
    ).maybeSingle();
  if (error) {
    return safeJsonError(
      `Failed to load draft: ${error.message}`,
      500,
      ctx.origin,
    );
  }
  if (!draft) return safeJsonError("Draft not found", 404, ctx.origin);
  if (ctx.role === "rep" && (draft as JsonObject).created_by !== ctx.userId) {
    return safeJsonError("Forbidden", 403, ctx.origin);
  }
  const { data, error: applyError } = await ctx.admin.rpc(
    "apply_qb_oem_reprice_draft",
    {
      p_workspace_id: ctx.workspaceId,
      p_draft_id: draftId,
      p_actor_id: ctx.userId,
      p_actor_role: ctx.role,
    },
  );
  if (applyError) {
    return safeJsonError(
      `Failed to apply governed reprice draft: ${applyError.message}`,
      mutationErrorStatus(applyError.code),
      ctx.origin,
    );
  }
  return safeJsonOk(data, ctx.origin);
}

async function handleReverseApply(
  ctx: AuthContext,
  applyAuditId: string,
): Promise<Response> {
  const { data, error } = await ctx.admin.rpc(
    "reverse_qb_oem_reprice_apply",
    {
      p_workspace_id: ctx.workspaceId,
      p_apply_audit_id: applyAuditId,
      p_actor_id: ctx.userId,
      p_actor_role: ctx.role,
    },
  );
  if (error) {
    return safeJsonError(
      `Failed to reverse governed OEM re-price: ${error.message}`,
      mutationErrorStatus(error.code),
      ctx.origin,
    );
  }
  return safeJsonOk(data, ctx.origin);
}

function routeParts(req: Request): string[] {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("oem-price-feeds");
  return idx >= 0 ? parts.slice(idx + 1) : parts.slice(-1);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  try {
    const auth = await requireServiceUser(
      req.headers.get("Authorization"),
      origin,
    );
    if (!auth.ok) return auth.response;
    const ctx: AuthContext = {
      userId: auth.userId,
      role: auth.role,
      workspaceId: auth.workspaceId,
      callerClient: auth.supabase as ServiceClient,
      admin: createAdminClient(),
      origin,
    };
    const [first, second, third] = routeParts(req);
    if (req.method === "POST" && first === "preview") {
      return await handlePreview(ctx, req);
    }
    if (req.method === "POST" && first === "publish") {
      return await handlePublish(ctx, req);
    }
    if (req.method === "GET" && first === "rep-impacts") {
      return await handleRepImpacts(ctx);
    }
    if (
      req.method === "POST" && first === "impacts" && second &&
      third === "dismiss"
    ) return await handleDismiss(ctx, second, req);
    if (
      req.method === "POST" && first === "impacts" && second &&
      third === "draft"
    ) return await handleDraft(ctx, second, req);
    if (
      req.method === "POST" && first === "drafts" && second && third === "apply"
    ) return await handleApplyDraft(ctx, second);
    if (
      req.method === "POST" && first === "applies" && second &&
      third === "reverse"
    ) return await handleReverseApply(ctx, second);
    return safeJsonError("Not found", 404, origin);
  } catch (err) {
    console.error("[oem-price-feeds]", err);
    const message = errorMessage(err);
    const status = message.includes("outside caller workspace")
      ? 403
      : message.toLowerCase().includes("not found")
      ? 404
      : 500;
    return safeJsonError(message, status, origin);
  }
});
