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

const OPEN_QUOTE_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "approved_with_conditions",
  "changes_requested",
  "ready",
  "sent",
  "viewed",
  "expiring",
];
const OEM_REQUOTE_REASON =
  "OEM price update created a material reprice impact for this quote.";
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

interface AuthContext {
  userId: string;
  role: string;
  workspaceId: string;
  callerClient: ServiceClient;
  admin: ServiceClient;
  origin: string | null;
}

interface PriceSheetRow {
  id: string;
  workspace_id: string;
  brand_id: string;
  status: string;
  sheet_type: string | null;
  effective_from: string | null;
  supersedes_price_sheet_id?: string | null;
}

interface ItemDiff {
  itemType: "list_price" | "freight" | "rebate" | "incentive";
  modelCode: string | null;
  normalizedCode: string | null;
  nameDisplay: string | null;
  oldPriceCents: number | null;
  newPriceCents: number | null;
  deltaCents: number;
  deltaPct: number | null;
  changeKind: "new" | "removed" | "increased" | "decreased" | "unchanged";
  priorItemId: string | null;
  newItemId: string | null;
  metadata: JsonObject;
}

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
  state: "quiet" | "visible";
  lines: ImpactLineDraft[];
}

interface PreviewBuild {
  sheet: PriceSheetRow;
  priorPriceSheetId: string | null;
  itemDiffs: ItemDiff[];
  impacts: ImpactDraft[];
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
function changeKind(
  oldPrice: number | null,
  newPrice: number | null,
): ItemDiff["changeKind"] {
  if (oldPrice === null && newPrice !== null) return "new";
  if (oldPrice !== null && newPrice === null) return "removed";
  if (oldPrice === null || newPrice === null || oldPrice === newPrice) {
    return "unchanged";
  }
  return newPrice > oldPrice ? "increased" : "decreased";
}
function diffOldPrice(item: JsonObject): number | null {
  const diff = asObject(item.diff);
  const lp = asObject(
    diff.list_price_cents ?? diff.listPriceCents ?? diff.list_price,
  );
  return firstCents(lp.old, lp.from, lp.previous);
}

async function loadSheet(
  admin: ServiceClient,
  priceSheetId: string,
): Promise<PriceSheetRow> {
  const { data, error } = await admin.from("qb_price_sheets").select(
    "id, workspace_id, brand_id, status, sheet_type, effective_from, supersedes_price_sheet_id",
  ).eq("id", priceSheetId).maybeSingle();
  if (error) throw new Error(`Failed to load price sheet: ${error.message}`);
  if (!data) throw new Error("Price sheet not found");
  return data as PriceSheetRow;
}

async function loadPriorPriceSheetId(
  admin: ServiceClient,
  sheet: PriceSheetRow,
): Promise<string | null> {
  if (sheet.supersedes_price_sheet_id) return sheet.supersedes_price_sheet_id;
  const { data, error } = await admin.from("qb_price_sheets").select("id").eq(
    "workspace_id",
    sheet.workspace_id,
  ).eq("brand_id", sheet.brand_id).eq("status", "published").neq("id", sheet.id)
    .order("published_at", { ascending: false, nullsFirst: false }).limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load prior price sheet: ${error.message}`);
  }
  return (data as { id?: string } | null)?.id ?? null;
}

async function buildItemDiffs(
  admin: ServiceClient,
  sheet: PriceSheetRow,
): Promise<ItemDiff[]> {
  const { data: items, error } = await admin.from("qb_price_sheet_items")
    .select(
      "id, item_type, extracted, proposed_model_id, proposed_attachment_id, action, diff",
    ).eq("price_sheet_id", sheet.id);
  if (error) {
    throw new Error(`Failed to load price-sheet items: ${error.message}`);
  }
  const modelItems = (items ?? []).filter((item: JsonObject) =>
    item.item_type === "model"
  ) as JsonObject[];

  const existingByCode = new Map<string, JsonObject>();
  if (modelItems.length) {
    const { data: models, error: modelErr } = await admin.from(
      "qb_equipment_models",
    ).select("id, model_code, name_display, list_price_cents").eq(
      "workspace_id",
      sheet.workspace_id,
    ).eq("brand_id", sheet.brand_id).limit(5000);
    if (modelErr) {
      throw new Error(
        `Failed to load existing model prices: ${modelErr.message}`,
      );
    }
    for (const model of (models ?? []) as JsonObject[]) {
      const code = normalizeModelCode(model.model_code);
      if (code) existingByCode.set(code, model);
    }
  }

  const diffs: ItemDiff[] = [];
  for (const item of modelItems) {
    const extracted = asObject(item.extracted);
    const modelCode = firstString(
      extracted.model_code,
      extracted.modelCode,
      extracted.model,
    );
    const normalizedCode = normalizeModelCode(modelCode);
    const existing = normalizedCode
      ? existingByCode.get(normalizedCode)
      : undefined;
    const oldPrice = diffOldPrice(item) ??
      firstCents(existing?.list_price_cents);
    const newPrice = firstCents(
      extracted.list_price_cents,
      extracted.listPriceCents,
      extracted.price_cents,
    );
    const delta = (newPrice ?? 0) - (oldPrice ?? 0);
    diffs.push({
      itemType: "list_price",
      modelCode,
      normalizedCode,
      nameDisplay: firstString(
        extracted.name_display,
        extracted.name,
        existing?.name_display,
      ),
      oldPriceCents: oldPrice,
      newPriceCents: newPrice,
      deltaCents: delta,
      deltaPct: deltaPct(oldPrice, newPrice),
      changeKind: changeKind(oldPrice, newPrice),
      priorItemId: typeof existing?.id === "string" ? existing.id : null,
      newItemId: typeof item.id === "string" ? item.id : null,
      metadata: { action: item.action ?? null, source: "qb_price_sheet_items" },
    });
  }

  const { data: programs } = await admin.from("qb_price_sheet_programs").select(
    "id, program_code, program_type, action, extracted",
  ).eq("price_sheet_id", sheet.id);
  for (const program of (programs ?? []) as JsonObject[]) {
    const programType = String(program.program_type ?? "");
    const itemType: ItemDiff["itemType"] =
      programType.includes("rebate") || programType.includes("cash")
        ? "rebate"
        : "incentive";
    diffs.push({
      itemType,
      modelCode: null,
      normalizedCode: null,
      nameDisplay: firstString(
        program.program_code,
        asObject(program.extracted).name,
      ),
      oldPriceCents: null,
      newPriceCents: null,
      deltaCents: 0,
      deltaPct: null,
      changeKind: program.action === "create" ? "new" : "unchanged",
      priorItemId: null,
      newItemId: typeof program.id === "string" ? program.id : null,
      metadata: {
        program_type: program.program_type ?? null,
        action: program.action ?? null,
        source: "qb_price_sheet_programs",
      },
    });
  }
  return diffs;
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

async function buildQuoteImpacts(
  admin: ServiceClient,
  sheet: PriceSheetRow,
  itemDiffs: ItemDiff[],
): Promise<ImpactDraft[]> {
  const listPriceDiffs = itemDiffs.filter((diff) =>
    diff.itemType === "list_price" && diff.normalizedCode &&
    diff.newPriceCents !== null
  );
  if (!listPriceDiffs.length) return [];
  const byCode = new Map<string, ItemDiff>();
  for (const diff of listPriceDiffs) byCode.set(diff.normalizedCode!, diff);
  const marginFloorPct = await loadMarginFloor(
    admin,
    sheet.workspace_id,
    sheet.brand_id,
  );

  const { data: quotes, error: quoteErr } = await admin.from("quote_packages")
    .select(
      "id, workspace_id, deal_id, status, updated_at, equipment, net_total, margin_amount, margin_pct, created_by, crm_deals(assigned_rep_id)",
    ).eq("workspace_id", sheet.workspace_id).in("status", OPEN_QUOTE_STATUSES)
    .limit(1000);
  if (quoteErr) {
    throw new Error(`Failed to load open quotes: ${quoteErr.message}`);
  }

  const quoteIds = ((quotes ?? []) as JsonObject[]).map((quote) =>
    String(quote.id)
  );
  const linesByQuote = new Map<string, JsonObject[]>();
  if (quoteIds.length) {
    const { data: lineRows, error: lineErr } = await admin.from(
      "quote_package_line_items",
    ).select("*").in("quote_package_id", quoteIds);
    if (lineErr) {
      throw new Error(`Failed to load quote line items: ${lineErr.message}`);
    }
    for (const row of (lineRows ?? []) as JsonObject[]) {
      const quoteId = String(row.quote_package_id);
      const list = linesByQuote.get(quoteId) ?? [];
      list.push(row);
      linesByQuote.set(quoteId, list);
    }
  }

  const impacts: ImpactDraft[] = [];
  for (const quote of (quotes ?? []) as JsonObject[]) {
    const quoteId = String(quote.id);
    const sourceLines = linesByQuote.get(quoteId)?.length
      ? linesByQuote.get(quoteId)!
      : quoteLinesFromLegacyEquipment(quote);
    const impactLines: ImpactLineDraft[] = [];
    let proposedTotalDeltaCents = 0;
    let maxAbsLinePct = 0;
    let anyStockLocked = false;
    let allLineCostBasisCents = 0;
    // Whole-quote cost basis is only trustworthy if EVERY line carries a cost.
    // If any line lacks one, the summed basis understates true cost and would
    // overstate projected margin/commission, so we fall through to null
    // ("missing_cost_basis") rather than show a wrong number.
    let everyLineHasCost = sourceLines.length > 0;

    for (const line of sourceLines) {
      const quantity = Math.max(1, Number(line.quantity ?? 1) || 1);
      const lineCost = quoteLineCostCents(line);
      if (lineCost === null) {
        everyLineHasCost = false;
      } else {
        allLineCostBasisCents += lineCost * quantity;
      }
    }

    for (const line of sourceLines) {
      const modelCode = firstString(
        line.model,
        line.model_code,
        line.modelCode,
      );
      const normalized = normalizeModelCode(modelCode);
      if (!normalized) continue;
      const diff = byCode.get(normalized);
      if (!diff || diff.newPriceCents === null) continue;
      const quantity = Math.max(1, Number(line.quantity ?? 1) || 1);
      const oldListPrice = quoteLinePriceCents(line) ?? diff.oldPriceCents;
      // No prior price to compare against: we can't book a reprice delta, and
      // charging the full new price as the "delta" would falsely trip
      // materiality and inflate the rep-facing exposure. Skip the line.
      if (oldListPrice === null) continue;
      const newListPrice = diff.newPriceCents;
      const lineDelta = (newListPrice - oldListPrice) * quantity;
      const pct = deltaPct(oldListPrice, newListPrice);
      const stockLocked = isStockLockedLine({
        sourceLocation: line.source_location,
        isYardStock: line.is_yard_stock,
      });
      if (stockLocked) {
        anyStockLocked = true;
      } else {
        proposedTotalDeltaCents += lineDelta;
        // Only non-stock-locked lines drive materiality (OEM-DP8: a yard-stock
        // line's dollar delta is suppressed, so it must not flip a quote to
        // "visible" on pct alone). Use FULL-PRECISION pct for the threshold —
        // deltaPct() rounds to 2dp for display/storage, which would let a real
        // +2.004% round to 2.00 and read as quiet.
        const rawPct = oldListPrice !== 0
          ? ((newListPrice - oldListPrice) / oldListPrice) * 100
          : null;
        if (rawPct !== null) {
          maxAbsLinePct = Math.max(maxAbsLinePct, Math.abs(rawPct));
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
        metadata: {
          normalized_code: normalized,
          source: line._legacy
            ? "quote_packages.equipment"
            : "quote_package_line_items",
        },
      });
    }
    if (!impactLines.length) continue;

    const trigger = classifyMateriality({
      maxAbsLineDeltaPct: maxAbsLinePct,
      totalDeltaCents: proposedTotalDeltaCents,
    });
    const oldNetTotalCents = firstDollarsAsCents(quote.net_total);
    const oldMarginCents = firstDollarsAsCents(quote.margin_amount);
    const oldMarginPct = parseStoredPercent(quote.margin_pct);
    const costBasisCents = oldNetTotalCents !== null && oldMarginCents !== null
      ? oldNetTotalCents - oldMarginCents
      : everyLineHasCost
      ? allLineCostBasisCents
      : null;
    const policyRequiresReview = true;
    const gate = evaluateMarginGate({
      oldNetTotalCents,
      totalDeltaCents: proposedTotalDeltaCents,
      oldMarginPct,
      oldMarginCents,
      costBasisCents,
      marginFloorPct,
      policyRequiresManagerReview: policyRequiresReview,
      stockLocked: anyStockLocked,
    });
    const joinedDeal = Array.isArray(quote.crm_deals)
      ? quote.crm_deals[0]
      : quote.crm_deals;
    const assignedRepId = firstString(
      asObject(joinedDeal).assigned_rep_id,
      quote.created_by,
    );
    impacts.push({
      quotePackageId: quoteId,
      dealId: firstString(quote.deal_id),
      assignedRepId,
      quoteStatusSnapshot: firstString(quote.status),
      quoteUpdatedAtSnapshot: firstString(quote.updated_at),
      totalDeltaCents: proposedTotalDeltaCents,
      maxLineDeltaPct: maxAbsLinePct || null,
      oldMarginPct: gate.oldMarginPct,
      projectedMarginPct: gate.projectedMarginPct,
      marginFloorPct: gate.marginFloorPct,
      belowMarginFloor: gate.belowMarginFloor,
      materialityTrigger: trigger,
      requiresManagerReview: gate.requiresManagerReview,
      approvalRequiredReasons: gate.approvalRequiredReasons,
      oldCommissionCents: gate.oldCommissionCents,
      projectedCommissionCents: gate.projectedCommissionCents,
      commissionDeltaCents: gate.commissionDeltaCents,
      state: impactStateFor(trigger),
      lines: impactLines,
    });
  }
  return impacts;
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
  const priorPriceSheetId = await loadPriorPriceSheetId(admin, sheet);
  const itemDiffs = await buildItemDiffs(admin, sheet);
  const impacts = await buildQuoteImpacts(admin, sheet, itemDiffs);
  return { sheet, priorPriceSheetId, itemDiffs, impacts };
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
  priceSheetId: string,
  origin: string | null,
): Promise<Response | null> {
  const { data: event, error } = await admin.from("qb_price_change_events")
    .select("id, price_sheet_id, status").eq("price_sheet_id", priceSheetId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to inspect existing event: ${error.message}`);
  }
  if (!event) return null;
  const status = String((event as JsonObject).status ?? "");
  // building/failed → rebuildable; let the caller proceed to (re)build.
  if (["building", "failed"].includes(status)) return null;
  // superseded → a newer sheet replaced this event. Don't silently rebuild
  // (unique(price_sheet_id) + ON DELETE CASCADE make that destructive); return
  // an explicit, honest result instead of a misleading 0-impact "idempotent
  // success".
  if (status === "superseded") {
    return safeJsonError(
      "This price sheet's publish was superseded by a newer sheet. Re-extract the sheet to publish it again.",
      409,
      origin,
    );
  }
  // active/closed → genuine idempotent hit; report the existing event.
  const eventId = String((event as JsonObject).id);
  const { data: impacts } = await admin.from("qb_quote_reprice_impacts").select(
    "total_delta_cents, state",
  ).eq("event_id", eventId);
  const { data: items } = await admin.from("qb_price_change_items").select(
    "change_kind, item_type",
  ).eq("event_id", eventId);
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
      (sum, impact) => sum + Number(impact.total_delta_cents ?? 0),
      0,
    ),
  }, origin);
}

async function clearRebuildableEvent(
  admin: ServiceClient,
  priceSheetId: string,
): Promise<void> {
  const { data: event } = await admin.from("qb_price_change_events").select(
    "id, status",
  ).eq("price_sheet_id", priceSheetId).maybeSingle();
  if (!event) return;
  const status = String((event as JsonObject).status ?? "");
  if (status !== "building" && status !== "failed") return;
  await admin.from("qb_price_change_events").delete().eq(
    "id",
    String((event as JsonObject).id),
  );
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
  return {
    itemsApplied: Number(payload.itemsApplied ?? 0),
    programsApplied: Number(payload.programsApplied ?? 0),
  };
}

async function persistEvent(
  ctx: AuthContext,
  preview: PreviewBuild,
): Promise<string> {
  const { admin, userId } = ctx;
  await clearRebuildableEvent(admin, preview.sheet.id);
  const { data: priorActiveEvents, error: priorActiveErr } = await admin.from(
    "qb_price_change_events",
  ).select("id").eq("workspace_id", preview.sheet.workspace_id).eq(
    "brand_id",
    preview.sheet.brand_id,
  ).eq("status", "active");
  if (priorActiveErr) {
    throw new Error(
      `Failed to inspect active OEM events: ${priorActiveErr.message}`,
    );
  }
  const priorActiveEventIds = ((priorActiveEvents ?? []) as JsonObject[]).map((
    event,
  ) => String(event.id));

  const { data: event, error: eventErr } = await admin.from(
    "qb_price_change_events",
  ).insert({
    workspace_id: preview.sheet.workspace_id,
    brand_id: preview.sheet.brand_id,
    price_sheet_id: preview.sheet.id,
    prior_price_sheet_id: preview.priorPriceSheetId,
    source_type: "manual_upload",
    source_metadata: { sheet_status_at_preview: preview.sheet.status },
    effective_date: preview.sheet.effective_from,
    materiality_rule: {
      line_pct_gt: MATERIALITY_LINE_PCT_GT,
      quote_delta_cents_gt: MATERIALITY_QUOTE_DELTA_CENTS_GT,
    },
    approval_policy: APPROVAL_POLICY,
    status: "building",
    created_by: userId,
    published_at: new Date().toISOString(),
  }).select("id").single();
  if (eventErr || !event) {
    throw new Error(
      `Failed to create price-change event: ${eventErr?.message ?? "unknown"}`,
    );
  }
  const eventId = String((event as JsonObject).id);

  try {
    if (preview.itemDiffs.length) {
      const { error: itemErr } = await admin.from("qb_price_change_items")
        .insert(preview.itemDiffs.map((diff) => ({
          event_id: eventId,
          workspace_id: preview.sheet.workspace_id,
          item_type: diff.itemType,
          model_code: diff.modelCode,
          normalized_code: diff.normalizedCode,
          name_display: diff.nameDisplay,
          old_price_cents: diff.oldPriceCents,
          new_price_cents: diff.newPriceCents,
          delta_cents: diff.deltaCents,
          delta_pct: diff.deltaPct,
          change_kind: diff.changeKind,
          prior_item_id: diff.priorItemId,
          new_item_id: diff.newItemId,
          metadata: diff.metadata,
        })));
      if (itemErr) {
        throw new Error(
          `Failed to persist price-change items: ${itemErr.message}`,
        );
      }
    }

    for (const impact of preview.impacts) {
      const { data: impactRow, error: impactErr } = await admin.from(
        "qb_quote_reprice_impacts",
      ).upsert({
        event_id: eventId,
        workspace_id: preview.sheet.workspace_id,
        quote_package_id: impact.quotePackageId,
        deal_id: impact.dealId,
        assigned_rep_id: impact.assignedRepId,
        quote_status_snapshot: impact.quoteStatusSnapshot,
        quote_updated_at_snapshot: impact.quoteUpdatedAtSnapshot,
        total_delta_cents: impact.totalDeltaCents,
        max_line_delta_pct: impact.maxLineDeltaPct,
        old_margin_pct: impact.oldMarginPct,
        projected_margin_pct: impact.projectedMarginPct,
        margin_floor_pct: impact.marginFloorPct,
        below_margin_floor: impact.belowMarginFloor,
        materiality_trigger: impact.materialityTrigger,
        requires_manager_review: impact.requiresManagerReview,
        approval_required_reasons: impact.approvalRequiredReasons,
        old_commission_cents: impact.oldCommissionCents,
        projected_commission_cents: impact.projectedCommissionCents,
        commission_delta_cents: impact.commissionDeltaCents,
        state: impact.state,
      }, { onConflict: "event_id,quote_package_id" }).select("id").single();
      if (impactErr || !impactRow) {
        throw new Error(
          `Failed to persist quote impact: ${impactErr?.message ?? "unknown"}`,
        );
      }
      const impactId = String((impactRow as JsonObject).id);
      if (impact.lines.length) {
        const { error: lineErr } = await admin.from(
          "qb_quote_reprice_impact_lines",
        ).insert(impact.lines.map((line) => ({
          impact_id: impactId,
          quote_package_line_item_id: line.quotePackageLineItemId,
          equipment_line_id: line.equipmentLineId,
          model_code: line.modelCode,
          make: line.make,
          quantity: line.quantity,
          old_list_price_cents: line.oldListPriceCents,
          new_list_price_cents: line.newListPriceCents,
          delta_cents: line.deltaCents,
          delta_pct: line.deltaPct,
          source_location: line.sourceLocation,
          is_yard_stock: line.isYardStock,
          suppressed_by_stock_lock: line.suppressedByStockLock,
          suppression_reason: line.suppressionReason,
          metadata: line.metadata,
        })));
        if (lineErr) {
          throw new Error(`Failed to persist impact lines: ${lineErr.message}`);
        }
      }
    }

    const visibleQuoteIds = preview.impacts.filter((impact) =>
      impact.state === "visible"
    ).map((impact) => impact.quotePackageId);
    const priorVisibleQuoteIds = new Set<string>();
    if (priorActiveEventIds.length) {
      const { data: priorImpacts, error: priorImpactErr } = await admin.from(
        "qb_quote_reprice_impacts",
      ).select("quote_package_id").in("event_id", priorActiveEventIds).in(
        "state",
        ["visible", "draft_created", "approval_pending", "approved"],
      );
      if (priorImpactErr) {
        throw new Error(
          `Failed to inspect prior OEM impacts: ${priorImpactErr.message}`,
        );
      }
      for (const impact of (priorImpacts ?? []) as JsonObject[]) {
        if (typeof impact.quote_package_id === "string") {
          priorVisibleQuoteIds.add(impact.quote_package_id);
        }
      }
    }
    if (visibleQuoteIds.length) {
      const { error: flagErr } = await admin.from("quote_packages").update({
        requires_requote: true,
        requote_reason: OEM_REQUOTE_REASON,
      }).in("id", visibleQuoteIds);
      if (flagErr) {
        throw new Error(
          `Failed to flag quote packages for requote: ${flagErr.message}`,
        );
      }
    }
    if (priorActiveEventIds.length) {
      await admin.from("qb_quote_reprice_impacts").update({
        state: "superseded",
      }).in("event_id", priorActiveEventIds).eq(
        "workspace_id",
        preview.sheet.workspace_id,
      ).in("state", [
        "visible",
        "draft_created",
        "approval_pending",
        "approved",
      ]);
      await admin.from("qb_price_change_events").update({
        status: "superseded",
      }).in("id", priorActiveEventIds);
      const visibleSet = new Set(visibleQuoteIds);
      let clearIds = [...priorVisibleQuoteIds].filter((id) =>
        !visibleSet.has(id)
      );
      // requote_reason is a shared constant across all OEM events, so a blind
      // clear keyed on it would strip the flag off a quote that a DIFFERENT
      // still-active event (e.g. another brand) legitimately owns. Drop any
      // quote that remains visible in an active, non-superseded event. (The
      // prior events were just set status='superseded' above, and the new
      // event is still 'building' here, so both are correctly excluded.)
      if (clearIds.length) {
        const { data: stillFlagged } = await admin.from(
          "qb_quote_reprice_impacts",
        ).select("quote_package_id, qb_price_change_events!inner(status)")
          .in("quote_package_id", clearIds)
          .eq("qb_price_change_events.status", "active")
          .in("state", [
            "visible",
            "draft_created",
            "approval_pending",
            "approved",
          ]);
        const stillFlaggedIds = new Set(
          ((stillFlagged ?? []) as JsonObject[]).map((row) =>
            String(row.quote_package_id)
          ),
        );
        clearIds = clearIds.filter((id) => !stillFlaggedIds.has(id));
      }
      if (clearIds.length) {
        await admin.from("quote_packages").update({
          requires_requote: false,
          requote_reason: null,
        }).in("id", clearIds).eq("requote_reason", OEM_REQUOTE_REASON);
      }
    }
    await admin.from("qb_price_change_events").update({ status: "active" }).eq(
      "id",
      eventId,
    );
    return eventId;
  } catch (err) {
    await admin.from("qb_price_change_events").update({
      status: "failed",
      source_metadata: { error: errorMessage(err) },
    }).eq("id", eventId);
    throw err;
  }
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
    priceSheetId,
    ctx.origin,
  );
  if (existing) return existing;
  const preview = await buildPreview(ctx.admin, priceSheetId, ctx.workspaceId);
  if (!["extracted", "published"].includes(preview.sheet.status)) {
    return safeJsonError(
      `Sheet must be extracted or already published before OEM publish; got ${preview.sheet.status}`,
      409,
      ctx.origin,
    );
  }
  const didPublish = preview.sheet.status !== "published";
  const publishCounts = didPublish
    ? await invokePublish(ctx, priceSheetId, body.autoApprovePending !== false)
    : { itemsApplied: 0, programsApplied: 0 };
  const eventId = await persistEvent(ctx, preview);
  const material = preview.impacts.filter((impact) =>
    impact.state === "visible"
  );
  const changedItemCount = preview.itemDiffs.filter((item) =>
    item.changeKind !== "unchanged"
  ).length;
  return safeJsonOk({
    ok: true,
    eventId,
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

async function handleRepImpacts(ctx: AuthContext): Promise<Response> {
  // Inner-join the parent event and require status='active'. Without this an
  // impact whose event was superseded or failed (partial publish) would still
  // surface here — handleRepImpacts otherwise filters only on impact state.
  let query = ctx.admin.from("qb_quote_reprice_impacts").select(
    "*, qb_quote_reprice_impact_lines(*), qb_price_change_events!inner(status)",
  ).eq("workspace_id", ctx.workspaceId).eq(
    "qb_price_change_events.status",
    "active",
  ).in("state", [
    "visible",
    "draft_created",
    "approval_pending",
    "approved",
  ]).order("created_at", { ascending: false }).limit(200);
  if (ctx.role === "rep") query = query.eq("assigned_rep_id", ctx.userId);
  const { data, error } = await query;
  if (error) {
    return safeJsonError(
      `Failed to load OEM quote impacts: ${error.message}`,
      500,
      ctx.origin,
    );
  }
  const impacts = (data ?? []) as JsonObject[];
  return safeJsonOk({
    summary: {
      visibleImpactCount: impacts.length,
      affectedQuoteCount: new Set(impacts.map((impact) =>
        impact.quote_package_id
      )).size,
      totalDeltaCents: impacts.reduce(
        (sum, impact) => sum + Number(impact.total_delta_cents ?? 0),
        0,
      ),
      needsApprovalCount:
        impacts.filter((impact) => impact.requires_manager_review === true)
          .length,
    },
    impacts,
  }, ctx.origin);
}

async function loadImpactForAction(
  ctx: AuthContext,
  impactId: string,
): Promise<JsonObject> {
  const { data, error } = await ctx.admin.from("qb_quote_reprice_impacts")
    .select("*, qb_quote_reprice_impact_lines(*), qb_price_change_events!inner(status)")
    .eq("id", impactId).eq(
      "workspace_id",
      ctx.workspaceId,
    ).eq("qb_price_change_events.status", "active").maybeSingle();
  if (error) throw new Error(`Failed to load impact: ${error.message}`);
  if (!data) throw new Error("Impact not found");
  const impact = data as JsonObject;
  if (ctx.role === "rep" && impact.assigned_rep_id !== ctx.userId) {
    throw new Error("Forbidden");
  }
  return impact;
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
  const privileged = ["manager", "owner", "admin"].includes(ctx.role);
  if (!["visible", "quiet"].includes(dismissState) && !privileged) {
    return safeJsonError(
      `Cannot dismiss an impact in state "${dismissState}"; ask a manager to override.`,
      409,
      ctx.origin,
    );
  }
  const { error } = await ctx.admin.from("qb_quote_reprice_impacts").update({
    state: "dismissed",
    dismissed_reason: reason,
  }).eq("id", impactId).in("state", [
    "visible",
    "quiet",
    "draft_created",
    "approval_pending",
    "approved",
  ]);
  if (error) {
    return safeJsonError(
      `Failed to dismiss impact: ${error.message}`,
      500,
      ctx.origin,
    );
  }
  return safeJsonOk({ ok: true, impactId, state: "dismissed" }, ctx.origin);
}

async function handleDraft(
  ctx: AuthContext,
  impactId: string,
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
  // State guard: only a 'visible' impact can spawn a draft. Without this a
  // superseded/dismissed/already-drafted impact could be resurrected into the
  // live queue and its state rewritten back to draft_created/approval_pending.
  const draftState = String(impact.state ?? "");
  if (draftState !== "visible") {
    return safeJsonError(
      `A reprice draft can only be created from a visible impact; this one is "${draftState}".`,
      409,
      ctx.origin,
    );
  }
  const lines = Array.isArray(impact.qb_quote_reprice_impact_lines)
    ? impact.qb_quote_reprice_impact_lines as JsonObject[]
    : [];
  const approvalRequired = impact.requires_manager_review === true;
  const status = approvalRequired ? "approval_pending" : "draft";
  const proposedPatch = {
    eventId: impact.event_id,
    lines: lines.filter((line) => line.suppressed_by_stock_lock !== true).map((
      line,
    ) => ({
      quotePackageLineItemId: line.quote_package_line_item_id ?? null,
      equipmentLineId: line.equipment_line_id ?? null,
      modelCode: line.model_code,
      oldPriceCents: line.old_list_price_cents,
      newPriceCents: line.new_list_price_cents,
      quantity: line.quantity,
      deltaCents: line.delta_cents,
    })),
    totals: {
      projectedDeltaCents: impact.total_delta_cents,
      oldMarginPct: impact.old_margin_pct,
      projectedMarginPct: impact.projected_margin_pct,
      oldCommissionCents: impact.old_commission_cents,
      projectedCommissionCents: impact.projected_commission_cents,
    },
  };
  const { data: draft, error } = await ctx.admin.from("qb_quote_reprice_drafts")
    .insert({
      impact_id: impactId,
      quote_package_id: impact.quote_package_id,
      workspace_id: ctx.workspaceId,
      created_by: ctx.userId,
      status,
      proposed_patch: proposedPatch,
      before_snapshot: {
        quote_updated_at_snapshot: impact.quote_updated_at_snapshot,
        status: impact.quote_status_snapshot,
      },
      projected_totals: proposedPatch.totals,
    }).select("id").single();
  if (error || !draft) {
    // Unique-violation from the partial index (one active draft per impact) —
    // a concurrent double-submit lost the race. Surface it as a clean 409.
    if ((error as { code?: string } | null)?.code === "23505") {
      return safeJsonError(
        "A reprice draft already exists for this impact.",
        409,
        ctx.origin,
      );
    }
    return safeJsonError(
      `Failed to create reprice draft: ${error?.message ?? "unknown"}`,
      500,
      ctx.origin,
    );
  }
  await ctx.admin.from("qb_quote_reprice_impacts").update({
    state: approvalRequired ? "approval_pending" : "draft_created",
  }).eq("id", impactId).eq("state", "visible");
  return safeJsonOk(
    {
      ok: true,
      draftId: String((draft as JsonObject).id),
      status,
      approvalRequired,
      approvalReasons: Array.isArray(impact.approval_required_reasons)
        ? impact.approval_required_reasons
        : [],
      emailDraftId: null,
    },
    ctx.origin,
    201,
  );
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
  return safeJsonError(
    "Draft apply is intentionally not enabled in Phase 1 core; create/review draft only",
    409,
    ctx.origin,
  );
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
    ) return await handleDraft(ctx, second);
    if (
      req.method === "POST" && first === "drafts" && second && third === "apply"
    ) return await handleApplyDraft(ctx, second);
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
