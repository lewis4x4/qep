import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

mock.module("@/components/RequireAdmin", () => ({
  RequireAdmin: ({ children }: PropsWithChildren) => children,
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: async () => {
          if (table === "vendor_profiles") {
            return { data: [{ id: "vendor-1", name: "Kubota Credit" }], error: null };
          }
          if (table === "ap_aging_view") {
            return {
              data: [
                {
                  id: "bill-1",
                  vendor_id: "vendor-1",
                  vendor_name: "Kubota Credit",
                  invoice_number: "AP-1001",
                  invoice_date: "2026-04-01",
                  due_date: "2026-05-01",
                  payable_account_code: "AP-TRACTORS",
                  payable_account_name: "Tractor Payables",
                  description: "Track loader rental bill",
                  status: "pending_approval",
                  approval_status: "pending",
                  total_amount: 2400,
                  amount_paid: 0,
                  balance_due: 2400,
                  due_age_bucket: "current",
                  invoice_age_bucket: "current",
                  days_overdue: 0,
                  days_from_invoice: 21,
                },
              ],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      }),
    }),
  },
}));

const { AccountsPayablePage } = await import("../AccountsPayablePage");

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

describe("AccountsPayablePage (integration)", () => {
  test("renders AP aging cards and bill rows", async () => {
    render(
      <Providers>
        <AccountsPayablePage />
      </Providers>,
    );

    expect(screen.getByText("A/P Outstanding")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByText("Kubota Credit").length).toBeGreaterThan(0);
    });

    expect(screen.getByText(/AP-1001/)).toBeTruthy();
    expect(screen.getAllByText(/Current/).length).toBeGreaterThan(0);
  });
});
