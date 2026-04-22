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
    functions: {
      invoke: async (_name: string, opts: { body: { action: string; portal_id?: string } }) => {
        if (opts.body.action === "list") {
          return {
            data: {
              credentials: opts.body.portal_id === "portal-1"
                ? [
                  {
                    id: "cred-1",
                    workspace_id: "default",
                    oem_portal_profile_id: "portal-1",
                    kind: "shared_login",
                    label: "Dealer master login",
                    has_username: true,
                    has_secret: true,
                    has_totp: false,
                    totp_issuer: null,
                    totp_account: null,
                    encryption_version: 1,
                    expires_at: null,
                    rotation_interval_days: null,
                    last_rotated_at: null,
                    last_rotated_by: null,
                    last_revealed_at: null,
                    last_revealed_by: null,
                    reveal_count: 0,
                    reveal_allowed_for_reps: false,
                    notes: null,
                    created_by: null,
                    created_at: "2026-04-22T10:00:00Z",
                    updated_at: "2026-04-22T10:00:00Z",
                  },
                ]
                : [],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
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

  test("renders credentials section with vault-backed cards for selected portal", async () => {
    render(
      <Providers>
        <OemPortalDashboardPage />
      </Providers>,
    );

    // The "Credentials" header only renders inside the detail panel, so
    // waitFor the portal selection to settle before asserting.
    await waitFor(() => {
      expect(screen.getByText("Credentials")).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText("Dealer master login")).toBeTruthy();
    });

    // Reveal button is present because admin role has canManage=true.
    expect(screen.getAllByText("Reveal").length).toBeGreaterThan(0);
  });
});
