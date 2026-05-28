// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import {
  classifyMateriality,
  deltaPct,
  evaluateMarginGate,
  impactStateFor,
  isStockLockedLine,
  normalizeModelCode,
} from "./impact-logic.ts";

Deno.test("classifyMateriality uses strict >2% line threshold", () => {
  assertEquals(
    classifyMateriality({ maxAbsLineDeltaPct: 2, totalDeltaCents: 0 }),
    "quiet",
  );
  assertEquals(
    classifyMateriality({ maxAbsLineDeltaPct: 2.01, totalDeltaCents: 0 }),
    "line_pct",
  );
});

Deno.test("classifyMateriality uses strict >$1,000 quote threshold", () => {
  assertEquals(
    classifyMateriality({ maxAbsLineDeltaPct: 0, totalDeltaCents: 100_000 }),
    "quiet",
  );
  assertEquals(
    classifyMateriality({ maxAbsLineDeltaPct: 0, totalDeltaCents: 100_001 }),
    "quote_delta",
  );
  assertEquals(
    classifyMateriality({ maxAbsLineDeltaPct: 3, totalDeltaCents: 100_001 }),
    "both",
  );
});

Deno.test("impactStateFor maps quiet vs visible", () => {
  assertEquals(impactStateFor("quiet"), "quiet");
  assertEquals(impactStateFor("line_pct"), "visible");
});

Deno.test("stock lock detects yard stock", () => {
  assertEquals(isStockLockedLine({ sourceLocation: "yard_stock" }), true);
  assertEquals(isStockLockedLine({ sourceLocation: "factory_order" }), false);
  assertEquals(isStockLockedLine({ isYardStock: true }), true);
});

Deno.test("margin gate requires manager review when floor is missing", () => {
  const gate = evaluateMarginGate({
    oldNetTotalCents: 200_000,
    totalDeltaCents: 20_000,
    oldMarginCents: 40_000,
    marginFloorPct: null,
    policyRequiresManagerReview: false,
  });
  assertEquals(
    gate.approvalRequiredReasons.includes("missing_margin_floor"),
    true,
  );
  assertEquals(gate.requiresManagerReview, true);
});

Deno.test("margin gate flags below floor and computes commission delta", () => {
  const gate = evaluateMarginGate({
    oldNetTotalCents: 100_000,
    totalDeltaCents: -10_000,
    oldMarginCents: 20_000,
    marginFloorPct: 15,
    policyRequiresManagerReview: false,
  });
  assertEquals(gate.projectedMarginPct, 11.11);
  assertEquals(gate.belowMarginFloor, true);
  assertEquals(gate.approvalRequiredReasons, ["below_margin_floor"]);
  assertEquals(gate.oldCommissionCents, 3_000);
  assertEquals(gate.projectedCommissionCents, 1_500);
  assertEquals(gate.commissionDeltaCents, -1_500);
});

Deno.test("manager-review policy reason is independent from numeric floor", () => {
  const gate = evaluateMarginGate({
    oldNetTotalCents: 100_000,
    totalDeltaCents: 10_000,
    oldMarginCents: 20_000,
    marginFloorPct: 10,
    policyRequiresManagerReview: true,
  });
  assertEquals(gate.belowMarginFloor, false);
  assertEquals(gate.approvalRequiredReasons, ["manager_review_policy"]);
});

Deno.test("model normalization and percent delta are stable", () => {
  assertEquals(normalizeModelCode(" TL 25-RP "), "TL25RP");
  assertEquals(deltaPct(100_000, 103_500), 3.5);
  assertEquals(deltaPct(0, 103_500), null);
});
