import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

type Result = { data: unknown; error: null | { message: string } };

const configRows = [
  {
    config_key: "trade_nonrepresented_discount_band",
    config_value: { min_discount_pct: 8, max_discount_pct: 10, default_discount_pct: 8 },
    safe_default: { min_discount_pct: 8, max_discount_pct: 10, default_discount_pct: 8 },
    authorizing_question: "Ryan 2026-07-03: non-represented trade valuation band",
    note: "Owner-reviewed Ryan policy.",
    is_active: true,
  },
  {
    config_key: "trade_valuation_guardrail",
    config_value: { max_trade_cost_pct_of_auction_value: 1, approval_required_above_guardrail: true },
    safe_default: { max_trade_cost_pct_of_auction_value: 1, approval_required_above_guardrail: true },
    authorizing_question: "Ryan 2026-07-03: bring trades in at auction value or less",
    note: "Owner-reviewed Ryan guardrail.",
    is_active: true,
  },
  {
    config_key: "trade_recondition_material_change_threshold",
    config_value: { percent_delta: 0.1, amount_delta: 2500, basis: "either" },
    safe_default: { percent_delta: 0.1, amount_delta: 2500, basis: "either" },
    authorizing_question: "Round 3 open item: material recon change threshold",
    note: "Parked until owner-reviewed.",
    is_active: true,
  },
];

function makeChain(result: Result) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "is", "order"] as const;
  for (const method of methods) chain[method] = () => chain;
  const resolved = Promise.resolve(result);
  chain.then = resolved.then.bind(resolved);
  chain.catch = resolved.catch.bind(resolved);
  return chain;
}

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "finance_foundation_config") {
        return makeChain({ data: [], error: null });
      }
      return makeChain({ data: configRows, error: null });
    },
  },
}));

const { FinanceFoundationStatusPanel } = await import("../FinanceFoundationStatusPanel");

function Providers({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
});

describe("FinanceFoundationStatusPanel", () => {
  test("renders QEP OS, IntelliDealer, QuickBooks, and trade-recondition status explicitly", async () => {
    render(
      <Providers>
        <FinanceFoundationStatusPanel workspaceId="default" />
      </Providers>,
    );

    expect(await screen.findByText("K1.1 finance foundation status")).toBeTruthy();

    expect(screen.getAllByText("QEP OS forward SoR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("IntelliDealer transition SoR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("QuickBooks downstream only").length).toBeGreaterThan(0);

    expect(screen.getByText("Shipped QEP OS finance logic")).toBeTruthy();
    expect(screen.getAllByText("migration 766").length).toBeGreaterThan(0);
    expect(screen.getByText(/below the 15% expected gross-margin floor/i)).toBeTruthy();
    expect(screen.getByText(/material recon-change reapproval remains config-required/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Non-represented trade valuation discount band")).toBeTruthy();
      expect(screen.getByText("Trade valuation true-cost guardrail")).toBeTruthy();
      expect(screen.getByText("Trade-reconditioning material-change reapproval threshold")).toBeTruthy();
    });

    expect(screen.getAllByText("owner reviewed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("config required").length).toBeGreaterThan(0);
    expect(screen.getByText(/migration 766 · Ryan 2026-07-03: non-represented trade valuation band/i)).toBeTruthy();
    expect(screen.getByText(/migration 766 · Ryan 2026-07-03: bring trades in at auction value or less/i)).toBeTruthy();
  });
});
