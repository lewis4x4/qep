import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * Slice 08 CP7 — integration test for the full PriceSheetsPage render path.
 * Exercises the chain: RequireAdmin gate → page render → service layer
 * query → BrandFreshnessTable → row action buttons.
 *
 * Scope is intentionally narrow — just enough to catch a broken prop
 * signature or a swapped query shape between the page, the table, and the
 * price-sheets-api module. The detailed behavior of each layer is already
 * covered by unit tests.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────
// @/lib/supabase: must be mocked because the page's `loadWatchdogPending`
// helper queries supabase directly on mount, and a rejection breaks the
// page's `Promise.all` → infinite loading state → test failure.
//
// Signature parity with price-sheets-api.test.ts's mock: same
// `makeChain`-style terminal object with `.single()`, `.maybeSingle()`,
// and thenable `.then/.catch`, so if this mock wins Bun's module-registry
// race at suite level, the api test's assertions still find the methods
// they expect. See price-sheets-api.test.ts for the canonical shape.
mock.module("@/lib/supabase", () => {
  function makeChain(result: { data: unknown; error: null | { message: string } } = { data: [], error: null }) {
    const resolved = Promise.resolve(result);
    const singleResult = {
      data: Array.isArray(result.data) ? ((result.data as unknown[])[0] ?? null) : result.data,
      error: result.error,
    };
    const chain: Record<string, unknown> = {};
    const METHODS = ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "order", "gte", "lte", "limit", "filter", "match", "is", "not", "returns"] as const;
    for (const m of METHODS) chain[m] = () => chain;
    chain.single = () => Promise.resolve(singleResult);
    chain.maybeSingle = () => Promise.resolve(singleResult);
    chain.then = resolved.then.bind(resolved);
    chain.catch = resolved.catch.bind(resolved);
    return chain;
  }
  return {
    supabase: {
      from: (_table: string) => makeChain(),
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ data: { path: "" }, error: null }),
          remove: () => Promise.resolve({ data: [], error: null }),
        }),
      },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
        unsubscribe: () => Promise.resolve("ok"),
      }),
      removeChannel: () => Promise.resolve("ok"),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      },
    },
  };
});

// useAuth: always return an admin profile + not-loading so RequireAdmin
// passes through to the inner component immediately.
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

// price-sheets-api: stub the one function the page calls on mount.
const mockRows = [
  {
    brand_id: "brand-asv-uuid",
    brand_name: "ASV",
    brand_code: "ASV",
    has_active_sheet: true,
    active_sheet_version: "v2026.04",
    active_sheet_item_count: 42,
    last_uploaded_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    pending_review_count: 0,
    discount_configured: true,
    has_inbound_freight_key: true,
    freight_zone_count: 3,
  },
];

// Stub EVERY export of price-sheets-api — Bun's `mock.module` registers
// globally by absolute path, so an under-specified stub here collides with
// `price-sheets-api.test.ts` and makes the api test's destructured functions
// come back as `undefined`. Keep this list in sync with the module's exports.
mock.module("../../lib/price-sheets-api", () => ({
  getBrandSheetStatus: () => Promise.resolve(mockRows),
  getFreightZones: () => Promise.resolve([]),
  upsertFreightZone: () => Promise.resolve({ ok: true as const, zone: null }),
  deleteFreightZone: () => Promise.resolve({ ok: true as const }),
  uploadAndExtractSheet: () => Promise.resolve({ ok: true as const, priceSheetId: "stub", itemsWritten: 0, programsWritten: 0 }),
  retryExtract: () => Promise.resolve({ ok: true as const, priceSheetId: "stub", itemsWritten: 0, programsWritten: 0 }),
  retryPublish: () => Promise.resolve({ ok: true as const, priceSheetId: "stub", itemsWritten: 0, programsWritten: 0 }),
  analyzeFreightCoverage: () => ({ covered: [], uncovered: [] }),
  parseDollarInput: (raw: string) => {
    const n = Number(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  },
  formatCentsAsDollars: (cents: number | null | undefined) =>
    cents == null ? "—" : `$${(cents / 100).toFixed(2)}`,
}));

// Drawers: replace with stubs so we can assert they were asked to open.
// Each stub exposes a data-testid and also reads its own `open` prop so
// we can see the parent opened it.
mock.module("../../components/UploadDrawer", () => ({
  UploadDrawer: (props: { open: boolean; brandName: string | null }) =>
    props.open ? <div data-testid="upload-drawer">UploadDrawer open for {props.brandName}</div> : null,
}));
mock.module("../../components/FreightZoneDrawer", () => ({
  FreightZoneDrawer: (props: { open: boolean; brandName: string | null }) =>
    props.open ? <div data-testid="freight-drawer">FreightZoneDrawer open for {props.brandName}</div> : null,
}));

// Have to import after mock.module registrations.
const { PriceSheetsPage } = await import("../PriceSheetsPage");
// Need MemoryRouter so RequireAdmin / Navigate don't explode.
const { MemoryRouter } = await import("react-router-dom");

// ── Tests ────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <PriceSheetsPage />
    </MemoryRouter>,
  );
}

describe("PriceSheetsPage (integration)", () => {
  beforeEach(() => {
    // Fresh DOM between tests so previous renders don't leak
    document.body.innerHTML = "";
  });

  test("renders page header and brand row for admin user", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Price Sheets")).toBeTruthy();
    });

    // Brand row — both name and a freshness metric should appear
    expect(screen.getByText("ASV")).toBeTruthy();
    expect(screen.getByText("Brand Sheet Status")).toBeTruthy();
  });

  test("clicking Upload opens the UploadDrawer with the correct brand context", async () => {
    renderPage();

    const uploadBtn = await screen.findByRole("button", { name: /upload/i });
    fireEvent.click(uploadBtn);

    const drawer = await screen.findByTestId("upload-drawer");
    expect(drawer.textContent).toContain("UploadDrawer open for ASV");
  });

  test("clicking Zones opens the FreightZoneDrawer with the correct brand context", async () => {
    renderPage();

    const zonesBtn = await screen.findByRole("button", { name: /zones/i });
    fireEvent.click(zonesBtn);

    const drawer = await screen.findByTestId("freight-drawer");
    expect(drawer.textContent).toContain("FreightZoneDrawer open for ASV");
  });
});
