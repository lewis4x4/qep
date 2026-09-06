import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "manager-profile", full_name: "Mia Manager", role: "manager" },
  }),
}));

const scores = Array.from({ length: 7 }).map((_, index) => ({
  category_key: `cat_${index + 1}`,
  display_order: index + 1,
  category_name: `Category ${index + 1}`,
  criteria: ["Evidence item"],
  score: index === 0 ? 9 : 8,
  band: "Excellent",
  notes: null,
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    functions: {
      invoke: (name: string) => {
        if (name === "performance-appraisals/scorecards") {
          return Promise.resolve({
            data: { scorecards: scores.map((score) => ({ ...score, scorecard_role: "technician", source_document: "test" })) },
            error: null,
          });
        }
        return Promise.resolve({
          data: {
            appraisals: [
              {
                id: "appraisal-1",
                workspace_id: "default",
                subject_employee_id: "employee-1",
                subject_profile_id: "tech-profile",
                reviewer_profile_id: "manager-profile",
                scorecard_role: "technician",
                review_type: "Annual Performance Review",
                review_period_start: "2026-01-01",
                review_period_end: "2026-05-31",
                status: "draft",
                manager_summary: "Strong operator with clean documentation.",
                key_strengths: ["diagnostics"],
                improvement_areas: [],
                goals_next_period: [],
                category_count: 7,
                overall_score: 8.14,
                performance_band: "Excellent",
                cost_of_living_raise_pct: 3,
                performance_raise_pct: 8.14,
                recommended_raise_pct: 11.14,
                subject_display_name: "Avery Tech",
                reviewer_name: "Mia Manager",
                scores,
                updated_at: "2026-05-31T00:00:00Z",
              },
            ],
          },
          error: null,
        });
      },
    },
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => Promise.resolve({
            data: [
              { id: "manager-employee", profile_id: "manager-profile", employee_number: "M1", display_name: "Mia Manager", termination_date: null, supervisor_id: null },
              { id: "employee-1", profile_id: "tech-profile", employee_number: "T1", display_name: "Avery Tech", termination_date: null, supervisor_id: "manager-employee" },
            ],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

const { WorkforcePerformanceAppraisalsPage } = await import("../WorkforcePerformanceAppraisalsPage");

let activeClient: QueryClient;
function Providers({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  activeClient = queryClient;
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("WorkforcePerformanceAppraisalsPage", () => {
  test("renders scoped appraisal queue and live scorecard surface", async () => {
    render(
      <Providers>
        <WorkforcePerformanceAppraisalsPage />
      </Providers>,
    );

    expect(screen.getByText("Performance appraisals")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByText("Avery Tech").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Seven equal-weight categories")).toBeTruthy();
    expect(screen.getByText(/Live rollup/)).toBeTruthy();
    expect(screen.getByText("Create appraisal")).toBeTruthy();
  });
});


test("server refresh cannot replace a manager's unsaved appraisal narrative", async () => {
  localStorage.clear();
  render(<Providers><WorkforcePerformanceAppraisalsPage /></Providers>);
  await waitFor(() => expect(screen.getByLabelText("Manager summary")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Manager summary"), { target: { value: "My unsaved review" } });
  const records = activeClient.getQueryData<Array<Record<string, unknown>>>(["workforce", "appraisals"]);
  act(() => activeClient.setQueryData(["workforce", "appraisal", "appraisal-1"], { ...records![0], manager_summary: "Changed by another manager", updated_at: "2026-06-01T00:00:00Z" }));
  await waitFor(() => expect(screen.getByText("This appraisal changed on the server. Your draft is retained.")).toBeTruthy());
  expect(screen.getByDisplayValue("My unsaved review")).toBeTruthy();
});
