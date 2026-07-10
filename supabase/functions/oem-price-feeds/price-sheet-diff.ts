import { centsValue, deltaPct, normalizeModelCode } from "./impact-logic.ts";

export type PriceSheetChangeKind =
  | "new"
  | "removed"
  | "increased"
  | "decreased"
  | "unchanged";

export type PriceSheetChangeItemType =
  | "list_price"
  | "freight"
  | "rebate"
  | "incentive";

export type PriceSheetLane = "price_book" | "retail_programs";

export interface PriorPriceSheetIdsByLane {
  price_book?: string | null;
  retail_programs?: string | null;
}

export type JsonObject = Record<string, unknown>;

export interface PriceSheetHeader {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  status: string;
  sheet_type: string | null;
  published_at?: string | null;
  supersedes_price_sheet_id?: string | null;
}

export interface PriceSheetItemSourceRow {
  id: string;
  item_type: string;
  extracted: unknown;
  action?: string | null;
  review_status?: string | null;
  applied_at?: string | null;
}

export interface PriceSheetProgramSourceRow {
  id: string;
  program_code: string;
  program_type: string;
  extracted: unknown;
  action?: string | null;
  review_status?: string | null;
  applied_at?: string | null;
}

export interface CanonicalPriceSheetRow {
  sourceSheetId: string;
  sourceItemId: string;
  workspaceId: string;
  brandId: string;
  itemType: PriceSheetChangeItemType;
  /** Identity within workspace + brand + item type. */
  identity: string;
  modelCode: string | null;
  normalizedCode: string | null;
  nameDisplay: string | null;
  /** A catalog amount only. It is never a per-quote estimate. */
  amountCents: number | null;
  /** Stable source content used for non-monetary catalog comparisons. */
  catalogValue: unknown;
  metadata: JsonObject;
}

export interface CanonicalPriceSheetDiff {
  itemType: PriceSheetChangeItemType;
  modelCode: string | null;
  normalizedCode: string | null;
  nameDisplay: string | null;
  oldPriceCents: number | null;
  newPriceCents: number | null;
  deltaCents: number;
  deltaPct: number | null;
  changeKind: PriceSheetChangeKind;
  priorItemId: string | null;
  newItemId: string | null;
  metadata: JsonObject;
}

export interface CanonicalizeOptions {
  /** Published predecessors contain only rows that were approved/applied. */
  mode?: "candidate" | "published";
}

const VALID_PRIOR_STATUSES = new Set(["published", "superseded"]);

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizedIdentity(value: unknown): string | null {
  const text = firstString(value);
  if (!text) return null;
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return normalized || null;
}

function normalizedSheetType(value: unknown): string {
  // Legacy price-book rows predate sheet_type and therefore store NULL.
  return firstString(value) ?? "price_book";
}

export function lanesForPriceSheetType(value: unknown): PriceSheetLane[] {
  const sheetType = normalizedSheetType(value);
  if (sheetType === "both") return ["price_book", "retail_programs"];
  if (sheetType === "retail_programs") return ["retail_programs"];
  // Legacy NULL and the defensive `other` bucket follow the price-book lane.
  return ["price_book"];
}

export function laneForPriceSheetItemType(
  itemType: PriceSheetChangeItemType,
): PriceSheetLane {
  return itemType === "rebate" || itemType === "incentive"
    ? "retail_programs"
    : "price_book";
}

export function arePriceSheetTypesCompatible(
  incomingType: unknown,
  priorType: unknown,
): boolean {
  const incoming = normalizedSheetType(incomingType);
  const prior = normalizedSheetType(priorType);
  if (incoming === "both") return true;
  return prior === incoming || prior === "both";
}

function candidateSupportsLane(
  candidate: PriceSheetHeader,
  lane: PriceSheetLane,
): boolean {
  return lanesForPriceSheetType(candidate.sheet_type).includes(lane);
}

function newestPublishedForLane(
  incoming: PriceSheetHeader,
  candidates: readonly PriceSheetHeader[],
  lane: PriceSheetLane,
): PriceSheetHeader | null {
  const eligible = candidates.filter((candidate) =>
    candidate.id !== incoming.id &&
    candidate.workspace_id === incoming.workspace_id &&
    candidate.brand_id === incoming.brand_id &&
    candidate.status === "published" &&
    candidateSupportsLane(candidate, lane)
  );
  eligible.sort((left, right) => {
    const timeDelta = publishedTime(right.published_at) -
      publishedTime(left.published_at);
    if (timeDelta !== 0) return timeDelta;
    return right.id.localeCompare(left.id);
  });
  return eligible[0] ?? null;
}

/**
 * Resolve immutable predecessor lineage independently for price-book and
 * retail-program lanes. A `both` sheet may therefore have two predecessors;
 * forcing it through the legacy single supersedes FK silently loses one lane.
 */
export function selectPriorPriceSheetIdsByLane(
  incoming: PriceSheetHeader,
  candidates: readonly PriceSheetHeader[],
): PriorPriceSheetIdsByLane {
  if (!incoming.workspace_id || !incoming.brand_id) {
    throw new Error(
      `Price sheet ${incoming.id} requires workspace and brand identity`,
    );
  }
  const lanes = lanesForPriceSheetType(incoming.sheet_type);
  const result: PriorPriceSheetIdsByLane = {};

  if (incoming.supersedes_price_sheet_id) {
    const explicit = candidates.find((candidate) =>
      candidate.id === incoming.supersedes_price_sheet_id
    );
    if (!explicit) {
      throw new Error(
        `Explicit predecessor ${incoming.supersedes_price_sheet_id} was not found`,
      );
    }
    if (
      explicit.id === incoming.id ||
      explicit.workspace_id !== incoming.workspace_id ||
      explicit.brand_id !== incoming.brand_id
    ) {
      throw new Error(
        `Explicit predecessor ${explicit.id} is outside the incoming sheet's workspace or brand`,
      );
    }
    if (!VALID_PRIOR_STATUSES.has(explicit.status)) {
      throw new Error(
        `Explicit predecessor ${explicit.id} must be published or superseded`,
      );
    }
    const coveredLanes = lanes.filter((lane) =>
      candidateSupportsLane(explicit, lane)
    );
    if (!coveredLanes.length) {
      throw new Error(
        `Explicit predecessor ${explicit.id} has no compatible price-sheet lane`,
      );
    }
    for (const lane of coveredLanes) result[lane] = explicit.id;
  }

  for (const lane of lanes) {
    if (result[lane]) continue;
    result[lane] = newestPublishedForLane(incoming, candidates, lane)?.id ??
      null;
  }
  return result;
}

function publishedTime(value: unknown): number {
  if (typeof value !== "string") return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

/**
 * Select the exact predecessor for an incoming sheet.
 *
 * An explicit supersedes link wins even when a newer compatible sheet exists.
 * Otherwise candidates are ordered by published_at DESC, then UUID/id DESC so
 * the result is stable when timestamps tie.
 */
export function selectPriorPriceSheetId(
  incoming: PriceSheetHeader,
  candidates: readonly PriceSheetHeader[],
): string | null {
  const byLane = selectPriorPriceSheetIdsByLane(incoming, candidates);
  const unique = [...new Set(Object.values(byLane).filter(Boolean))];
  if (unique.length > 1) {
    throw new Error(
      `Price sheet ${incoming.id} has lane-specific predecessors; use selectPriorPriceSheetIdsByLane`,
    );
  }
  return unique[0] ?? null;
}

function rowIsEligible(
  row: PriceSheetItemSourceRow | PriceSheetProgramSourceRow,
  mode: "candidate" | "published",
): boolean {
  if (row.action === "skip" || row.review_status === "rejected") return false;
  if (mode === "published") {
    // Approval is intent, not proof of catalog mutation. The atomic publisher
    // stamps applied_at only after every catalog write succeeds.
    return Boolean(row.applied_at);
  }
  return true;
}

function normalizedStateCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.flatMap((entry) => {
      const code = firstString(entry)?.toUpperCase();
      return code ? [code] : [];
    })),
  ].sort();
}

function programItemType(programType: string): "rebate" | "incentive" {
  const normalized = programType.toLowerCase();
  return normalized.includes("rebate") || normalized.includes("cash")
    ? "rebate"
    : "incentive";
}

function comparableProgramAmount(extracted: JsonObject): number | null {
  const details = asObject(extracted.details);
  const directCandidates = [
    extracted.amount_cents,
    extracted.rebate_amount_cents,
    extracted.cash_amount_cents,
    details.amount_cents,
    details.rebate_amount_cents,
    details.cash_amount_cents,
    details.discount_cents,
  ];
  for (const candidate of directCandidates) {
    const amount = centsValue(candidate);
    if (amount !== null) return amount;
  }

  const rebates = Array.isArray(details.rebates) ? details.rebates : [];
  if (rebates.length !== 1) return null;
  return centsValue(asObject(rebates[0]).amount_cents);
}

function canonicalProgramValue(
  programType: string,
  extracted: JsonObject,
): JsonObject {
  // Code formatting is already normalized into identity. Excluding it here
  // avoids reporting a false catalog rule replacement for "RT-40" vs "RT40".
  const { program_code: _programCode, program_type: _programType, ...content } =
    extracted;
  return { program_type: programType.toLowerCase(), ...content };
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value !== "object" || value === null) {
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  }
  const object = value as JsonObject;
  const result: JsonObject = {};
  for (const key of Object.keys(object).sort()) {
    if (object[key] !== undefined) result[key] = canonicalizeJson(object[key]);
  }
  return result;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

/** Convert raw sheet tables into rows with explicit, brand-scoped identity. */
export function canonicalizePriceSheetRows(
  sheet: PriceSheetHeader,
  items: readonly PriceSheetItemSourceRow[],
  programs: readonly PriceSheetProgramSourceRow[],
  options: CanonicalizeOptions = {},
): CanonicalPriceSheetRow[] {
  if (!sheet.workspace_id || !sheet.brand_id) {
    throw new Error(
      `Price sheet ${sheet.id} requires workspace and brand identity`,
    );
  }
  const mode = options.mode ?? "candidate";
  const rows: CanonicalPriceSheetRow[] = [];

  for (const item of items) {
    if (!rowIsEligible(item, mode)) continue;
    const extracted = asObject(item.extracted);

    if (item.item_type === "model") {
      const modelCode = firstString(
        extracted.model_code,
        extracted.modelCode,
        extracted.model,
      );
      const normalizedCode = normalizeModelCode(modelCode);
      const amountCents = centsValue(
        extracted.list_price_cents ?? extracted.listPriceCents ??
          extracted.price_cents,
      );
      if (!modelCode || !normalizedCode || amountCents === null) {
        throw new Error(
          `Model item ${item.id} requires model_code and list_price_cents`,
        );
      }
      rows.push({
        sourceSheetId: sheet.id,
        sourceItemId: item.id,
        workspaceId: sheet.workspace_id,
        brandId: sheet.brand_id,
        itemType: "list_price",
        identity: `model:${normalizedCode}`,
        modelCode,
        normalizedCode,
        nameDisplay: firstString(extracted.name_display, extracted.name),
        amountCents,
        catalogValue: { list_price_cents: amountCents },
        metadata: { action: item.action ?? null },
      });
      continue;
    }

    if (item.item_type === "freight") {
      const stateCodes = normalizedStateCodes(extracted.state_codes);
      const zoneName = firstString(extracted.zone_name);
      const zoneIdentity = stateCodes.length
        ? stateCodes.join("+")
        : normalizedIdentity(zoneName);
      if (!zoneIdentity) {
        throw new Error(
          `Freight item ${item.id} requires state_codes or zone_name`,
        );
      }
      const rates = [
        ["large", centsValue(extracted.freight_large_cents)],
        ["small", centsValue(extracted.freight_small_cents)],
      ] as const;
      for (const [rateClass, amountCents] of rates) {
        rows.push({
          sourceSheetId: sheet.id,
          sourceItemId: item.id,
          workspaceId: sheet.workspace_id,
          brandId: sheet.brand_id,
          itemType: "freight",
          identity: `freight:${zoneIdentity}:${rateClass}`,
          modelCode: null,
          normalizedCode: null,
          nameDisplay: zoneName
            ? `${zoneName} (${rateClass})`
            : `Freight ${stateCodes.join(", ")} (${rateClass})`,
          amountCents,
          catalogValue: {
            rate_class: rateClass,
            state_codes: stateCodes,
          },
          metadata: {
            action: item.action ?? null,
            rate_class: rateClass,
            state_codes: stateCodes,
            zone_name: zoneName,
            catalog_only: true,
          },
        });
      }
    }
  }

  for (const program of programs) {
    if (!rowIsEligible(program, mode)) continue;
    const programCode = firstString(program.program_code);
    const normalizedProgramCode = normalizedIdentity(programCode);
    const programType = firstString(program.program_type);
    if (!programCode || !normalizedProgramCode || !programType) {
      throw new Error(
        `Program item ${program.id} requires program_code and program_type`,
      );
    }
    const extracted = asObject(program.extracted);
    const itemType = programItemType(programType);
    rows.push({
      sourceSheetId: sheet.id,
      sourceItemId: program.id,
      workspaceId: sheet.workspace_id,
      brandId: sheet.brand_id,
      itemType,
      identity: `program:${programType.toLowerCase()}:${normalizedProgramCode}`,
      modelCode: null,
      normalizedCode: null,
      nameDisplay: firstString(extracted.name, programCode),
      amountCents: comparableProgramAmount(extracted),
      catalogValue: canonicalProgramValue(programType, extracted),
      metadata: {
        action: program.action ?? null,
        program_code: programCode,
        program_type: programType,
        catalog_only: true,
      },
    });
  }

  return rows;
}

function canonicalKey(row: CanonicalPriceSheetRow): string {
  return [row.workspaceId, row.brandId, row.itemType, row.identity].join(
    "\u001f",
  );
}

/** Preserve catalog state for reviewed rows the SQL publisher will not apply. */
export function overlayPreservedPriorRows(
  priorRows: readonly CanonicalPriceSheetRow[],
  incomingRows: readonly CanonicalPriceSheetRow[],
  preservedIdentityRows: readonly CanonicalPriceSheetRow[],
): CanonicalPriceSheetRow[] {
  const priorByKey = indexRows(priorRows, "prior");
  const result = indexRows(incomingRows, "incoming");
  for (const preserved of preservedIdentityRows) {
    const key = canonicalKey(preserved);
    if (result.has(key)) continue;
    const prior = priorByKey.get(key);
    if (prior) result.set(key, prior);
  }
  return [...result.values()];
}

function indexRows(
  rows: readonly CanonicalPriceSheetRow[],
  side: "prior" | "incoming",
): Map<string, CanonicalPriceSheetRow> {
  const result = new Map<string, CanonicalPriceSheetRow>();
  for (const row of rows) {
    const key = canonicalKey(row);
    const duplicate = result.get(key);
    if (duplicate) {
      throw new Error(
        `Ambiguous ${side} price-sheet rows ${duplicate.sourceItemId} and ${row.sourceItemId} share ${key}`,
      );
    }
    result.set(key, row);
  }
  return result;
}

function metadataFor(
  row: CanonicalPriceSheetRow,
  extra: JsonObject = {},
): JsonObject {
  return {
    source: "canonical_price_sheet_rows",
    workspace_id: row.workspaceId,
    brand_id: row.brandId,
    canonical_identity: row.identity,
    ...row.metadata,
    ...extra,
  };
}

function oneSidedDiff(
  row: CanonicalPriceSheetRow,
  changeKind: "new" | "removed",
  extraMetadata: JsonObject = {},
): CanonicalPriceSheetDiff {
  const isNew = changeKind === "new";
  return {
    itemType: row.itemType,
    modelCode: row.modelCode,
    normalizedCode: row.normalizedCode,
    nameDisplay: row.nameDisplay,
    oldPriceCents: isNew ? null : row.amountCents,
    newPriceCents: isNew ? row.amountCents : null,
    // New/removed catalog rows lack a comparable pair. Zero is intentional:
    // it prevents the catalog price itself from masquerading as quote impact.
    deltaCents: 0,
    deltaPct: null,
    changeKind,
    priorItemId: isNew ? null : row.sourceItemId,
    newItemId: isNew ? row.sourceItemId : null,
    metadata: metadataFor(row, {
      catalog_value: canonicalizeJson(row.catalogValue),
      ...extraMetadata,
    }),
  };
}

function comparedDiff(
  prior: CanonicalPriceSheetRow,
  incoming: CanonicalPriceSheetRow,
): CanonicalPriceSheetDiff[] {
  const oldAmount = prior.amountCents;
  const newAmount = incoming.amountCents;
  const catalogChanged = stableJson(prior.catalogValue) !==
    stableJson(incoming.catalogValue);

  if (
    prior.itemType !== "list_price" && prior.itemType !== "freight" &&
    catalogChanged &&
    (oldAmount === null || newAmount === null || oldAmount === newAmount)
  ) {
    // The current database enum has no generic "changed" value. A deterministic
    // removed/new replacement pair is truthful for rule/eligibility changes and
    // avoids inventing a dollar direction for non-monetary program content.
    const replacementGroup = canonicalKey(incoming);
    const extra = {
      replacement_pair: true,
      replacement_group: replacementGroup,
      replacement_reason: "non_monetary_catalog_change",
    };
    return [
      oneSidedDiff(prior, "removed", extra),
      oneSidedDiff(incoming, "new", extra),
    ];
  }

  const delta = oldAmount !== null && newAmount !== null
    ? newAmount - oldAmount
    : 0;
  const changeKind: PriceSheetChangeKind =
    oldAmount === null && newAmount !== null
      ? "new"
      : oldAmount !== null && newAmount === null
      ? "removed"
      : delta > 0
      ? "increased"
      : delta < 0
      ? "decreased"
      : "unchanged";

  return [{
    itemType: incoming.itemType,
    modelCode: incoming.modelCode ?? prior.modelCode,
    normalizedCode: incoming.normalizedCode ?? prior.normalizedCode,
    nameDisplay: incoming.nameDisplay ?? prior.nameDisplay,
    oldPriceCents: oldAmount,
    newPriceCents: newAmount,
    deltaCents: changeKind === "new" || changeKind === "removed" ? 0 : delta,
    deltaPct: changeKind === "increased" || changeKind === "decreased"
      ? deltaPct(oldAmount, newAmount)
      : null,
    changeKind,
    priorItemId: prior.sourceItemId,
    newItemId: incoming.sourceItemId,
    metadata: metadataFor(incoming, {
      prior_catalog_value: canonicalizeJson(prior.catalogValue),
      new_catalog_value: canonicalizeJson(incoming.catalogValue),
      catalog_changed: catalogChanged,
    }),
  }];
}

/**
 * Pure canonical sheet diff. Identity includes workspace + brand + normalized
 * model/program/zone identity, so identical model codes under different OEMs
 * can never overwrite one another.
 */
export function diffCanonicalPriceSheetRows(
  priorRows: readonly CanonicalPriceSheetRow[],
  incomingRows: readonly CanonicalPriceSheetRow[],
): CanonicalPriceSheetDiff[] {
  const prior = indexRows(priorRows, "prior");
  const incoming = indexRows(incomingRows, "incoming");
  const diffs: CanonicalPriceSheetDiff[] = [];

  for (const [key, nextRow] of incoming) {
    const priorRow = prior.get(key);
    if (!priorRow) diffs.push(oneSidedDiff(nextRow, "new"));
    else diffs.push(...comparedDiff(priorRow, nextRow));
  }
  for (const [key, priorRow] of prior) {
    if (!incoming.has(key)) diffs.push(oneSidedDiff(priorRow, "removed"));
  }

  const rank: Record<PriceSheetChangeKind, number> = {
    increased: 0,
    decreased: 0,
    new: 1,
    removed: 2,
    unchanged: 3,
  };
  diffs.sort((left, right) => {
    const rankDelta = rank[left.changeKind] - rank[right.changeKind];
    if (rankDelta !== 0) return rankDelta;
    const amountDelta = Math.abs(right.deltaCents) - Math.abs(left.deltaCents);
    if (amountDelta !== 0) return amountDelta;
    const leftKey = [
      String(left.metadata.workspace_id ?? ""),
      String(left.metadata.brand_id ?? ""),
      left.itemType,
      String(left.metadata.canonical_identity ?? ""),
      left.changeKind,
    ].join("\u001f");
    const rightKey = [
      String(right.metadata.workspace_id ?? ""),
      String(right.metadata.brand_id ?? ""),
      right.itemType,
      String(right.metadata.canonical_identity ?? ""),
      right.changeKind,
    ].join("\u001f");
    return leftKey.localeCompare(rightKey);
  });
  return diffs;
}
