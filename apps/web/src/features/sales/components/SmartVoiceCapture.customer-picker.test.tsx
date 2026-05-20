import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RepCustomer } from "../lib/types";

const searchCalls: Array<{ query: string; limit: number; signal?: AbortSignal }> = [];
let workspaceRows: RepCustomer[] = [];
const searchCompaniesForPickerMock = mock(
  async (query: string, limit = 8, signal?: AbortSignal) => {
    searchCalls.push({ query, limit, signal });
    return workspaceRows;
  },
);

import { CustomerPickerInline } from "./CustomerPickerInline";

function customer(overrides: Partial<RepCustomer> = {}): RepCustomer {
  return {
    customer_id: overrides.customer_id ?? "customer-1",
    company_name: overrides.company_name ?? "Acme Contractors",
    search_1: overrides.search_1 ?? null,
    search_2: overrides.search_2 ?? null,
    primary_contact_name: overrides.primary_contact_name ?? null,
    primary_contact_phone: overrides.primary_contact_phone ?? null,
    primary_contact_email: overrides.primary_contact_email ?? null,
    city: overrides.city ?? null,
    state: overrides.state ?? null,
    open_deals: overrides.open_deals ?? 0,
    active_quotes: overrides.active_quotes ?? 0,
    last_interaction: overrides.last_interaction ?? null,
    days_since_contact: overrides.days_since_contact ?? null,
    opportunity_score: overrides.opportunity_score ?? 0,
    equipment_summary: overrides.equipment_summary ?? [],
  };
}

function renderPicker({
  bookCustomers,
  initialSearch,
  onPick = () => {},
}: {
  bookCustomers: RepCustomer[];
  initialSearch?: string;
  onPick?: (picked: { id: string; name: string }) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomerPickerInline
        bookCustomers={bookCustomers}
        initialSearch={initialSearch}
        searchCompanies={searchCompaniesForPickerMock}
        onPick={onPick}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  searchCalls.length = 0;
  workspaceRows = [];
  searchCompaniesForPickerMock.mockClear();
});

afterEach(cleanup);


describe("CustomerPickerInline", () => {
  test("uses token-based contrast classes for input and option states", () => {
    renderPicker({
      bookCustomers: [
        customer({
          customer_id: "book-contrast",
          company_name: "Contrast Ready Customer",
        }),
      ],
    });

    const input = screen.getByPlaceholderText("Customer name…");
    expect(input.className).toContain("border-input");
    expect(input.className).toContain("text-foreground");
    expect(input.className).toContain("placeholder:text-muted-foreground");
    expect(input.className).toContain("focus-visible:ring-2");
    expect(input.className).toContain("focus-visible:ring-ring/40");

    const optionButton = screen.getByRole("button", { name: /Contrast Ready Customer/i });
    expect(optionButton.className).toContain("hover:bg-accent");
    expect(optionButton.className).toContain("hover:text-accent-foreground");
    expect(optionButton.className).toContain("focus-visible:bg-accent");
    expect(optionButton.className).toContain("focus-visible:text-accent-foreground");
  });

  test("keeps DREC legacy prefix matches inside the rep book", () => {
    renderPicker({
      initialSearch: "dr",
      bookCustomers: [
        customer({
          customer_id: "book-drec",
          company_name: "Delta Recycling Equipment Co",
          search_1: "DREC",
        }),
      ],
    });

    expect(screen.getByText("Delta Recycling Equipment Co")).toBeTruthy();
    expect(screen.queryByTestId("customer-picker-fallback-copy")).toBeNull();
    expect(searchCompaniesForPickerMock).not.toHaveBeenCalled();
  });

  test("finds Precision Land through workspace fallback when absent from first 100 rep-book rows", async () => {
    const picked: Array<{ id: string; name: string }> = [];
    const first100RepBookRows = Array.from({ length: 100 }, (_, index) =>
      customer({
        customer_id: `book-${index}`,
        company_name: `Rep Book Customer ${index}`,
        search_1: `RBC${index}`,
      }),
    );
    workspaceRows = [
      customer({
        customer_id: "workspace-precision-land",
        company_name: "Precision Land Management",
        city: "Chiefland",
        state: "FL",
      }),
    ];

    renderPicker({
      initialSearch: "Precision",
      bookCustomers: first100RepBookRows,
      onPick: (row) => picked.push(row),
    });

    await waitFor(() => {
      expect(screen.getByText("Precision Land Management")).toBeTruthy();
    });

    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].query).toBe("Precision");
    expect(searchCalls[0].limit).toBe(8);
    expect(searchCalls[0].signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByTestId("customer-picker-fallback-copy").textContent).toContain(
      "No rep-book match. Showing workspace customer results.",
    );
    expect(screen.getByText("Workspace")).toBeTruthy();

    fireEvent.click(screen.getByText("Precision Land Management"));
    expect(picked).toEqual([
      { id: "workspace-precision-land", name: "Precision Land Management" },
    ]);
  });
});
