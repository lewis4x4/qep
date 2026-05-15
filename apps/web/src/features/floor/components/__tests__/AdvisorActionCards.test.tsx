import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "rep-1" } }),
}));

mock.module("@/lib/supabase", () => {
  function makeChain(result: { data: unknown[]; error: null | { message: string } }) {
    const resolved = Promise.resolve(result);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "in", "eq", "is", "limit"] as const) {
      chain[method] = () => chain;
    }
    chain.then = resolved.then.bind(resolved);
    chain.catch = resolved.catch.bind(resolved);
    return chain;
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === "qrm_deal_stages") {
          return makeChain({ data: [{ id: "stage-decision", name: "Decision" }], error: null });
        }
        if (table === "qrm_deals") {
          return makeChain({
            data: [{ id: "deal-1", amount: 125000, stage_id: "stage-decision", closed_at: null }],
            error: null,
          });
        }
        return makeChain({ data: [], error: null });
      },
    },
  };
});

const { AdvisorActionCards } = await import("../AdvisorActionCards");

afterEach(() => {
  cleanup();
});

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

describe("AdvisorActionCards", () => {
  test("makes Quote Builder primary while preserving secondary advisor links", async () => {
    render(
      <Providers>
        <AdvisorActionCards />
      </Providers>,
    );

    const primaryQuote = screen.getByRole("link", { name: /start a new quote in quote builder/i });
    expect(primaryQuote.getAttribute("href")).toBe("/quote-v2");
    expect(primaryQuote.className).toContain("min-h-14");

    const voiceQuote = screen.getByRole("link", { name: /open voice quote/i });
    expect(voiceQuote.getAttribute("href")).toBe("/voice-quote");

    expect(screen.getByRole("link", { name: /today's follow-ups/i }).getAttribute("href")).toBe("/qrm/my/reality");
    expect(screen.getByRole("link", { name: /my pipeline/i }).getAttribute("href")).toBe("/qrm/deals?assigned_to=me");
    expect(screen.getByRole("link", { name: /voice note starter/i }).getAttribute("href")).toBe("/voice");
    expect(screen.getByRole("link", { name: /prospecting map/i }).getAttribute("href")).toBe("/qrm/opportunity-map");
    expect(screen.getByText(/upload ucc csv and route the next stop/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /submit service request/i }).getAttribute("href")).toBe("/service/intake");
    expect(screen.getByRole("link", { name: /add customer/i }).getAttribute("href")).toBe("/qrm/companies?new=1");

    await waitFor(() => {
      expect(screen.getByText("$125K")).toBeTruthy();
      expect(screen.getByText("1 at decision stage")).toBeTruthy();
    });
  });
});
