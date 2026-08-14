import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

type VendorQueryResult = {
  data: Array<Record<string, unknown>> | null;
  error: { message: string } | null;
};

let vendorQueryResult: VendorQueryResult = {
  data: null,
  error: { message: "permission denied for table vendor_profiles" },
};

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        if (table !== "vendor_profiles") {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve(vendorQueryResult);
      },
    }),
  },
}));

const { VendorMetricsCard } = await import("../VendorMetricsCard");

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

describe("VendorMetricsCard", () => {
  test("does not render raw Postgres permission text when vendor_profiles is denied", async () => {
    vendorQueryResult = {
      data: null,
      error: { message: "permission denied for table vendor_profiles" },
    };

    render(
      <Providers>
        <VendorMetricsCard />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("Vendor metrics unavailable.")).toBeTruthy();
    });

    expect(screen.queryByText(/permission denied for table vendor_profiles/i)).toBeNull();
  });

  test("renders vendor scorecard metrics when vendor_profiles read succeeds", async () => {
    vendorQueryResult = {
      data: [
        {
          id: "vendor-1",
          name: "Yanmar Parts",
          avg_lead_time_hours: 24,
          responsiveness_score: 0.82,
          fill_rate: 0.91,
          price_competitiveness: 0.7,
          composite_score: 0.85,
          machine_down_priority: true,
        },
      ],
      error: null,
    };

    render(
      <Providers>
        <VendorMetricsCard />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("Vendor scorecard")).toBeTruthy();
    });

    expect(screen.getByText("Yanmar Parts")).toBeTruthy();
    expect(screen.getByText("91%")).toBeTruthy();
    expect(screen.getByText("1 machine-down")).toBeTruthy();
    expect(screen.queryByText(/permission denied/i)).toBeNull();
  });
});
