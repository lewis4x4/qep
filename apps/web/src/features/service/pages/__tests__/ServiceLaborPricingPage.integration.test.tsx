import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      id: "user-1",
      full_name: "Jordan Lane",
      role: "admin",
    },
  }),
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: async () => {
          if (table === "service_branch_config") {
            return { data: [{ id: "branch-1", branch_id: "OCALA", default_labor_rate: 150 }], error: null };
          }
          if (table === "qrm_companies") {
            return { data: [{ id: "cust-1", name: "Evergreen Farms" }], error: null };
          }
          if (table === "service_labor_pricing_rules") {
            return {
              data: [
                {
                  id: "rule-1",
                  location_code: "OCALA",
                  customer_id: null,
                  customer_group_label: null,
                  work_order_status: "customer",
                  labor_type_code: "SHOP",
                  premium_code: null,
                  default_premium_code: "STD",
                  comment: "Default customer shop labor",
                  pricing_code: "fixed_price",
                  pricing_value: 175,
                  active: true,
                  effective_start_on: null,
                  effective_end_on: null,
                  qrm_companies: null,
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

const { ServiceLaborPricingPage } = await import("../ServiceLaborPricingPage");

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

describe("ServiceLaborPricingPage (integration)", () => {
  test("renders branch defaults and labor pricing rules", async () => {
    render(
      <Providers>
        <ServiceLaborPricingPage />
      </Providers>,
    );

    expect(screen.getByText("Tiered labor pricing")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByText("OCALA").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Default customer shop labor")).toBeTruthy();
    expect(screen.getByText("$175.00/hr fixed")).toBeTruthy();
  });
});
