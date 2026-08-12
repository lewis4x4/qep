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
      role: "rep",
      active_workspace_id: "default",
    },
  }),
}));

function createOrderedResult(table: string) {
  if (table === "service_agreements") {
    return {
      data: [
        {
          id: "agreement-1",
          contract_number: "SAM-2026-001",
          status: "active",
          customer_id: "cust-1",
          equipment_id: "eq-1",
          location_code: "OCALA",
          program_id: "program-1",
          program_name: "Premier PM",
          category: "Excavator",
          coverage_summary: null,
          starts_on: "2026-04-01",
          expires_on: "2027-04-01",
          renewal_date: null,
          billing_cycle: "annual",
          term_months: 12,
          included_pm_services: 4,
          estimated_contract_value: null,
          notes: null,
          qrm_companies: { name: "Evergreen Farms" },
          qrm_equipment: { stock_number: "EQ-44", serial_number: "SER-900", make: "Kubota", model: "KX080", name: "Kubota KX080" },
        },
      ],
      error: null,
    };
  }
  if (table === "qrm_companies") {
    return { data: [{ id: "cust-1", name: "Evergreen Farms" }], error: null };
  }
  if (table === "qrm_equipment") {
    return { data: [{ id: "eq-1", stock_number: "EQ-44", serial_number: "SER-900", make: "Kubota", model: "KX080", name: "Kubota KX080" }], error: null };
  }
  if (table === "service_agreement_programs") {
    return {
      data: [{
        id: "program-1",
        program_code: "PREMIER",
        name: "Premier PM",
        sponsor: null,
        description: null,
        catalog_owner: "QEP",
        is_provisional: false,
        review_status: "reviewed",
        is_active: true,
        reviewed_by: "user-1",
        reviewed_at: "2026-08-01T00:00:00.000Z",
        review_notes: "Approved",
        activated_by: "user-1",
        activated_at: "2026-08-01T00:00:00.000Z",
        deactivated_at: null,
        service_agreement_program_intervals: [],
      }],
      error: null,
    };
  }
  return { data: [], error: null };
}

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: async () => createOrderedResult(table),
        is: () => ({
          order: async () => createOrderedResult(table),
        }),
      }),
    }),
  },
}));

const { ServiceAgreementsPage } = await import("../ServiceAgreementsPage");

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

describe("ServiceAgreementsPage (integration)", () => {
  test("renders service agreement register rows", async () => {
    render(
      <Providers>
        <ServiceAgreementsPage />
      </Providers>,
    );

    expect(screen.getByText("Preventive maintenance contracts")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("SAM-2026-001")).toBeTruthy();
    });

    expect(screen.getAllByText(/Premier PM/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Evergreen Farms/).length).toBeGreaterThan(0);
    expect(screen.getByText("Service Plans")).toBeTruthy();
  });
});
