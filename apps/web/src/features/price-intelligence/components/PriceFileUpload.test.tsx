import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { PriceFileUpload } from "./PriceFileUpload";

afterEach(cleanup);

function renderUpload() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PriceFileUpload />
    </QueryClientProvider>,
  );
}

describe("PriceFileUpload legacy guardrail", () => {
  test("marks the retained direct importer as admin-only and outside Phase 1", () => {
    renderUpload();

    expect(screen.getByText("Legacy direct importer (admin-only)")).toBeTruthy();
    expect(screen.getByText(/Outside Phase 1 OEM price feeds/i)).toBeTruthy();
    expect(screen.getByText(/Use Admin Price Sheets for staged upload/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Legacy import outside Phase 1/i })).toBeTruthy();
  });
});
