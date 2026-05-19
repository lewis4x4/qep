import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * Quality Center Phase 1 — board page renders columns + groups by status.
 *
 * Pattern mirrors PriceSheetsPage.integration.test.tsx. We stub @/lib/supabase
 * with a thenable chain so the page's load query resolves with a fixture set,
 * then assert that each kanban column shows the cards routed to its bucket
 * (and that 'investigating' collapses into Fixing).
 */

interface FakeFlareRow {
  id: string;
  workspace_id: string;
  reporter_email: string | null;
  reporter_role: string | null;
  severity: string;
  status: string;
  user_description: string;
  url: string;
  route: string | null;
  page_title: string | null;
  visible_entities: unknown;
  click_trail: unknown;
  network_trail: unknown;
  console_errors: unknown;
  route_trail: unknown;
  reproducer_steps: string | null;
  ai_severity_recommendation: string | null;
  ai_severity_reasoning: string | null;
  hypothesis_pattern: string | null;
  linear_issue_url: string | null;
  paperclip_issue_url: string | null;
  exception_queue_id: string | null;
  dispatch_errors: Record<string, string>;
  browser: string | null;
  os: string | null;
  viewport: unknown;
  created_at: string;
  fixed_at: string | null;
  fix_deploy_sha: string | null;
  screenshot_path: string | null;
  dom_snapshot_path: string | null;
  owner_summary: string | null;
  priority: string | null;
  eta_date: string | null;
  status_updated_at: string | null;
  status_updated_by: string | null;
}

const baseRow = (overrides: Partial<FakeFlareRow>): FakeFlareRow => ({
  id: overrides.id ?? "row",
  workspace_id: "ws",
  reporter_email: "rep@example.com",
  reporter_role: "rep",
  severity: "bug",
  status: "new",
  user_description: "Something is broken",
  url: "https://example.com",
  route: "/dashboard",
  page_title: "Dashboard",
  visible_entities: [],
  click_trail: [],
  network_trail: [],
  console_errors: [],
  route_trail: [],
  reproducer_steps: null,
  ai_severity_recommendation: null,
  ai_severity_reasoning: null,
  hypothesis_pattern: null,
  linear_issue_url: null,
  paperclip_issue_url: null,
  exception_queue_id: null,
  dispatch_errors: {},
  browser: "chrome",
  os: "macos",
  viewport: { width: 1440, height: 900, dpr: 2 },
  created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  fixed_at: null,
  fix_deploy_sha: null,
  screenshot_path: null,
  dom_snapshot_path: null,
  owner_summary: null,
  priority: null,
  eta_date: null,
  status_updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  status_updated_by: null,
  ...overrides,
});

const fixtureReports: FakeFlareRow[] = [
  baseRow({ id: "r-new",          status: "new",          user_description: "New flare A" }),
  baseRow({ id: "r-ack",          status: "acknowledged", user_description: "Acknowledged flare B" }),
  baseRow({ id: "r-investigating",status: "investigating",user_description: "Investigating flare C" }),
  baseRow({ id: "r-fixing",       status: "fixing",       user_description: "Fixing flare D" }),
  baseRow({ id: "r-shipped",      status: "shipped",      user_description: "Shipped flare E" }),
  baseRow({ id: "r-verified",     status: "verified",     user_description: "Verified flare F" }),
];

const fixtureRollups = [
  {
    reported_this_week: 6,
    shipped_this_week: 1,
    avg_fix_hours: 18.4,
  },
];

mock.module("@/lib/supabase", () => {
  function makeChain(table: string) {
    let payload: { data: unknown; error: { message: string } | null };
    if (table === "flare_reports") payload = { data: fixtureReports, error: null };
    else payload = { data: [], error: null };

    const resolved = Promise.resolve(payload);
    const chain: Record<string, unknown> = {};
    const METHODS = ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "order", "gte", "lte", "limit", "filter", "match", "is", "not", "returns"] as const;
    for (const m of METHODS) chain[m] = () => chain;
    chain.single = () => Promise.resolve({
      data: Array.isArray(payload.data) ? (payload.data as unknown[])[0] ?? null : payload.data,
      error: payload.error,
    });
    chain.maybeSingle = chain.single;
    chain.then = resolved.then.bind(resolved);
    chain.catch = resolved.catch.bind(resolved);
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      rpc: (fn: string) => {
        if (fn === "flare_board_rollups") {
          return Promise.resolve({ data: fixtureRollups, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      storage: {
        from: () => ({
          createSignedUrl: () => Promise.resolve({ data: null, error: null }),
        }),
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      },
    },
  };
});

mock.module("@/lib/flare/flareClient", () => ({
  updateFlareStatus: () => Promise.resolve(),
}));

const { FlareBoardPage } = await import("../FlareBoardPage");

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <FlareBoardPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("FlareBoardPage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("renders kanban columns and routes cards by status (investigating collapses into Fixing)", async () => {
    renderPage();

    expect(await screen.findByText("Quality Center")).toBeTruthy();
    expect(screen.getByText("← List view")).toBeTruthy();

    // Wait for the data load to settle.
    await waitFor(() => {
      expect(screen.getByText("New flare A")).toBeTruthy();
    });

    // Each fixture card should be visible.
    expect(screen.getByText("Acknowledged flare B")).toBeTruthy();
    expect(screen.getByText("Investigating flare C")).toBeTruthy();
    expect(screen.getByText("Fixing flare D")).toBeTruthy();
    expect(screen.getByText("Shipped flare E")).toBeTruthy();
    expect(screen.getByText("Verified flare F")).toBeTruthy();

    // Investigating + Fixing collapse into the same column.
    const fixingColumn = screen.getByTestId("flare-column-cards-fixing");
    expect(fixingColumn.textContent).toContain("Fixing flare D");
    expect(fixingColumn.textContent).toContain("Investigating flare C");

    // New column should only contain the 'new' flare.
    const newColumn = screen.getByTestId("flare-column-cards-new");
    expect(newColumn.textContent).toContain("New flare A");
    expect(newColumn.textContent).not.toContain("Acknowledged flare B");
  });

  test("rollup tiles render with header strip", async () => {
    renderPage();
    await screen.findByText("Quality Center");
    const rollups = await screen.findByTestId("flare-board-rollups");
    expect(rollups.textContent).toContain("Reported this week");
    expect(rollups.textContent).toContain("Shipped this week");
    expect(rollups.textContent).toContain("Avg fix time");
  });
});
