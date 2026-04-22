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
    },
  }),
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        if (table === "service_work_in_process_summary") {
          return Promise.resolve({
            data: [
              { workspace_id: "default", branch_id: "OCALA", billing_status: "customer", aging_bucket: "current", job_count: 2, total_value: 2400, avg_stage_hours: 12 },
              { workspace_id: "default", branch_id: "OCALA", billing_status: "warranty", aging_bucket: "31_60", job_count: 1, total_value: 500, avg_stage_hours: 36 },
            ],
            error: null,
          });
        }
        return {
          is: () => ({
            order: async () => ({
              data: [
                {
                  id: "job-1",
                  workspace_id: "default",
                  customer_id: "cust-1",
                  contact_id: null,
                  machine_id: "eq-1",
                  source_type: "call",
                  request_type: "repair",
                  priority: "normal",
                  current_stage: "in_progress",
                  status_flags: [],
                  branch_id: "OCALA",
                  advisor_id: null,
                  service_manager_id: null,
                  technician_id: null,
                  requested_by_name: "Jordan Lane",
                  customer_problem_summary: "Hydraulic drift",
                  ai_diagnosis_summary: null,
                  selected_job_code_id: null,
                  haul_required: false,
                  shop_or_field: "shop",
                  scheduled_start_at: null,
                  scheduled_end_at: null,
                  quote_total: 2400,
                  invoice_total: null,
                  portal_request_id: null,
                  fulfillment_run_id: null,
                  tracking_token: "token",
                  created_at: "2026-04-10T00:00:00.000Z",
                  updated_at: "2026-04-22T00:00:00.000Z",
                  closed_at: null,
                  deleted_at: null,
                  customer: { id: "cust-1", name: "Evergreen Farms" },
                  machine: { id: "eq-1", make: "Kubota", model: "KX080", serial_number: "SER-1", year: 2024 },
                },
              ],
              error: null,
            }),
          }),
        };
      },
    }),
  },
}));

const { ServiceWorkInProcessPage } = await import("../ServiceWorkInProcessPage");

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

describe("ServiceWorkInProcessPage (integration)", () => {
  test("renders WIP bucket rollups and open jobs", async () => {
    render(
      <Providers>
        <ServiceWorkInProcessPage />
      </Providers>,
    );

    expect(screen.getByText("Service WIP analysis")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Evergreen Farms")).toBeTruthy();
    });

    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getAllByText("31-60").length).toBeGreaterThan(0);
    expect(screen.getByText("Hydraulic drift")).toBeTruthy();
  });
});
