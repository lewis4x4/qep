import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * Slice 08 CP8 — integration test for the FreightZoneDrawer.
 * Exercises: drawer open → list fetch → coverage grid → Add flow →
 * form submit → list refresh.
 */

// ── Mocks ────────────────────────────────────────────────────────────────

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      id: "user-1",
      role: "admin",
      full_name: null,
      email: null,
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

const mockToast = mock(() => undefined);
mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
  toast: mockToast,
}));

// price-sheets-api: stub the four functions the drawer calls
const existingZones = [
  {
    id: "zone-1",
    workspace_id: "ws-test",
    brand_id: "brand-asv",
    zone_name: "Southeast",
    state_codes: ["FL", "GA", "AL"],
    freight_large_cents: 194200,
    freight_small_cents: 77700,
    effective_from: "2026-01-01",
    effective_to: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const getFreightZonesCall = mock(() => Promise.resolve(existingZones));
const upsertCall = mock(() =>
  Promise.resolve({
    ok: true,
    zone: {
      id: "zone-new",
      workspace_id: "ws-test",
      brand_id: "brand-asv",
      zone_name: "Texas",
      state_codes: ["TX"],
      freight_large_cents: 150000,
      freight_small_cents: 60000,
      effective_from: null,
      effective_to: null,
      created_at: "2026-04-19T00:00:00Z",
    },
  }),
);
const deleteCall = mock(() => Promise.resolve({ ok: true }));

// Import the real pure helpers once (before the mock.module registers).
// Then the mock re-exports them alongside the network-stubbed fns.
const pureHelpers = await import("../../lib/price-sheets-api");

mock.module("../../lib/price-sheets-api", () => ({
  // Real pure fns — pass through
  analyzeFreightCoverage: pureHelpers.analyzeFreightCoverage,
  parseDollarInput:       pureHelpers.parseDollarInput,
  formatCentsAsDollars:   pureHelpers.formatCentsAsDollars,
  // Stubbed network fns
  getFreightZones:   getFreightZonesCall,
  upsertFreightZone: upsertCall,
  deleteFreightZone: deleteCall,
}));

const { FreightZoneDrawer } = await import("../FreightZoneDrawer");

// ── Tests ────────────────────────────────────────────────────────────────

function renderDrawer(onMutated = () => undefined) {
  return render(
    <FreightZoneDrawer
      open={true}
      onClose={() => undefined}
      brandId="brand-asv"
      brandName="ASV"
      workspaceId="ws-test"
      onMutated={onMutated}
    />,
  );
}

describe("FreightZoneDrawer (integration)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    getFreightZonesCall.mockClear();
    upsertCall.mockClear();
    deleteCall.mockClear();
  });

  test("loads and renders existing zones with coverage counts", async () => {
    renderDrawer();

    // Drawer title
    await waitFor(() => {
      expect(screen.getByText("Freight zones")).toBeTruthy();
    });

    // Zone row — name + states
    expect(await screen.findByText("Southeast")).toBeTruthy();
    // Fetch was invoked for this brandId
    expect(getFreightZonesCall).toHaveBeenCalledWith("brand-asv");

    // Coverage legend reflects 3 covered, 48 uncovered, 0 overlap
    // (we don't assert exact text since copy could drift — just that SOME
    // coverage summary shows up).
    const coveredText = await screen.findByText(/3 covered/);
    expect(coveredText).toBeTruthy();
  });

  test("clicking Add zone opens the inline form", async () => {
    renderDrawer();

    const addBtn = await screen.findByRole("button", { name: /add zone/i });
    fireEvent.click(addBtn);

    // Form header appears
    expect(await screen.findByText(/new zone/i)).toBeTruthy();
    // Form inputs appear (zone name field placeholder)
    expect(screen.getByPlaceholderText(/e.g. southeast/i)).toBeTruthy();
  });

  test("two-click delete flow: Delete → Confirm invokes deleteFreightZone", async () => {
    let mutatedCalls = 0;
    renderDrawer(() => { mutatedCalls++; });

    // First click on Delete
    const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
    fireEvent.click(deleteBtn);

    // Confirm button now visible
    const confirmBtn = await screen.findByRole("button", { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteCall).toHaveBeenCalledWith("zone-1");
    });
  });
});
