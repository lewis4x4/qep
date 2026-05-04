import { describe, expect, test } from "bun:test";
import {
  getTethrReadinessBlockerSummary,
  getTethrReadinessSurfaceCopy,
  TETHR_PROVIDER_KEY,
  TETHR_PROVIDER_REQUIREMENTS,
  type TethrActionSurface,
} from "./tethr-readiness";

describe("Tethr readiness contract", () => {
  test("keeps the provider registered as readiness-only", () => {
    expect(TETHR_PROVIDER_KEY).toBe("tethr_telematics");
    expect(TETHR_PROVIDER_REQUIREMENTS).toContain("Tethr credentials and auth contract");
    expect(TETHR_PROVIDER_REQUIREMENTS).toContain("Webhook/API payload samples for hours, GPS, faults, and device metadata");
    expect(TETHR_PROVIDER_REQUIREMENTS).toContain("Device-to-equipment mapping source of truth");
  });

  test("names every workbook Tethr It Now surface without claiming BUILT", () => {
    const surfaces: TethrActionSurface[] = ["equipment_invoicing", "parts_invoicing", "customer_portal"];

    for (const surface of surfaces) {
      const copy = getTethrReadinessSurfaceCopy(surface);
      expect(copy.title).toContain("Tethr It Now");
      expect(copy.description.toLowerCase()).toContain("blocked");
      expect(copy.description).not.toContain("BUILT");
    }
  });

  test("summarizes exact blocker evidence needed before live provider work", () => {
    const summary = getTethrReadinessBlockerSummary();

    expect(summary).toContain("Tethr credentials and auth contract");
    expect(summary).toContain("Unknown-device handling policy");
    expect(summary).toContain("Stale-data and failed-provider policy");
  });
});
