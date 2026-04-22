import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              integration_key: "quickbooks",
              display_name: "QuickBooks Online",
              status: "pending_credentials",
              last_test_success: null,
              last_test_error: null,
              last_sync_error: null,
              updated_at: "2026-04-22T12:00:00.000Z",
            },
            error: null,
          }),
        }),
        order: async () => {
          if (table === "customer_invoices") {
            return {
              data: [
                { id: "inv-1", invoice_number: "INV-1001", total: 2400, quickbooks_gl_status: "queued" },
              ],
              error: null,
            };
          }
          if (table === "quickbooks_gl_sync_jobs") {
            return {
              data: [
                {
                  id: "job-1",
                  invoice_id: "inv-1",
                  status: "queued",
                  quickbooks_txn_id: null,
                  error_message: null,
                  last_attempt_at: null,
                  customer_invoices: { invoice_number: "INV-1001", total: 2400, quickbooks_gl_status: "queued" },
                },
              ],
              error: null,
            };
          }
          if (table === "integration_status") {
            return { data: [], error: null };
          }
          return { data: [{ id: "branch-1", branch_id: "OCALA", default_labor_rate: 150 }], error: null };
        },
      }),
    }),
    functions: {
      invoke: async () => ({ data: { ok: true }, error: null }),
    },
  },
}));

const { QuickBooksGlSyncPage } = await import("../QuickBooksGlSyncPage");

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

describe("QuickBooksGlSyncPage (integration)", () => {
  test("renders integration status and queued invoices", async () => {
    render(
      <Providers>
        <QuickBooksGlSyncPage />
      </Providers>,
    );

    expect(screen.getByText("QuickBooks GL posting")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("INV-1001")).toBeTruthy();
    });

    expect(screen.getByText("pending_credentials")).toBeTruthy();
    expect(screen.getAllByText(/\$2,400/).length).toBeGreaterThan(0);
  });
});
