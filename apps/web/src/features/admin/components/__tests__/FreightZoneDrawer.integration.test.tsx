import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/**
 * Slice 08 CP8 — integration test for the FreightZoneDrawer.
 * Exercises: drawer open → list fetch → coverage grid → Add flow →
 * form submit → list refresh.
 *
 * Mocking strategy: the earlier version of this test mocked
 * "../../lib/price-sheets-api" via mock.module, which registers globally
 * and bled into the sibling price-sheets-api.test.ts that imports the
 * real module. We now mock at the lower boundary — @/lib/supabase —
 * matching the pattern used by price-sheets-api.test.ts, so there is no
 * conflict regardless of file-load order.
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

// ── Supabase chain mock — mirrors price-sheets-api.test.ts shape ────────
//
// Exposes an in-memory table registry + a spyable `from` / `storage` /
// `functions`. Tests tweak tableData[...] in beforeEach as needed.

type ChainResult = { data: unknown; error: null | { message: string } };
const existingZoneRow = {
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
};

function makeChain(result: ChainResult) {
  const resolved = Promise.resolve(result);
  const singleResult: ChainResult = {
    data:  Array.isArray(result.data) ? ((result.data as unknown[])[0] ?? null) : result.data,
    error: result.error,
  };
  const chain: Record<string, unknown> = {};
  const METHODS = ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "order", "gte", "lte", "limit", "filter"] as const;
  for (const m of METHODS) {
    chain[m] = () => chain;
  }
  chain["single"] = () => Promise.resolve(singleResult);
  chain["then"]   = resolved.then.bind(resolved);
  chain["catch"]  = resolved.catch.bind(resolved);
  return chain;
}

const tableData: Record<string, ChainResult> = {
  qb_freight_zones: { data: [existingZoneRow], error: null },
};

// Track `.eq("id", ...)` on qb_freight_zones so we can assert delete/update
// targets without leaking into the library boundary.
const eqSpyByTable: Record<string, Array<[string, unknown]>> = {
  qb_freight_zones: [],
};

function makeSpyableChain(table: string, result: ChainResult) {
  const resolved = Promise.resolve(result);
  const singleResult: ChainResult = {
    data:  Array.isArray(result.data) ? ((result.data as unknown[])[0] ?? null) : result.data,
    error: result.error,
  };
  const chain: Record<string, unknown> = {};
  chain["select"] = () => chain;
  chain["insert"] = () => chain;
  chain["update"] = () => chain;
  chain["delete"] = () => chain;
  chain["upsert"] = () => chain;
  chain["in"]     = () => chain;
  chain["neq"]    = () => chain;
  chain["order"]  = () => chain;
  chain["gte"]    = () => chain;
  chain["lte"]    = () => chain;
  chain["limit"]  = () => chain;
  chain["filter"] = () => chain;
  chain["eq"]     = (col: string, val: unknown) => {
    (eqSpyByTable[table] ?? (eqSpyByTable[table] = [])).push([col, val]);
    return chain;
  };
  chain["single"] = () => Promise.resolve(singleResult);
  chain["then"]   = resolved.then.bind(resolved);
  chain["catch"]  = resolved.catch.bind(resolved);
  return chain;
}

const mockFrom = mock((table: string) =>
  makeSpyableChain(table, tableData[table] ?? { data: [], error: null }),
);

mock.module("@/lib/supabase", () => ({
  supabase: {
    from:      mockFrom,
    storage:   { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }), remove: () => Promise.resolve({ data: [], error: null }) }) },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
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
    mockFrom.mockClear();
    eqSpyByTable["qb_freight_zones"] = [];
    // Reset to the default existing-zones fixture; individual tests may
    // override (e.g. empty list, server error).
    tableData["qb_freight_zones"] = { data: [existingZoneRow], error: null };
  });

  // mock.module(@/lib/supabase) is scoped to this test file via module
  // keying — price-sheets-api.test.ts also mocks @/lib/supabase with its
  // own chain, and whichever file loads last wins the registry. Since we
  // set up data in beforeEach, whoever wins still observes correct data
  // per-test. Keeping the restore for parity with the previous version.
  afterAll(() => {
    mock.restore();
  });

  test("loads and renders existing zones with coverage counts", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByText("Freight zones")).toBeTruthy();
    });

    expect(await screen.findByText("Southeast")).toBeTruthy();
    expect(mockFrom).toHaveBeenCalledWith("qb_freight_zones");

    // Coverage legend reflects 3 covered states for this zone
    const coveredText = await screen.findByText(/3 covered/);
    expect(coveredText).toBeTruthy();
  });

  test("clicking Add zone opens the inline form", async () => {
    renderDrawer();

    const addBtn = await screen.findByRole("button", { name: /add zone/i });
    fireEvent.click(addBtn);

    expect(await screen.findByText(/new zone/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/e.g. southeast/i)).toBeTruthy();
  });

  test("two-click delete flow: Delete → Confirm issues .delete().eq('id', zone-1)", async () => {
    let mutatedCalls = 0;
    renderDrawer(() => { mutatedCalls++; });

    const deleteBtn = await screen.findByRole("button", { name: /^delete$/i });
    fireEvent.click(deleteBtn);

    const confirmBtn = await screen.findByRole("button", { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      // deleteFreightZone runs .from("qb_freight_zones").delete().eq("id", zoneId)
      const eqs = eqSpyByTable["qb_freight_zones"] ?? [];
      expect(eqs.some(([c, v]) => c === "id" && v === "zone-1")).toBe(true);
    });
  });
});
