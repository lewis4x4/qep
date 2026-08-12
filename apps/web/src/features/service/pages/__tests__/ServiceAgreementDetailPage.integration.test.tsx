import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PropsWithChildren } from "react";

const enrollCalls: Array<Record<string, unknown>> = [];

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      id: "manager-1",
      full_name: "Morgan Lee",
      role: "manager",
      active_workspace_id: "default",
    },
  }),
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "service_agreements") {
              return {
                data: {
                  id: "agreement-1",
                  contract_number: "SAM-2026-001",
                  status: "active",
                  customer_id: "cust-1",
                  equipment_id: "eq-1",
                  location_code: "OCALA",
                  program_id: "program-2",
                  program_name: "Reviewed Active 500",
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
                error: null,
              };
            }
            return { data: null, error: null };
          },
          order: async () => ({ data: [], error: null }),
        }),
        order: async () => ({ data: [], error: null }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  },
}));

mock.module("../../lib/service-plan-api", () => ({
  listServicePlanPrograms: async () => ([
    {
      id: "program-2",
      program_code: "QEP-PM-500",
      name: "Reviewed Active 500",
      sponsor: null,
      description: null,
      catalog_owner: "QEP",
      is_provisional: false,
      review_status: "reviewed",
      is_active: true,
      reviewed_by: "manager-1",
      reviewed_at: "2026-08-01T00:00:00.000Z",
      review_notes: "OEM fit confirmed",
      activated_by: "manager-1",
      activated_at: "2026-08-01T00:00:00.000Z",
      deactivated_at: null,
      intervals: [{
        id: "interval-2",
        program_id: "program-2",
        interval_code: "PM-500",
        name: "500h / 12mo",
        interval_hours: 500,
        interval_months: 12,
        interval_days: null,
        entitlement_unit: "pm_service",
        entitlement_quantity: 1,
        is_active: true,
      }],
    },
  ]),
  getServicePlanEnrollmentForAgreement: async () => null,
  listServicePlanEntitlementBalances: async () => [],
  enrollServicePlanEquipment: async (input: Record<string, unknown>) => {
    enrollCalls.push(input);
    return {
      id: "enroll-1",
      service_agreement_id: "agreement-1",
      program_id: "program-2",
      equipment_id: "eq-1",
      status: "active",
      enrolled_on: String(input.enrolledOn),
      requested_baseline_hours: input.baselineHours ?? null,
      baseline_hours: input.baselineHours ?? 120,
      baseline_source: input.baselineHours == null ? "primary_actual_meter" : "explicit",
      baseline_meter_reading_id: input.baselineHours == null ? "meter-1" : null,
      enrolled_by: "manager-1",
      ended_at: null,
      end_reason: null,
      schedules: [{
        id: "sched-1",
        enrollment_id: "enroll-1",
        program_interval_id: "interval-2",
        cycle_number: 1,
        baseline_on: String(input.enrolledOn),
        baseline_hours: 120,
        next_due_on: "2027-02-01",
        next_due_hours: 620,
        last_completed_job_id: null,
        last_completed_at: null,
      }],
    };
  },
  setServicePlanEnrollmentStatus: async () => {
    throw new Error("not used in this test");
  },
}));

const { ServiceAgreementDetailPage } = await import("../ServiceAgreementDetailPage");

function Providers({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/service/agreements/agreement-1"]}>
        <Routes>
          <Route path="/service/agreements/:agreementId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ServiceAgreementDetailPage enrollment (integration)", () => {
  test("enrolls equipment when agreement and program are ready", async () => {
    enrollCalls.length = 0;
    render(
      <Providers>
        <ServiceAgreementDetailPage />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("SAM-2026-001")).toBeTruthy();
    });

    expect(screen.getByText("Service-plan enrollment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enroll equipment" }));

    await waitFor(() => {
      expect(enrollCalls.length).toBe(1);
    });
    expect(enrollCalls[0]).toMatchObject({
      workspaceId: "default",
      serviceAgreementId: "agreement-1",
      actorId: "manager-1",
      baselineHours: null,
    });
  });
});
