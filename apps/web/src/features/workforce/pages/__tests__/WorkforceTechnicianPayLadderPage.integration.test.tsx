import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({ profile: { id: "tech-profile", full_name: "Avery Tech", role: "technician" } }),
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        order: () => {
          if (table === "v_technician_pay_ladder_progression") {
            return Promise.resolve({
              data: [
                {
                  workspace_id: "default",
                  technician_profile_id: "tp-1",
                  technician_user_id: "tech-profile",
                  technician_name: "Avery Tech",
                  pay_ladder_role: "road",
                  current_tier_name: "Level 3 (Experienced Road Tech)",
                  next_tier_name: "Level 4 (Senior Road Tech)",
                  hourly_wage_cents: 3000,
                  next_compensation_min_cents: 3200,
                  next_compensation_max_cents: 3600,
                  tenure_months: 30,
                  efficiency_pct_180d: 78,
                  efficiency_job_count_180d: 12,
                  h8_qep_fault_comebacks_90d: 1,
                  comeback_gate_count: 1,
                  required_efficiency_pct: 80,
                  efficiency_window_days: 180,
                  required_max_qep_fault_comebacks: 1,
                  comeback_window_days: 180,
                  required_tenure_months: 36,
                  required_oem_certifications: [{ vendor: "cummins", min_status: "completed" }],
                  required_in_house_cert_keys: ["safety_standards"],
                  requires_vendor_logins: false,
                  vendor_login_required_vendors: [],
                  missing_requirements: [{ key: "efficiency_pct", required: 80, actual: 78 }, { key: "tenure_months", required: 36, actual: 30 }],
                  eligible_for_next_tier: false,
                  top_tier_reached: false,
                },
              ],
              error: null,
            });
          }
          if (table === "technician_oem_certifications") {
            return Promise.resolve({
              data: [{ id: "cert-1", technician_profile_id: "tp-1", vendor: "cummins", certification_name: "Cummins Level 1", status: "started", is_in_person: false, issued_at: null, expires_at: null }],
              error: null,
            });
          }
          if (table === "technician_in_house_certifications") {
            return Promise.resolve({
              data: [{ id: "ih-1", technician_profile_id: "tp-1", certification_key: "safety_standards", certification_name: "Safety Standards", status: "completed", issued_at: "2026-01-01", expires_at: null }],
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
    }),
  },
}));

const { WorkforceTechnicianPayLadderPage } = await import("../WorkforceTechnicianPayLadderPage");

function Providers({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("WorkforceTechnicianPayLadderPage", () => {
  test("renders progression gates and certification tracker", async () => {
    render(
      <Providers>
        <WorkforceTechnicianPayLadderPage />
      </Providers>,
    );

    expect(screen.getByText("Technician pay ladder + certifications")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByText("Avery Tech").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Next-tier gates")).toBeTruthy();
    expect(screen.getByText("OEM certification tracker")).toBeTruthy();
    expect(screen.getByText(/Level 4/)).toBeTruthy();
  });
});
