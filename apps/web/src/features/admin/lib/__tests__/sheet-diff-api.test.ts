import { describe, expect, test } from "bun:test";
import {
  aggregateDiffSummary,
  computeModelDiff,
  impactForOpenQuote,
  normalizeCode,
  type ModelPriceChange,
  type QuoteEquipmentLine,
} from "../sheet-diff-api";
import type { Database } from "@/lib/database.types";

type SheetItemRow = Database["public"]["Tables"]["qb_price_sheet_items"]["Row"];

function modelItem(code: string, priceCents: number, name = code): SheetItemRow {
  return {
    id:                     crypto.randomUUID(),
    workspace_id:           "default",
    price_sheet_id:         "sheet-1",
    item_type:              "model",
    extracted:              { model_code: code, name_display: name, list_price_cents: priceCents },
    extraction_metadata:    null,
    diff:                   null,
    proposed_model_id:      null,
    proposed_attachment_id: null,
    action:                 "create",
    confidence:             1,
    review_status:          "pending",
    reviewer_notes:         null,
    applied_at:             null,
    created_at:             "2026-04-20T00:00:00Z",
  } as SheetItemRow;
}

// ── normalizeCode ────────────────────────────────────────────────────────

describe("normalizeCode", () => {
  test("null / undefined / empty → ''", () => {
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
    expect(normalizeCode("")).toBe("");
  });

  test("lowercases + strips whitespace/punct", () => {
    expect(normalizeCode("RT-135")).toBe("rt135");
    expect(normalizeCode("rt 135")).toBe("rt135");
    expect(normalizeCode("RT_135")).toBe("rt135");
    expect(normalizeCode("rt.135")).toBe("rt135");
    expect(normalizeCode("rt/135")).toBe("rt135");
  });
});

// ── computeModelDiff ─────────────────────────────────────────────────────

describe("computeModelDiff", () => {
  test("empty → empty", () => {
    expect(computeModelDiff([], [])).toEqual([]);
  });

  test("new model → kind=new, old null", () => {
    const out = computeModelDiff([], [modelItem("RT-135", 100_000_00)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      modelCode: "RT-135",
      kind: "new",
      oldPriceCents: null,
      newPriceCents: 100_000_00,
    });
  });

  test("removed model → kind=removed, new null", () => {
    const out = computeModelDiff([modelItem("OLD-100", 50_000_00)], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      modelCode: "OLD-100",
      kind: "removed",
      oldPriceCents: 50_000_00,
      newPriceCents: null,
    });
  });

  test("price increased → kind=increased with deltas", () => {
    const out = computeModelDiff(
      [modelItem("RT-135", 100_000_00)],
      [modelItem("RT-135", 110_000_00)],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      modelCode: "RT-135",
      kind: "increased",
      oldPriceCents: 100_000_00,
      newPriceCents: 110_000_00,
      deltaCents: 10_000_00,
      deltaPct: 10,
    });
  });

  test("price decreased → kind=decreased with negative delta", () => {
    const out = computeModelDiff(
      [modelItem("RT-135", 100_000_00)],
      [modelItem("RT-135", 95_000_00)],
    );
    expect(out[0]).toMatchObject({
      kind: "decreased",
      deltaCents: -5_000_00,
      deltaPct: -5,
    });
  });

  test("unchanged price → kind=unchanged", () => {
    const out = computeModelDiff(
      [modelItem("RT-135", 100_000_00)],
      [modelItem("RT-135", 100_000_00)],
    );
    expect(out[0]).toMatchObject({ kind: "unchanged", deltaCents: 0 });
  });

  test("tolerant to formatting differences (RT-135 vs rt 135)", () => {
    const out = computeModelDiff(
      [modelItem("RT-135", 100_000_00)],
      [modelItem("rt 135", 110_000_00)],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "increased", deltaCents: 10_000_00 });
  });

  test("sort: largest absolute delta first", () => {
    const prior = [
      modelItem("A", 100_00),
      modelItem("B", 100_00),
      modelItem("C", 100_00),
    ];
    const next = [
      modelItem("A", 110_00), // +10
      modelItem("B", 150_00), // +50 ← biggest
      modelItem("C", 105_00), // +5
    ];
    const out = computeModelDiff(prior, next);
    expect(out.map((c) => c.modelCode)).toEqual(["B", "A", "C"]);
  });

  test("changed rows sort above new above removed above unchanged", () => {
    const prior = [modelItem("CHANGED", 100_00), modelItem("REMOVED", 50_00)];
    const next  = [modelItem("CHANGED", 200_00), modelItem("NEW", 80_00)];
    const out = computeModelDiff(prior, next);
    expect(out.map((c) => c.kind)).toEqual(["increased", "new", "removed"]);
  });
});

// ── aggregateDiffSummary ─────────────────────────────────────────────────

describe("aggregateDiffSummary", () => {
  test("empty → baseline zeros", () => {
    const s = aggregateDiffSummary([]);
    expect(s).toMatchObject({
      totalChanges: 0,
      newModels: 0,
      removedModels: 0,
      pricesIncreased: 0,
      pricesDecreased: 0,
      totalDeltaCents: 0,
      avgDeltaPct: null,
    });
  });

  test("counts each kind correctly", () => {
    const changes: ModelPriceChange[] = [
      { modelCode: "A", nameDisplay: null, oldPriceCents: 100_00, newPriceCents: 110_00, deltaCents: 10_00,  deltaPct: 10,  kind: "increased" },
      { modelCode: "B", nameDisplay: null, oldPriceCents: 100_00, newPriceCents:  90_00, deltaCents: -10_00, deltaPct: -10, kind: "decreased" },
      { modelCode: "C", nameDisplay: null, oldPriceCents: null,   newPriceCents: 200_00, deltaCents: 0,      deltaPct: 0,   kind: "new" },
      { modelCode: "D", nameDisplay: null, oldPriceCents: 50_00,  newPriceCents: null,   deltaCents: 0,      deltaPct: 0,   kind: "removed" },
      { modelCode: "E", nameDisplay: null, oldPriceCents: 100_00, newPriceCents: 100_00, deltaCents: 0,      deltaPct: 0,   kind: "unchanged" },
    ];
    const s = aggregateDiffSummary(changes);
    expect(s.totalChanges).toBe(4);
    expect(s.pricesIncreased).toBe(1);
    expect(s.pricesDecreased).toBe(1);
    expect(s.newModels).toBe(1);
    expect(s.removedModels).toBe(1);
    expect(s.totalDeltaCents).toBe(0);  // +10 -10 = 0
    expect(s.avgDeltaPct).toBe(0);       // avg of +10, -10
    expect(s.largestIncreaseCents).toBe(10_00);
    expect(s.largestDecreaseCents).toBe(-10_00);
  });

  test("total delta = sum of changed deltas only (new/removed excluded)", () => {
    const changes: ModelPriceChange[] = [
      { modelCode: "A", nameDisplay: null, oldPriceCents: 100, newPriceCents: 130, deltaCents: 30, deltaPct: 30, kind: "increased" },
      { modelCode: "B", nameDisplay: null, oldPriceCents: null, newPriceCents: 500, deltaCents: 0, deltaPct: 0, kind: "new" },
    ];
    expect(aggregateDiffSummary(changes).totalDeltaCents).toBe(30);
  });
});

// ── impactForOpenQuote ──────────────────────────────────────────────────

describe("impactForOpenQuote", () => {
  function change(code: string, oldCents: number, newCents: number): ModelPriceChange {
    return {
      modelCode:     code,
      nameDisplay:   null,
      oldPriceCents: oldCents,
      newPriceCents: newCents,
      deltaCents:    newCents - oldCents,
      deltaPct:      ((newCents - oldCents) / oldCents) * 100,
      kind:          newCents > oldCents ? "increased" : "decreased",
    };
  }

  test("empty equipment → zero delta", () => {
    expect(impactForOpenQuote([], [change("RT-135", 100_00, 110_00)])).toEqual({
      deltaCents: 0,
      lines: [],
    });
  });

  test("no model match → zero delta", () => {
    const eq: QuoteEquipmentLine[] = [{ model: "UNKNOWN", price: 100_00 }];
    expect(impactForOpenQuote(eq, [change("RT-135", 100_00, 110_00)])).toEqual({
      deltaCents: 0,
      lines: [],
    });
  });

  test("single matched line sums delta correctly", () => {
    const eq: QuoteEquipmentLine[] = [{ id: "line-1", model: "rt135", price: 100_00 }];
    const out = impactForOpenQuote(eq, [change("RT-135", 100_00, 110_00)]);
    expect(out.deltaCents).toBe(10_00);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({
      lineId: "line-1",
      modelCode: "RT-135",
      deltaCents: 10_00,
    });
  });

  test("multiple matched lines aggregate", () => {
    const eq: QuoteEquipmentLine[] = [
      { model: "RT-135",  price: 100_00 },
      { model: "RT-120",  price: 80_00  },
    ];
    const changes = [
      change("RT-135", 100_00, 110_00),
      change("RT-120",  80_00,  75_00),
    ];
    const out = impactForOpenQuote(eq, changes);
    expect(out.deltaCents).toBe(10_00 - 5_00);  // +10 -5 = +5
    expect(out.lines).toHaveLength(2);
  });

  test("ignores new/removed/unchanged kinds", () => {
    const eq: QuoteEquipmentLine[] = [{ model: "NEW-ONE", price: 0 }];
    const changes: ModelPriceChange[] = [
      { modelCode: "NEW-ONE", nameDisplay: null, oldPriceCents: null, newPriceCents: 500, deltaCents: 0, deltaPct: 0, kind: "new" },
    ];
    expect(impactForOpenQuote(eq, changes).deltaCents).toBe(0);
  });

  test("tolerant matching across formats", () => {
    const eq: QuoteEquipmentLine[] = [{ model: "rt 135", price: 100_00 }];
    const out = impactForOpenQuote(eq, [change("RT-135", 100_00, 110_00)]);
    expect(out.deltaCents).toBe(10_00);
  });
});
