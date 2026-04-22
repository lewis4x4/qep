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

mock.module("../../hooks/useServiceJobs", () => ({
  useServiceJobList: () => ({
    data: {
      jobs: [
        {
          id: "job-1",
          current_stage: "scheduled",
          customer: { id: "cust-1", name: "Evergreen Farms" },
          machine: { id: "machine-1", serial_number: "KBTA-17", make: "Kubota", model: "KX080" },
        },
      ],
    },
  }),
}));

mock.module("@/lib/supabase", () => {
  const inspections = [
    {
      id: "inspection-1",
      inspection_number: "IP-260422-AB12",
      title: "Rental return inspection",
      template_name: "Rental Return",
      inspection_type: "rental_return",
      status: "in_progress",
      stock_number: "RR-77",
      reference_number: "WO-2001",
      customer_name: "Evergreen Farms",
      machine_summary: "Kubota KX080 · KBTA-17",
      service_job_id: "job-1",
      assignee_name: "Jordan Lane",
      approver_name: null,
      created_by: "user-1",
      started_at: "2026-04-22T12:00:00.000Z",
      completed_at: null,
      created_at: "2026-04-22T12:00:00.000Z",
    },
  ];

  return {
    supabase: {
      from: (table: string) => ({
        select: () => ({
          order: async () => {
            if (table === "service_inspections") {
              return { data: inspections, error: null };
            }
            return { data: [], error: null };
          },
        }),
      }),
    },
  };
});

const { ServiceInspectionPlusPage } = await import("../ServiceInspectionPlusPage");

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

describe("ServiceInspectionPlusPage (integration)", () => {
  test("renders starter templates and active inspection queue", async () => {
    render(
      <Providers>
        <ServiceInspectionPlusPage />
      </Providers>,
    );

    expect(screen.getByText("Service inspections")).toBeTruthy();
    expect(screen.getAllByText("General Condition").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText("Rental return inspection")).toBeTruthy();
    });

    expect(screen.getByText("IP-260422-AB12 · Rental Return")).toBeTruthy();
    expect(screen.getAllByText(/Evergreen Farms/).length).toBeGreaterThan(0);
  });
});
