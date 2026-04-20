/**
 * Sheet Diff + In-flight Quote Impact — Slice 16 moonshot.
 *
 * Given a pending-review price sheet, we need three answers for the
 * admin approval UI:
 *
 *   1. WHAT changed? Structured diff against the previously published
 *      sheet for the same brand. Models / attachments / freight zones
 *      broken into added / removed / changed (with old vs new price).
 *
 *   2. How big a deal is it? Summary counts + aggregate delta, so the
 *      banner can say "+$840 avg, 12 price changes" at a glance.
 *
 *   3. WHO is affected? Every in-flight quote_package on this brand
 *      gets re-priced against the new catalog. We surface:
 *        - how many quotes are affected
 *        - the per-quote dollar delta
 *        - the aggregate "delta if approved" across the pipeline.
 *
 *   That last piece is the differentiator — most watchdogs stop at
 *   diff. "Approving this sheet would move $8,400 across 4 open
 *   quotes" is the moonshot insight.
 *
 * Pure vs. I/O:
 *   - computeModelDiff / aggregateDiffSummary / impactForOpenQuote
 *     are pure and exported for tests.
 *   - loadDiffPayload / getInFlightImpact are the Supabase wrappers.
 *
 * Caveat: model matching uses normalizeCode() for tolerance — rep
 * free-text in quote_packages.equipment[].model is lowercased +
 * whitespace-stripped before comparison. New models are matched by
 * exact model_code (case-insensitive).
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

// ── Types ────────────────────────────────────────────────────────────────

type PriceSheetRow = Database["public"]["Tables"]["qb_price_sheets"]["Row"];
type SheetItemRow  = Database["public"]["Tables"]["qb_price_sheet_items"]["Row"];

/** Rep-facing equipment line inside a quote_packages row. */
export interface QuoteEquipmentLine {
  id?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  price?: number | null;
}

export type ChangeKind = "new" | "removed" | "increased" | "decreased" | "unchanged";

export interface ModelPriceChange {
  modelCode: string;
  nameDisplay: string | null;
  oldPriceCents: number | null;
  newPriceCents: number | null;
  deltaCents: number;
  deltaPct:   number;  // (new - old) / old * 100, 0 for added/removed
  kind:       ChangeKind;
}

export interface DiffSummary {
  totalChanges:          number;
  newModels:             number;
  removedModels:         number;
  pricesIncreased:       number;
  pricesDecreased:       number;
  /** Sum of deltaCents across *changed* (non-unchanged) rows. */
  totalDeltaCents:       number;
  /** Mean deltaPct across changed models. null when nothing changed. */
  avgDeltaPct:           number | null;
  /** The largest single delta in either direction, for the headline number. */
  largestIncreaseCents:  number;
  largestDecreaseCents:  number;
}

export interface SheetDiff {
  priceSheetId:      string;
  priorPriceSheetId: string | null;
  brandId:           string | null;
  modelChanges:      ModelPriceChange[];
  summary:           DiffSummary;
}

export interface QuoteImpactRow {
  quotePackageId: string;
  quoteNumber:    string | null;
  customerName:   string | null;
  status:         string;
  /** Total price delta on this quote if the new sheet is approved. */
  deltaCents:     number;
  /** Per-line impact so the UI can drill in. */
  affectedLines:  Array<{
    lineId:       string | null;
    modelCode:    string;
    oldPriceCents: number;
    newPriceCents: number;
    deltaCents:   number;
  }>;
}

export interface InFlightImpact {
  priceSheetId:         string;
  affectedQuoteCount:   number;
  totalDeltaCents:      number;
  /** Sorted by absolute deltaCents desc. */
  quotes:               QuoteImpactRow[];
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Build the full diff payload for a pending-review sheet. Returns
 * `null` if the sheet doesn't exist.
 */
export async function generateSheetDiff(priceSheetId: string): Promise<SheetDiff | null> {
  const { data: sheet } = await supabase
    .from("qb_price_sheets")
    .select("id, brand_id, status")
    .eq("id", priceSheetId)
    .maybeSingle();
  if (!sheet) return null;
  const brandId = (sheet as Pick<PriceSheetRow, "brand_id">).brand_id;

  // Items on the new sheet (pending_review / extracted)
  const { data: newItems } = await supabase
    .from("qb_price_sheet_items")
    .select("*")
    .eq("price_sheet_id", priceSheetId)
    .eq("item_type", "model");

  // Prior published sheet for the same brand, if any
  const priorQ = brandId
    ? await supabase
        .from("qb_price_sheets")
        .select("id")
        .eq("brand_id", brandId)
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null as null };
  const priorPriceSheetId = priorQ.data ? (priorQ.data as { id: string }).id : null;

  const { data: priorItems } = priorPriceSheetId
    ? await supabase
        .from("qb_price_sheet_items")
        .select("*")
        .eq("price_sheet_id", priorPriceSheetId)
        .eq("item_type", "model")
    : { data: [] as SheetItemRow[] };

  const modelChanges = computeModelDiff(
    (priorItems ?? []) as SheetItemRow[],
    (newItems ?? []) as SheetItemRow[],
  );

  return {
    priceSheetId,
    priorPriceSheetId,
    brandId,
    modelChanges,
    summary: aggregateDiffSummary(modelChanges),
  };
}

/**
 * Estimate how a new sheet would reprice the in-flight quote pipeline
 * for the sheet's brand.
 */
export async function getInFlightImpact(diff: SheetDiff): Promise<InFlightImpact> {
  if (!diff.brandId || diff.modelChanges.length === 0) {
    return {
      priceSheetId:       diff.priceSheetId,
      affectedQuoteCount: 0,
      totalDeltaCents:    0,
      quotes:             [],
    };
  }

  const { data: quotes } = await supabase
    .from("quote_packages")
    .select("id, quote_number, customer_name, status, equipment")
    .in("status", ["draft", "ready", "sent", "viewed"])
    .order("updated_at", { ascending: false });

  const rows: QuoteImpactRow[] = [];
  for (const q of (quotes ?? []) as Array<Pick<
    Database["public"]["Tables"]["quote_packages"]["Row"],
    "id" | "quote_number" | "customer_name" | "status" | "equipment"
  >>) {
    const equipment = Array.isArray(q.equipment) ? (q.equipment as unknown as QuoteEquipmentLine[]) : [];
    const impact = impactForOpenQuote(equipment, diff.modelChanges);
    if (impact.deltaCents === 0) continue;
    rows.push({
      quotePackageId: q.id,
      quoteNumber:    q.quote_number,
      customerName:   q.customer_name,
      status:         q.status,
      deltaCents:     impact.deltaCents,
      affectedLines:  impact.lines,
    });
  }

  rows.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));

  return {
    priceSheetId:       diff.priceSheetId,
    affectedQuoteCount: rows.length,
    totalDeltaCents:    rows.reduce((sum, r) => sum + r.deltaCents, 0),
    quotes:             rows,
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a model code/string for tolerant matching. Lowercase,
 * strip whitespace + punctuation, so 'RT-135' 'rt135' 'RT 135' all
 * collide. Exported for tests.
 */
export function normalizeCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toLowerCase().replace(/[\s_\-./]+/g, "");
}

interface ExtractedModel {
  model_code?: string;
  name_display?: string;
  list_price_cents?: number;
}

/** Extract (code, price) from a qb_price_sheet_items.extracted payload. */
function readItem(row: SheetItemRow): { code: string; codeNorm: string; name: string | null; price: number } {
  const ex = (row.extracted ?? {}) as ExtractedModel;
  const code = (ex.model_code ?? "").trim();
  return {
    code,
    codeNorm: normalizeCode(code),
    name:     (ex.name_display ?? "").trim() || null,
    price:    Number(ex.list_price_cents ?? 0),
  };
}

/**
 * Compare two sets of extracted model rows (prior published vs new
 * pending). Pure.
 */
export function computeModelDiff(
  prior: SheetItemRow[],
  incoming: SheetItemRow[],
): ModelPriceChange[] {
  const priorByCode = new Map<string, { code: string; name: string | null; price: number }>();
  for (const r of prior) {
    const it = readItem(r);
    if (!it.codeNorm) continue;
    priorByCode.set(it.codeNorm, it);
  }

  const incomingByCode = new Map<string, { code: string; name: string | null; price: number }>();
  for (const r of incoming) {
    const it = readItem(r);
    if (!it.codeNorm) continue;
    incomingByCode.set(it.codeNorm, it);
  }

  const changes: ModelPriceChange[] = [];

  // Walk incoming first — anything new or changed
  for (const [codeNorm, nextIt] of incomingByCode.entries()) {
    const priorIt = priorByCode.get(codeNorm);
    if (!priorIt) {
      changes.push({
        modelCode:     nextIt.code,
        nameDisplay:   nextIt.name,
        oldPriceCents: null,
        newPriceCents: nextIt.price,
        deltaCents:    0,
        deltaPct:      0,
        kind:          "new",
      });
      continue;
    }

    const deltaCents = nextIt.price - priorIt.price;
    if (deltaCents === 0) {
      changes.push({
        modelCode:     nextIt.code,
        nameDisplay:   nextIt.name ?? priorIt.name,
        oldPriceCents: priorIt.price,
        newPriceCents: nextIt.price,
        deltaCents:    0,
        deltaPct:      0,
        kind:          "unchanged",
      });
      continue;
    }

    changes.push({
      modelCode:     nextIt.code,
      nameDisplay:   nextIt.name ?? priorIt.name,
      oldPriceCents: priorIt.price,
      newPriceCents: nextIt.price,
      deltaCents,
      deltaPct:      priorIt.price > 0 ? (deltaCents / priorIt.price) * 100 : 0,
      kind:          deltaCents > 0 ? "increased" : "decreased",
    });
  }

  // Models in prior but not in incoming → removed
  for (const [codeNorm, priorIt] of priorByCode.entries()) {
    if (incomingByCode.has(codeNorm)) continue;
    changes.push({
      modelCode:     priorIt.code,
      nameDisplay:   priorIt.name,
      oldPriceCents: priorIt.price,
      newPriceCents: null,
      deltaCents:    0,
      deltaPct:      0,
      kind:          "removed",
    });
  }

  // Sort: changed first (by absolute delta desc), then new, then removed,
  // then unchanged at the bottom.
  const rank: Record<ChangeKind, number> = { increased: 0, decreased: 0, new: 1, removed: 2, unchanged: 3 };
  changes.sort((a, b) => {
    const r = rank[a.kind] - rank[b.kind];
    if (r !== 0) return r;
    return Math.abs(b.deltaCents) - Math.abs(a.deltaCents);
  });

  return changes;
}

/**
 * Aggregate a diff into headline numbers for the approval banner. Pure.
 */
export function aggregateDiffSummary(changes: ModelPriceChange[]): DiffSummary {
  let newModels = 0, removedModels = 0, pricesIncreased = 0, pricesDecreased = 0;
  let totalDeltaCents = 0;
  let deltaPctSum = 0;
  let deltaPctCount = 0;
  let largestIncrease = 0;
  let largestDecrease = 0;

  for (const c of changes) {
    switch (c.kind) {
      case "new":
        newModels += 1;
        break;
      case "removed":
        removedModels += 1;
        break;
      case "increased":
        pricesIncreased += 1;
        totalDeltaCents += c.deltaCents;
        deltaPctSum += c.deltaPct;
        deltaPctCount += 1;
        if (c.deltaCents > largestIncrease) largestIncrease = c.deltaCents;
        break;
      case "decreased":
        pricesDecreased += 1;
        totalDeltaCents += c.deltaCents;
        deltaPctSum += c.deltaPct;
        deltaPctCount += 1;
        if (c.deltaCents < largestDecrease) largestDecrease = c.deltaCents;
        break;
      // unchanged doesn't contribute
    }
  }

  const totalChanges = newModels + removedModels + pricesIncreased + pricesDecreased;

  return {
    totalChanges,
    newModels,
    removedModels,
    pricesIncreased,
    pricesDecreased,
    totalDeltaCents,
    avgDeltaPct:            deltaPctCount > 0 ? Math.round((deltaPctSum / deltaPctCount) * 10) / 10 : null,
    largestIncreaseCents:   largestIncrease,
    largestDecreaseCents:   largestDecrease,
  };
}

/**
 * For a single open quote's equipment lines, compute the total price
 * delta against the incoming changes. Pure.
 *
 * Matching:
 *   - quote line's `model` field normalized via normalizeCode
 *   - compared against change.modelCode normalized the same way
 *   - only rows that are actually changing prices (increased/decreased)
 *     are counted. new/removed don't impact existing quotes.
 */
export function impactForOpenQuote(
  equipment: QuoteEquipmentLine[],
  changes: ModelPriceChange[],
): { deltaCents: number; lines: QuoteImpactRow["affectedLines"] } {
  if (equipment.length === 0) return { deltaCents: 0, lines: [] };

  const priceChangeByCode = new Map<string, ModelPriceChange>();
  for (const c of changes) {
    if (c.kind !== "increased" && c.kind !== "decreased") continue;
    priceChangeByCode.set(normalizeCode(c.modelCode), c);
  }

  const lines: QuoteImpactRow["affectedLines"] = [];
  let deltaCents = 0;
  for (const line of equipment) {
    const codeNorm = normalizeCode(line.model);
    if (!codeNorm) continue;
    const change = priceChangeByCode.get(codeNorm);
    if (!change || change.oldPriceCents == null || change.newPriceCents == null) continue;
    deltaCents += change.deltaCents;
    lines.push({
      lineId:        line.id ?? null,
      modelCode:     change.modelCode,
      oldPriceCents: change.oldPriceCents,
      newPriceCents: change.newPriceCents,
      deltaCents:    change.deltaCents,
    });
  }

  return { deltaCents, lines };
}
