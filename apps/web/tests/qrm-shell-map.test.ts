import { describe, expect, it } from "bun:test";
import {
  resolveSurface,
  SURFACES,
  SURFACE_LENSES,
  SURFACE_ORDER,
  type SurfaceId,
} from "../src/features/qrm/shell/shellMap";

describe("shellMap surfaces", () => {
  it("exposes exactly four surfaces in a stable order", () => {
    expect(SURFACE_ORDER).toEqual(["today", "graph", "pulse", "ask"]);
  });

  it("every surface id has a matching definition", () => {
    for (const id of SURFACE_ORDER) {
      expect(SURFACES[id]).toBeDefined();
      expect(SURFACES[id].label.length).toBeGreaterThan(0);
      expect(SURFACES[id].href.startsWith("/qrm")).toBe(true);
    }
  });

  it("every lens references its parent surface", () => {
    for (const id of SURFACE_ORDER) {
      for (const lens of SURFACE_LENSES[id]) {
        expect(lens.surface).toBe(id);
        expect(lens.href.startsWith("/qrm")).toBe(true);
      }
    }
  });
});

describe("resolveSurface", () => {
  const cases: Array<{ path: string; surface: SurfaceId; lens?: string }> = [
    // Today
    { path: "/qrm/activities", surface: "today", lens: "activities" },
    { path: "/qrm/time-bank", surface: "today", lens: "time-bank" },
    { path: "/qrm/replacement-prediction", surface: "today", lens: "replace" },
    { path: "/qrm/command/approvals", surface: "today", lens: "approvals" },
    { path: "/qrm/my/reality", surface: "today", lens: "my-mirror" },

    // Graph
    { path: "/qrm/deals", surface: "graph", lens: "deals" },
    { path: "/qrm/deals/abc-123", surface: "graph", lens: "deals" },
    { path: "/qrm/pipeline", surface: "graph", lens: "deals" },
    { path: "/qrm/contacts", surface: "graph", lens: "contacts" },
    { path: "/qrm/contacts/abc-123", surface: "graph", lens: "contacts" },
    { path: "/qrm/companies", surface: "graph", lens: "companies" },
    { path: "/qrm/accounts/xyz/command", surface: "graph", lens: "companies" },
    { path: "/qrm/rentals", surface: "graph", lens: "rentals" },
    { path: "/qrm/inventory-pressure", surface: "graph", lens: "inventory" },
    { path: "/qrm/operator-intelligence", surface: "graph", lens: "operators" },
    { path: "/qrm/opportunity-map", surface: "graph", lens: "map" },

    // Pulse
    { path: "/qrm/exceptions", surface: "pulse", lens: "exceptions" },
    { path: "/qrm/iron-in-motion", surface: "pulse", lens: "motion" },
    { path: "/qrm/service-to-sales", surface: "pulse", lens: "svc-sales" },
    { path: "/qrm/parts-intelligence", surface: "pulse", lens: "parts-intel" },
    { path: "/qrm/competitive-threat-map", surface: "pulse", lens: "threat" },
    { path: "/qrm/competitive-displacement", surface: "pulse", lens: "compete" },
    { path: "/qrm/workflow-audit", surface: "pulse", lens: "audit" },
    { path: "/qrm/learning-layer", surface: "pulse", lens: "learning" },
    { path: "/qrm/sop-folk", surface: "pulse", lens: "sop-folk" },

    // Ask Iron
    { path: "/qrm/operations-copilot", surface: "ask", lens: "copilot" },

    // Root
    { path: "/qrm", surface: "today" },
    { path: "/qrm/command", surface: "today" },
  ];

  for (const { path, surface, lens } of cases) {
    it(`maps ${path} → ${surface}${lens ? ` (${lens})` : ""}`, () => {
      const resolved = resolveSurface(path);
      expect(resolved.surface).toBe(surface);
      if (lens) expect(resolved.lens).toBe(lens);
    });
  }

  it("falls back to today surface for unrecognized /qrm paths", () => {
    const resolved = resolveSurface("/qrm/totally-new-route");
    expect(resolved.surface).toBe("today");
  });

  it("the longest prefix wins for overlapping rules", () => {
    // /qrm/command and /qrm/command/approvals both exist — the more
    // specific rule must win.
    const resolved = resolveSurface("/qrm/command/approvals");
    expect(resolved.surface).toBe("today");
    expect(resolved.lens).toBe("approvals");
  });
});
