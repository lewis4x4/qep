import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { QuoteLineItemDraft } from "../../../../../../../shared/qep-moonshot-contracts";

import { PricingAdderBuckets } from "../PricingAdderBuckets";
import type { PricingAdderField, PricingLineKind } from "../../lib/pricing-adder-fields";

const noop = () => {};

function renderBuckets() {
  render(
    <PricingAdderBuckets
      draftPricingLines={[]}
      internalCostLoadTotal={0}
      pricingLineTotal={0}
      inboundFreightEligible={false}
      pricingLine={() => undefined}
      upsertPricingLine={noop as (
        fieldOrKind: PricingAdderField | PricingLineKind,
        amount: number,
        patch?: Partial<QuoteLineItemDraft>,
        legacyTitle?: string,
      ) => void}
      miscChargeTitle=""
      setMiscChargeTitle={noop}
      miscChargeAmount={0}
      setMiscChargeAmount={noop}
      miscCreditTitle=""
      setMiscCreditTitle={noop}
      miscCreditAmount={0}
      setMiscCreditAmount={noop}
      onAddMiscPricingLine={noop as (kind: "charge" | "credit") => void}
      onRemoveMiscLine={noop as (line: QuoteLineItemDraft) => void}
    />,
  );
}

describe("PricingAdderBuckets cash down/deposit semantics", () => {
  test("keeps miscellaneous pricing helper copy away from cash down and deposit aliases", () => {
    renderBuckets();

    expect(screen.queryByText(/down payment received/i)).toBeNull();
    expect(screen.getByText(/Cash down and deposits have dedicated fields/i)).toBeTruthy();
  });
});
