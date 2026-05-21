import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      id: "user-1",
      full_name: "Test Admin",
      email: "admin@test",
      role: "admin",
      iron_role: null,
      iron_role_display: null,
      is_support: false,
      active_workspace_id: "ws-test",
    },
    loading: false,
    error: null,
    user: null,
    session: null,
  }),
}));

mock.module("@/lib/supabase", () => {
  function makeChain(result: { data: unknown; error: null | { message: string } }) {
    const chain: Record<string, unknown> = {};
    const methods = ["select", "eq", "is"] as const;
    for (const method of methods) chain[method] = () => chain;
    chain.order = () => Promise.resolve(result);
    return chain;
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table !== "oems") throw new Error(`unexpected table ${table}`);
        return makeChain({
          data: [
            {
              id: "oem-asv",
              oem_key: "asv",
              parent_oem_key: "ycena",
              display_name: "ASV",
              category: "construction",
              source_format: "pdf",
              price_sheet_cadence: "ad_hoc",
              active: true,
            },
          ],
          error: null,
        });
      },
      rpc: (fn: string, args: Record<string, unknown>) => {
        if (fn !== "resolve_oem_cost") throw new Error(`unexpected rpc ${fn}`);
        expect(args.p_oem_key).toBe("ycena");
        expect(args.p_brand_key).toBe("asv");
        expect(args.p_list_price_cents).toBe(10000000);
        return Promise.resolve({
          data: [{
            dealer_cost_cents: 7000000,
            discount_off_list_pct: 30,
            tier_id: "tier-asv",
            oem_id: "oem-asv",
            parent_oem_key: "ycena",
            brand_key: "asv",
            effective_from: "2026-04-15",
            effective_to: null,
            source_reference: "ASV-Price-Book.pdf",
          }],
          error: null,
        });
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      },
    },
  };
});

const { OemsPage } = await import("../OemsPage");

describe("OemsPage", () => {
  test("renders OEMs and resolves dealer cost via RPC", async () => {
    render(
      <MemoryRouter>
        <OemsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("OEM cost resolver")).toBeTruthy();
      expect(screen.getAllByText("ASV").length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByLabelText("List price"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: /resolve dealer cost/i }));

    await waitFor(() => {
      expect(screen.getByText("$70,000.00")).toBeTruthy();
      expect(screen.getByText("30.00%")).toBeTruthy();
      expect(screen.getByText("ASV-Price-Book.pdf")).toBeTruthy();
    });
  });
});
