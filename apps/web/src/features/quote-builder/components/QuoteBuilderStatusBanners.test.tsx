import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QuoteBuilderStatusBanners } from "./QuoteBuilderStatusBanners";

afterEach(cleanup);

describe("QuoteBuilderStatusBanners OEM protection", () => {
  test("renders no OEM warning for an unaffected quote", () => {
    render(
      <MemoryRouter>
        <QuoteBuilderStatusBanners />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/OEM price review required/i)).toBeNull();
  });

  test("blocks silent review/send by linking an impacted quote to the reprice queue", () => {
    render(
      <MemoryRouter>
        <QuoteBuilderStatusBanners
          oemImpactReviewHref="/sales/price-impacts?quote_package_id=quote-1"
        />
      </MemoryRouter>,
    );

    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("OEM price review required");
    expect(warning.textContent).toContain("no customer communication is sent automatically");
    expect(
      screen.getByRole("link", { name: /review OEM impact/i }).getAttribute("href"),
    ).toBe("/sales/price-impacts?quote_package_id=quote-1");
  });
});
