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
        in: () => ({ order: () => ({ returns: async () => tableRows(table) }) }),
        order: () => ({ returns: async () => tableRows(table) }),
      }),
    }),
    functions: {
      invoke: async (_fn: string, payload?: { body?: Record<string, unknown> }) => {
        const action = payload?.body?.action;
        if (action === "config_summary" || action === "save_config" || action === "clear_config") {
          return {
            data: {
              ok: true,
              summary: {
                integration: {
                  display_name: "QuickBooks Online GL",
                  status: "pending_credentials",
                  last_test_success: null,
                  last_test_error: null,
                  last_sync_error: null,
                  updated_at: "2026-04-22T12:00:00.000Z",
                },
                config: {
                  client_id: "client-123",
                  realm_id: "realm-123",
                  environment: "production",
                  has_client_secret: true,
                  has_refresh_token: true,
                  account_ids: {
                    ar_account_id: "100",
                    service_revenue_account_id: "200",
                    parts_revenue_account_id: "201",
                    haul_revenue_account_id: "202",
                    shop_supplies_account_id: "203",
                    misc_revenue_account_id: "299",
                    tax_liability_account_id: "300",
                  },
                  credential_count: 4,
                  account_mapping_count: 7,
                  core_ready: true,
                  ready_for_sync: true,
                },
              },
            },
            error: null,
          };
        }
        if (action === "test_connection") {
          return {
            data: {
              ok: true,
              company_info: {
                CompanyInfo: {
                  CompanyName: "QEP Demo Company",
                  LegalName: "Quality Equipment & Parts LLC",
                  Country: "US",
                },
              },
            },
            error: null,
          };
        }
        return { data: { ok: true }, error: null };
      },
    },
  },
}));

function tableRows(table: string) {
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
}

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
  test("renders setup readiness and queued invoices", async () => {
    render(
      <Providers>
        <QuickBooksGlSyncPage />
      </Providers>,
    );

    expect(screen.getByText("QuickBooks GL command center")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Ready to post journal entries")).toBeTruthy();
    });

    expect(screen.getByText("INV-1001")).toBeTruthy();
    expect(screen.getByText("Ready to post journal entries")).toBeTruthy();
    expect(screen.getByText("Credentials and account mapping")).toBeTruthy();
    expect(screen.getByText("QuickBooks company handshake")).toBeTruthy();
    expect(screen.getAllByText(/\$2,400/).length).toBeGreaterThan(0);
  });
});
