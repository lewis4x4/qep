import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "token" } }, error: null }),
    },
  },
}));

mock.module("@/components/primitives", () => ({
  AskIronAdvisorButton: () => <button type="button">Ask Iron</button>,
}));

import { PriceIntelligencePage } from "../PriceIntelligencePage";

type FetchCall = Parameters<typeof fetch>;
const originalFetch = globalThis.fetch;

function repImpactsPayload() {
  return {
    summary: {
      visibleImpactCount: 1,
      affectedQuoteCount: 1,
      totalDeltaCents: 525000,
      needsApprovalCount: 1,
    },
    impacts: [
      {
        id: "impact-1",
        event_id: "event-1",
        quote_package_id: "11111111-2222-3333-4444-555555555555",
        deal_id: "deal-1",
        assigned_rep_id: "rep-1",
        quote_status_snapshot: "sent",
        quote_updated_at_snapshot: "2026-05-20T18:00:00Z",
        total_delta_cents: 525000,
        max_line_delta_pct: 5.25,
        old_margin_pct: 18,
        projected_margin_pct: 16.5,
        margin_floor_pct: 17,
        below_margin_floor: true,
        materiality_trigger: "both",
        requires_manager_review: true,
        approval_required_reasons: ["manager_review_policy", "below_margin_floor"],
        old_commission_cents: 120000,
        projected_commission_cents: 105000,
        commission_delta_cents: -15000,
        state: "visible",
        qb_quote_reprice_impact_lines: [
          {
            id: "line-1",
            model_code: "TL25",
            make: "Yanmar",
            quantity: 1,
            old_list_price_cents: 1000000,
            new_list_price_cents: 1052500,
            delta_cents: 52500,
            delta_pct: 5.25,
            source_location: "factory",
            is_yard_stock: false,
            suppressed_by_stock_lock: false,
          },
        ],
      },
    ],
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PriceIntelligencePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  globalThis.fetch = mock((input: FetchCall[0], init?: FetchCall[1]) => {
    const url = String(input);
    if (url.includes("/rep-impacts")) {
      return Promise.resolve(new Response(JSON.stringify(repImpactsPayload()), { status: 200 }));
    }
    if (url.includes("/impacts/impact-1/draft")) {
      expect(init?.method).toBe("POST");
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        draftId: "draft-1",
        status: "approval_pending",
        approvalRequired: true,
        approvalReasons: ["manager_review_policy"],
        emailDraftId: "email-1",
      }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: "unexpected url" }), { status: 404 }));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("PriceIntelligencePage Phase 1 convergence", () => {
  test("hides the direct upload lane and points users to staged admin price sheets", async () => {
    renderPage();

    expect(await screen.findByText("Phase 1 upload lane is admin-staged")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open admin price sheets/i }).getAttribute("href")).toBe("/admin/price-sheets");
    expect(screen.getByText(/persisted Phase 1 queue/i)).toBeTruthy();
    expect(screen.getByText("Quote 11111111")).toBeTruthy();

    expect(screen.queryByText(/drop a csv/i)).toBeNull();
    expect(screen.queryByText(/import & flag impacts/i)).toBeNull();
    expect(screen.queryByText(/legacy import outside phase 1/i)).toBeNull();
  });

  test("creates drafts from persisted impact IDs instead of quote-package legacy drafts", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /submit approval/i }));

    await waitFor(() => expect(screen.getByText("Approval submitted")).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/impacts/impact-1/draft"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
