import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const routerApiModulePath = new URL("../../lib/qrm-router-api.ts", import.meta.url).pathname;

const fetchEquipmentInvoiceReversalCandidate = mock(async () => ({
  stockNumber: "STK-103",
  equipmentId: "equipment-103",
  invoiceId: "invoice-103",
  invoiceNumber: "EQ-1003",
  invoiceStatus: "partial",
  quickbooksGlStatus: "posted",
  postingPeriodStatus: "open",
  equipmentInOutState: "sold",
  candidateStatus: "blocked" as const,
  blockers: [
    "invoice_status_blocks_reversal",
    "quickbooks_posted_invoice_requires_finance_policy",
  ],
}));

mock.module(routerApiModulePath, () => ({
  fetchEquipmentInvoiceReversalCandidate,
}));

const { EquipmentReversalReadinessCard } = await import("../EquipmentReversalReadinessCard");

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function TestProviders({
  children,
  queryClient = createTestQueryClient(),
}: PropsWithChildren<{ queryClient?: QueryClient }>) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

describe("EquipmentReversalReadinessCard", () => {
  beforeEach(() => {
    fetchEquipmentInvoiceReversalCandidate.mockClear();
  });

  test("renders read-only blocker diagnostics for an elevated stock-number lookup", async () => {
    render(
      <TestProviders>
        <EquipmentReversalReadinessCard stockNumber=" STK-103 " canReadReadiness />
      </TestProviders>,
    );

    await waitFor(() => {
      expect(fetchEquipmentInvoiceReversalCandidate).toHaveBeenCalledWith("STK-103");
    });

    expect(screen.getByText("Sale Reversal Readiness")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.getByText("Candidate blocked")).toBeTruthy();
    expect(screen.getByText("EQ-1003")).toBeTruthy();
    expect(screen.getByText(/Partially paid, paid, void, or already reversed invoices are blocked/)).toBeTruthy();
    expect(screen.getByText(/QuickBooks-posted invoices require an approved finance reversal policy/)).toBeTruthy();
    expect(screen.getByText(/does not authorize reversal execution/)).toBeTruthy();
  });

  test("does not call the elevated guard for non-elevated users", () => {
    render(
      <TestProviders>
        <EquipmentReversalReadinessCard stockNumber="STK-103" canReadReadiness={false} />
      </TestProviders>,
    );

    expect(fetchEquipmentInvoiceReversalCandidate).not.toHaveBeenCalled();
    expect(screen.getByText(/Elevated QRM access is required/)).toBeTruthy();
  });

  test("does not render cached elevated candidate data after access is removed", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["crm", "equipment", "reversal-candidate", "STK-103"], {
      stockNumber: "STK-103",
      equipmentId: "equipment-103",
      invoiceId: "invoice-103",
      invoiceNumber: "EQ-CACHED",
      invoiceStatus: "sent",
      quickbooksGlStatus: "not_synced",
      postingPeriodStatus: "open",
      equipmentInOutState: "sold",
      candidateStatus: "ready" as const,
      blockers: [],
    });

    render(
      <TestProviders queryClient={queryClient}>
        <EquipmentReversalReadinessCard stockNumber="STK-103" canReadReadiness={false} />
      </TestProviders>,
    );

    expect(fetchEquipmentInvoiceReversalCandidate).not.toHaveBeenCalled();
    expect(screen.getByText(/Elevated QRM access is required/)).toBeTruthy();
    expect(screen.queryByText("EQ-CACHED")).toBeNull();
    expect(screen.queryByText("Candidate ready")).toBeNull();
  });
});
