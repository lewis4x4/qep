import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

import { TaxBreakdown } from "../TaxBreakdown";
import type { TaxCalculation } from "../../lib/tax-api";

function taxCalculation(overrides: Partial<TaxCalculation> = {}): TaxCalculation {
  return {
    tax_lines: [],
    total_tax: 0,
    state_tax: 0,
    county_tax: 0,
    taxable_basis: 0,
    exemptions_applied: [],
    section_179: null,
    equipment_cost: 0,
    ...overrides,
  };
}

describe("TaxBreakdown A1.1 staging QA evidence", () => {
  test("shows Tax Exempt badge and no tax total when a valid certificate exemption is applied", () => {
    render(
      <TaxBreakdown
        data={taxCalculation({
          taxable_basis: 125_000,
          exemptions_applied: ["agriculture (cert #A-1)"],
        })}
      />,
    );

    expect(screen.getByText("Tax Exempt")).toBeTruthy();
    expect(screen.getByText("✓ agriculture (cert #A-1)")).toBeTruthy();
    expect(screen.queryByText("Total Tax")).toBeNull();
  });
});
