// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  arePriceSheetTypesCompatible,
  canonicalizePriceSheetRows,
  type CanonicalPriceSheetDiff,
  type CanonicalPriceSheetRow,
  diffCanonicalPriceSheetRows,
  overlayPreservedPriorRows,
  type PriceSheetHeader,
  type PriceSheetItemSourceRow,
  type PriceSheetProgramSourceRow,
  selectPriorPriceSheetId,
  selectPriorPriceSheetIdsByLane,
} from "./price-sheet-diff.ts";

interface SheetFixture {
  sheet: PriceSheetHeader;
  items: PriceSheetItemSourceRow[];
  programs: PriceSheetProgramSourceRow[];
}

interface FixtureFile {
  sheets: SheetFixture[];
}

async function loadFixture(name: string): Promise<FixtureFile> {
  return JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url)),
  ) as FixtureFile;
}

function flattenFixture(
  fixture: FixtureFile,
  mode: "candidate" | "published",
): CanonicalPriceSheetRow[] {
  return fixture.sheets.flatMap(({ sheet, items, programs }) =>
    canonicalizePriceSheetRows(sheet, items, programs, { mode })
  );
}

function findModel(
  diffs: CanonicalPriceSheetDiff[],
  brandId: string,
  normalizedCode: string,
): CanonicalPriceSheetDiff {
  const result = diffs.find((diff) =>
    diff.itemType === "list_price" &&
    diff.normalizedCode === normalizedCode &&
    diff.metadata.brand_id === brandId
  );
  assert(result, `Expected ${brandId}/${normalizedCode} diff`);
  return result;
}

Deno.test("fixture diff emits every list-price change kind and prior-only removal", async () => {
  const prior = flattenFixture(
    await loadFixture("prior-price-sheets.json"),
    "published",
  );
  const incoming = flattenFixture(
    await loadFixture("incoming-price-sheets.json"),
    "candidate",
  );
  const diffs = diffCanonicalPriceSheetRows(prior, incoming);

  assertEquals(findModel(diffs, "brand-asv", "RT40").changeKind, "increased");
  assertEquals(findModel(diffs, "brand-asv", "RT50").changeKind, "decreased");
  assertEquals(findModel(diffs, "brand-asv", "RT60").changeKind, "unchanged");
  assertEquals(findModel(diffs, "brand-asv", "NEW100").changeKind, "new");
  assertEquals(findModel(diffs, "brand-asv", "OLD90").changeKind, "removed");
  assertEquals(findModel(diffs, "brand-asv", "OLD90").newItemId, null);
  assertEquals(
    findModel(diffs, "brand-asv", "OLD90").priorItemId,
    "asv-prior-old90",
  );
});

Deno.test("duplicate model code remains isolated by OEM/brand", async () => {
  const prior = flattenFixture(
    await loadFixture("prior-price-sheets.json"),
    "published",
  );
  const incoming = flattenFixture(
    await loadFixture("incoming-price-sheets.json"),
    "candidate",
  );
  const diffs = diffCanonicalPriceSheetRows(prior, incoming);

  const rt40 = diffs.filter((diff) =>
    diff.itemType === "list_price" && diff.normalizedCode === "RT40"
  );
  assertEquals(rt40.length, 2);
  assertEquals(
    rt40.map((diff) => [diff.metadata.brand_id, diff.changeKind]).sort(),
    [
      ["brand-asv", "increased"],
      ["brand-bobcat", "unchanged"],
    ],
  );
  assertEquals(findModel(diffs, "brand-asv", "RT40").deltaCents, 1_000_000);
  assertEquals(findModel(diffs, "brand-bobcat", "RT40").deltaCents, 0);
});

Deno.test("freight and program changes stay catalog-only and never invent quote dollars", async () => {
  const prior = flattenFixture(
    await loadFixture("prior-price-sheets.json"),
    "published",
  );
  const incoming = flattenFixture(
    await loadFixture("incoming-price-sheets.json"),
    "candidate",
  );
  const diffs = diffCanonicalPriceSheetRows(prior, incoming);

  const freight = diffs.filter((diff) => diff.itemType === "freight");
  assertEquals(
    freight.map((diff) => [diff.metadata.rate_class, diff.changeKind]).sort(),
    [["large", "increased"], ["small", "decreased"]],
  );
  assert(freight.every((diff) => diff.metadata.catalog_only === true));

  const rebate = diffs.find((diff) =>
    diff.itemType === "rebate" && diff.changeKind === "increased"
  );
  assert(rebate);
  assertEquals(rebate.oldPriceCents, 500_000);
  assertEquals(rebate.newPriceCents, 600_000);
  assertEquals(rebate.metadata.catalog_only, true);

  const financeReplacement = diffs.filter((diff) =>
    diff.itemType === "incentive" &&
    diff.metadata.replacement_pair === true
  );
  assertEquals(
    financeReplacement.map((diff) => diff.changeKind).sort(),
    ["new", "removed"],
  );
  assert(financeReplacement.every((diff) => diff.deltaCents === 0));
});

Deno.test("no-prior sheet reports catalog additions with zero comparison deltas", async () => {
  const fixture = await loadFixture("incoming-price-sheets.json");
  const primary = fixture.sheets[0];
  const incoming = canonicalizePriceSheetRows(
    primary.sheet,
    primary.items,
    primary.programs,
  );
  const diffs = diffCanonicalPriceSheetRows([], incoming);

  assert(diffs.length > 0);
  assert(diffs.every((diff) => diff.changeKind === "new"));
  assert(diffs.every((diff) => diff.deltaCents === 0));
  assertEquals(diffs.some((diff) => diff.modelCode === "REJECTED"), false);
});

Deno.test("published predecessors exclude rows that were never approved or applied", () => {
  const sheet: PriceSheetHeader = {
    id: "published-sheet",
    workspace_id: "ws-1",
    brand_id: "brand-1",
    status: "published",
    sheet_type: "price_book",
  };
  const item = (
    id: string,
    reviewStatus: string,
    appliedAt: string | null,
  ) => ({
    id,
    item_type: "model",
    extracted: {
      model_code: id,
      list_price_cents: 100,
    },
    action: "create",
    review_status: reviewStatus,
    applied_at: appliedAt,
  });
  const rows = canonicalizePriceSheetRows(
    sheet,
    [
      item("APPROVED", "approved", null),
      item("APPLIED", "pending", "2026-01-01T00:00:00.000Z"),
      item("PENDING", "pending", null),
      item("REJECTED", "rejected", null),
    ],
    [],
    { mode: "published" },
  );
  assertEquals(rows.map((row) => row.modelCode).sort(), [
    "APPLIED",
  ]);
});

Deno.test("both sheets preserve independent price-book and retail predecessors", () => {
  const incoming: PriceSheetHeader = {
    id: "incoming-both",
    workspace_id: "ws-1",
    brand_id: "brand-1",
    status: "extracted",
    sheet_type: "both",
    supersedes_price_sheet_id: null,
  };
  const candidates: PriceSheetHeader[] = [
    {
      id: "price-prior",
      workspace_id: "ws-1",
      brand_id: "brand-1",
      status: "published",
      sheet_type: "price_book",
      published_at: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "program-prior",
      workspace_id: "ws-1",
      brand_id: "brand-1",
      status: "published",
      sheet_type: "retail_programs",
      published_at: "2026-06-02T00:00:00.000Z",
    },
  ];

  assertEquals(selectPriorPriceSheetIdsByLane(incoming, candidates), {
    price_book: "price-prior",
    retail_programs: "program-prior",
  });
  assertThrows(
    () => selectPriorPriceSheetId(incoming, candidates),
    Error,
    "lane-specific predecessors",
  );

  const commonPrior: PriceSheetHeader = {
    ...candidates[0],
    id: "both-prior",
    sheet_type: "both",
  };
  assertEquals(
    selectPriorPriceSheetIdsByLane(
      { ...incoming, supersedes_price_sheet_id: commonPrior.id },
      [...candidates, commonPrior],
    ),
    { price_book: "both-prior", retail_programs: "both-prior" },
  );
});

Deno.test("canonical diff replay is byte-for-byte deterministic", async () => {
  const prior = flattenFixture(
    await loadFixture("prior-price-sheets.json"),
    "published",
  );
  const incoming = flattenFixture(
    await loadFixture("incoming-price-sheets.json"),
    "candidate",
  );
  const first = diffCanonicalPriceSheetRows(prior, incoming);
  const replay = diffCanonicalPriceSheetRows(prior, incoming);
  assertEquals(JSON.stringify(replay), JSON.stringify(first));
});

Deno.test("explicit supersedes wins and deterministic fallback honors compatible sheet type", async () => {
  const priorFixture = await loadFixture("prior-price-sheets.json");
  const incomingFixture = await loadFixture("incoming-price-sheets.json");
  const incoming = incomingFixture.sheets[0].sheet;
  const candidates = priorFixture.sheets.map(({ sheet }) => sheet).concat({
    ...priorFixture.sheets[0].sheet,
    id: "sheet-asv-newer",
    published_at: "2026-06-01T00:00:00.000Z",
  });
  assertEquals(
    selectPriorPriceSheetId(incoming, candidates),
    "sheet-asv-2026-01",
  );

  const fallback: PriceSheetHeader = {
    ...incoming,
    id: "sheet-asv-fallback",
    sheet_type: "price_book",
    supersedes_price_sheet_id: null,
  };
  const tiedCandidates: PriceSheetHeader[] = [
    {
      ...priorFixture.sheets[0].sheet,
      id: "sheet-z",
      sheet_type: "price_book",
      published_at: "2026-06-01T00:00:00.000Z",
    },
    {
      ...priorFixture.sheets[0].sheet,
      id: "sheet-a",
      sheet_type: null,
      published_at: "2026-06-01T00:00:00.000Z",
    },
    {
      ...priorFixture.sheets[0].sheet,
      id: "sheet-retail-newer",
      sheet_type: "retail_programs",
      published_at: "2026-07-01T00:00:00.000Z",
    },
  ];
  assertEquals(selectPriorPriceSheetId(fallback, tiedCandidates), "sheet-z");
  assertEquals(arePriceSheetTypesCompatible("price_book", null), true);
  assertEquals(
    arePriceSheetTypesCompatible("price_book", "retail_programs"),
    false,
  );
  assertEquals(arePriceSheetTypesCompatible("both", "retail_programs"), true);
});

Deno.test("invalid explicit predecessor and ambiguous same-brand rows fail closed", () => {
  const incoming: PriceSheetHeader = {
    id: "incoming",
    workspace_id: "ws-1",
    brand_id: "brand-1",
    status: "extracted",
    sheet_type: "price_book",
    supersedes_price_sheet_id: "wrong-brand-prior",
  };
  assertThrows(
    () =>
      selectPriorPriceSheetId(incoming, [{
        id: "wrong-brand-prior",
        workspace_id: "ws-1",
        brand_id: "brand-2",
        status: "published",
        sheet_type: "price_book",
        published_at: "2026-01-01T00:00:00.000Z",
      }]),
    Error,
    "outside the incoming sheet's workspace or brand",
  );

  const row: CanonicalPriceSheetRow = {
    sourceSheetId: "sheet",
    sourceItemId: "row-1",
    workspaceId: "ws-1",
    brandId: "brand-1",
    itemType: "list_price",
    identity: "model:RT40",
    modelCode: "RT-40",
    normalizedCode: "RT40",
    nameDisplay: "RT-40",
    amountCents: 100,
    catalogValue: { list_price_cents: 100 },
    metadata: {},
  };
  assertThrows(
    () =>
      diffCanonicalPriceSheetRows([], [
        row,
        { ...row, sourceItemId: "row-2" },
      ]),
    Error,
    "Ambiguous incoming price-sheet rows",
  );
});

Deno.test("unapplied review rows preserve prior state instead of inventing removal", () => {
  const prior: CanonicalPriceSheetRow = {
    sourceSheetId: "prior-sheet",
    sourceItemId: "prior-row",
    workspaceId: "ws-1",
    brandId: "brand-1",
    itemType: "list_price",
    identity: "model:RT40",
    modelCode: "RT-40",
    normalizedCode: "RT40",
    nameDisplay: "RT-40",
    amountCents: 100_000,
    catalogValue: { list_price_cents: 100_000 },
    metadata: {},
  };
  const pendingIdentity = {
    ...prior,
    sourceSheetId: "incoming-sheet",
    sourceItemId: "pending-row",
    amountCents: 120_000,
    catalogValue: { list_price_cents: 120_000 },
  };
  const overlaid = overlayPreservedPriorRows([prior], [], [pendingIdentity]);
  const diff = diffCanonicalPriceSheetRows([prior], overlaid);
  assertEquals(diff.length, 1);
  assertEquals(diff[0].changeKind, "unchanged");
  assertEquals(diff[0].newPriceCents, 100_000);
});
