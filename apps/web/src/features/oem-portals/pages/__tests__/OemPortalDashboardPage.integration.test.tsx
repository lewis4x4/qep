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
    from: () => ({
      select: () => ({
        order: async () => ({
          data: [
            {
              id: "portal-1",
              brand_code: "ASV",
              oem_name: "ASV",
              portal_name: "ASV Dealer Portal",
              segment: "construction",
              launch_url: "https://dealer.asv.example",
              status: "active",
              access_mode: "bookmark_only",
              favorite: true,
              mfa_required: true,
              credential_owner: "Sales Ops",
              support_contact: "ops@example.com",
              notes: "Shared branch login",
              sort_order: 10,
            },
            {
              id: "portal-2",
              brand_code: "BANDIT",
              oem_name: "Bandit",
              portal_name: "Bandit Dealer Portal",
              segment: "forestry",
              launch_url: null,
              status: "needs_setup",
              access_mode: "bookmark_only",
              favorite: false,
              mfa_required: false,
              credential_owner: null,
              support_contact: null,
              notes: null,
              sort_order: 20,
            },
          ],
          error: null,
        }),
      }),
    }),
  },
}));

const { OemPortalDashboardPage } = await import("../OemPortalDashboardPage");

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

describe("OemPortalDashboardPage (integration)", () => {
  test("renders OEM portal registry rows", async () => {
    render(
      <Providers>
        <OemPortalDashboardPage />
      </Providers>,
    );

    expect(screen.getByText("OEM portal dashboard")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByText("ASV").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Bandit")).toBeTruthy();
    expect(screen.getAllByText("needs_setup").length).toBeGreaterThan(0);
  });
});
