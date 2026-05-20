import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";
import type { OwnerMarginExceptionFilters, OwnerMarginExceptionRow } from "@/features/owner/lib/owner-api";

const marginRows: OwnerMarginExceptionRow[] = [
  {
    exception_id: "exception-1",
    workspace_id: "default",
    exception_created_at: "2026-05-20T12:00:00.000Z",
    quote_package_id: "quote-1",
    brand_id: "brand-1",
    brand_code: "DEERE",
    brand_name: "John Deere",
    rep_id: "rep-1",
    rep_name: "Avery Rep",
    quoted_margin_pct: 7.5,
    threshold_margin_pct: 10,
    delta_pts: -2.5,
    estimated_gap_cents: 125000,
    reason: "Competitive match required",
    approval_case_id: "case-1",
    quote_number: "Q-1001",
    customer_name: "Cooper Timber",
    customer_company: "Cooper Timber LLC",
    branch_name: "Louisville",
    net_total: 250000,
    approval_margin_pct: 7.5,
    approval_status: "pending",
    assigned_to: "owner-1",
    assigned_to_name: "Olivia Owner",
    assigned_role: "owner",
    decided_by: null,
    decided_by_name: null,
    decided_at: null,
    decision_note: null,
  },
  {
    exception_id: "exception-2",
    workspace_id: "default",
    exception_created_at: "2026-05-19T12:00:00.000Z",
    quote_package_id: "quote-2",
    brand_id: null,
    brand_code: null,
    brand_name: null,
    rep_id: "rep-2",
    rep_name: "Blake Sales",
    quoted_margin_pct: 8,
    threshold_margin_pct: 11,
    delta_pts: -3,
    estimated_gap_cents: null,
    reason: "Fleet conquest",
    approval_case_id: null,
    quote_number: "Q-1002",
    customer_name: "River Quarry",
    customer_company: null,
    branch_name: null,
    net_total: null,
    approval_margin_pct: null,
    approval_status: null,
    assigned_to: null,
    assigned_to_name: null,
    assigned_role: null,
    decided_by: null,
    decided_by_name: null,
    decided_at: null,
    decision_note: null,
  },
];

const fetchOwnerMarginExceptions = mock(async (filters: OwnerMarginExceptionFilters = {}) => {
  if (filters.approvalStatus === "no_approval") {
    return marginRows.filter((row) => row.approval_status === null);
  }
  if (filters.approvalStatus) {
    return marginRows.filter((row) => row.approval_status === filters.approvalStatus);
  }
  if (filters.repId) {
    return marginRows.filter((row) => row.rep_id === filters.repId);
  }
  return marginRows;
});

mock.module("@/features/owner/lib/owner-api", () => ({
  fetchOwnerMarginExceptions,
}));

const { MarginExceptionsPage } = await import("../MarginExceptionsPage");

function Providers({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("MarginExceptionsPage (integration)", () => {
  test("renders margin exception rows with approval context", async () => {
    render(
      <Providers>
        <MarginExceptionsPage />
      </Providers>,
    );

    expect(screen.getByText("Owner margin exception report")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Cooper Timber LLC")).toBeTruthy();
    });

    expect(screen.getAllByText("Avery Rep").length).toBeGreaterThan(0);
    expect(screen.getByText("Q-1001")).toBeTruthy();
    expect(screen.getByText("7.5% vs floor 10.0%")).toBeTruthy();
    expect(screen.getAllByText("$1,250").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getByText("Olivia Owner")).toBeTruthy();
  });

  test("filters by search text and no-approval status", async () => {
    render(
      <Providers>
        <MarginExceptionsPage />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("Cooper Timber LLC")).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("Search rep, customer, quote, reason"), {
      target: { value: "River" },
    });
    expect(screen.queryByText("Cooper Timber LLC")).toBeNull();
    expect(screen.getByText("River Quarry")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("All statuses"), {
      target: { value: "no_approval" },
    });

    await waitFor(() => {
      expect(fetchOwnerMarginExceptions).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: "no_approval" }));
    });
    expect(screen.getAllByText("Blake Sales").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No approval case").length).toBeGreaterThan(0);
  });
});
