import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: async () => {
          if (table === "owner_data_miner_profitability") {
            return {
              data: [
                {
                  company_id: "company-1",
                  customer_name: "Cooper Timber",
                  closed_month: "2026-04-01",
                  won_deal_count: 2,
                  sales_amount: 100000,
                  gross_margin_amount: 24000,
                  gross_margin_pct: 24,
                  last_closed_at: "2026-04-20T00:00:00.000Z",
                },
              ],
              error: null,
            };
          }
          if (table === "owner_data_miner_credit_exposure") {
            return {
              data: [
                {
                  company_id: "company-1",
                  customer_name: "Cooper Timber",
                  open_invoice_count: 3,
                  overdue_invoice_count: 2,
                  open_balance_due: 60000,
                  overdue_balance_due: 52000,
                  max_days_past_due: 94,
                  oldest_due_date: "2026-01-02",
                  last_invoice_at: "2026-04-20T00:00:00.000Z",
                  block_status: "active",
                  block_reason: "AR block",
                  current_max_aging_days: 94,
                  override_until: null,
                  blocked_at: "2026-04-21T00:00:00.000Z",
                  exposure_band: "critical",
                },
              ],
              error: null,
            };
          }
          return {
            data: [
              {
                labor_date: "2026-04-20",
                branch_id: "01",
                shop_or_field: "field",
                technician_id: "tech-1",
                technician_name: "Colton Noerring",
                job_count: 2,
                hours_worked: 12.5,
                billed_value: 5000,
                quoted_value: 6200,
                closed_job_count: 1,
              },
            ],
            error: null,
          };
        },
      }),
    }),
  },
}));

const { DataMinerEquivalentsPage } = await import("../DataMinerEquivalentsPage");

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

describe("DataMinerEquivalentsPage (integration)", () => {
  test("renders profitability, credit, and service equivalents", async () => {
    render(
      <Providers>
        <DataMinerEquivalentsPage />
      </Providers>,
    );

    expect(screen.getByText("Curated management intelligence, without the legacy query builder")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Cooper Timber")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "AR Exposure" }));
    expect(screen.getByText("critical")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Service Labor" }));
    expect(screen.getByText("Colton Noerring")).toBeTruthy();
  });
});
