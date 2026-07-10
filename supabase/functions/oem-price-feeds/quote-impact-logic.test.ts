// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import {
  contextualCatalogChangesForQuote,
  currentQuoteAssignedRepId,
  isCustomerPriceLockActive,
  lineMatchesBrand,
  orderedChangeCategories,
} from "./quote-impact-logic.ts";
import type { CanonicalPriceSheetDiff } from "./price-sheet-diff.ts";

const brand = {
  id: "brand-asv",
  workspaceId: "ws-1",
  code: "ASV",
  name: "ASV",
};

function catalogDiff(
  itemType: "freight" | "rebate" | "incentive",
  metadata: Record<string, unknown>,
): CanonicalPriceSheetDiff {
  return {
    itemType,
    modelCode: null,
    normalizedCode: null,
    nameDisplay: `${itemType} change`,
    oldPriceCents: 100,
    newPriceCents: 125,
    deltaCents: 25,
    deltaPct: 25,
    changeKind: "increased",
    priorItemId: "prior",
    newItemId: "next",
    metadata,
  };
}

Deno.test("brand match requires exact normalized OEM code or name", () => {
  assertEquals(lineMatchesBrand("ASV", brand), true);
  assertEquals(lineMatchesBrand(" a-s-v ", brand), true);
  assertEquals(lineMatchesBrand("Bobcat", brand), false);
  assertEquals(lineMatchesBrand(null, brand), false);
});

Deno.test("customer lock is active through its expiration date and not after", () => {
  const snapshot = {
    priceLockActive: true,
    priceLockExpiresAt: "2026-07-09",
    deletedAt: null,
  };
  assertEquals(isCustomerPriceLockActive(snapshot, "2026-07-08"), true);
  assertEquals(isCustomerPriceLockActive(snapshot, "2026-07-09"), true);
  assertEquals(isCustomerPriceLockActive(snapshot, "2026-07-10"), false);
  assertEquals(
    isCustomerPriceLockActive(
      { ...snapshot, deletedAt: "2026-07-01" },
      "2026-07-09",
    ),
    false,
  );
  assertEquals(
    isCustomerPriceLockActive({
      priceLockActive: true,
      priceLockExpiresAt: null,
    }, "2026-07-09"),
    true,
  );
});

Deno.test("current quote authorization follows live deal assignment with creator fallback", () => {
  assertEquals(
    currentQuoteAssignedRepId({
      workspaceId: "ws-1",
      dealId: "deal-1",
      createdBy: "former-rep",
      deal: {
        workspaceId: "ws-1",
        assignedRepId: "current-rep",
        deletedAt: null,
      },
    }),
    "current-rep",
  );
  assertEquals(
    currentQuoteAssignedRepId({
      workspaceId: "ws-1",
      dealId: null,
      createdBy: "creator-rep",
    }),
    "creator-rep",
  );
  assertEquals(
    currentQuoteAssignedRepId({
      workspaceId: "ws-1",
      dealId: "deal-1",
      createdBy: "former-rep",
      deal: null,
    }),
    null,
  );
  assertEquals(
    currentQuoteAssignedRepId({
      workspaceId: "ws-1",
      dealId: "deal-1",
      createdBy: "former-rep",
      deal: {
        workspaceId: "ws-1",
        assignedRepId: "current-rep",
        deletedAt: "2026-07-09T00:00:00Z",
      },
    }),
    null,
  );
  assertEquals(
    currentQuoteAssignedRepId({
      workspaceId: "ws-1",
      dealId: "deal-1",
      createdBy: "former-rep",
      deal: {
        workspaceId: "ws-2",
        assignedRepId: "current-rep",
        deletedAt: null,
      },
    }),
    null,
  );
  assertEquals(
    currentQuoteAssignedRepId({
      workspaceId: "ws-1",
      dealId: "deal-1",
      createdBy: "creator-rep",
      deal: {
        workspaceId: "ws-1",
        assignedRepId: null,
        deletedAt: null,
      },
    }),
    "creator-rep",
  );
});

Deno.test("catalog contexts include matching freight/programs without quote dollars", () => {
  const changes = contextualCatalogChangesForQuote(
    [
      catalogDiff("freight", {
        state_codes: ["FL", "GA"],
        rate_class: "large",
      }),
      catalogDiff("freight", { state_codes: ["NY"], rate_class: "large" }),
      catalogDiff("rebate", { program_code: "ASV-CASH-26" }),
      catalogDiff("incentive", { program_code: "OTHER-PROGRAM" }),
    ],
    {
      deliveryState: "FL",
      selectedPromotionIds: ["program-asv"],
      programIdByNormalizedCode: {
        ASVCASH26: "program-asv",
        OTHERPROGRAM: "program-other",
      },
    },
  );

  assertEquals(changes.length, 2);
  assertEquals(changes[0].itemType, "freight");
  assertEquals(changes[0].contextStatus, "destination_zone_match");
  assertEquals(changes[1].itemType, "rebate");
  assertEquals(changes[1].contextStatus, "selected_program");
  assertEquals(
    changes.every((change) => change.quoteDeltaCents === null),
    true,
  );
});

Deno.test("missing persisted context stays catalog-only and category order is deterministic", () => {
  const changes = contextualCatalogChangesForQuote(
    [
      catalogDiff("incentive", { program_code: "FIN" }),
      catalogDiff("freight", { state_codes: ["FL"] }),
    ],
    {},
  );
  assertEquals(
    changes.map((change) => change.contextStatus),
    ["delivery_state_missing", "program_selection_missing"],
  );
  assertEquals(
    orderedChangeCategories(["incentive", "list_price", "freight", "freight"]),
    ["list_price", "freight", "incentive"],
  );
});

Deno.test("freight with a destination but no zone mapping is never labeled a destination match", () => {
  const [change] = contextualCatalogChangesForQuote(
    [catalogDiff("freight", { rate_class: "large" })],
    { deliveryState: "FL" },
  );
  assertEquals(change.contextStatus, "zone_mapping_missing");
  assertEquals(change.quoteDeltaCents, null);
});
