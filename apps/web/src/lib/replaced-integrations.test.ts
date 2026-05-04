import { describe, expect, test } from "bun:test";
import {
  getReplacedIntegrationDescriptor,
  isReplacedIntegration,
} from "./replaced-integrations";

describe("replaced-integrations", () => {
  test("identifies deprecated external systems that are replaced by native QEP surfaces", () => {
    expect(isReplacedIntegration("hubspot")).toBe(true);
    expect(isReplacedIntegration("intellidealer")).toBe(true);
    expect(isReplacedIntegration("ironguides")).toBe(false);
    expect(isReplacedIntegration("quickbooks")).toBe(false);
  });

  test("returns replacement metadata for UI messaging", () => {
    const hubspot = getReplacedIntegrationDescriptor("hubspot");
    expect(hubspot?.replacementSurface).toBe("QRM");
    expect(hubspot?.badgeLabel).toBe("QRM Native");

    const intellidealer = getReplacedIntegrationDescriptor("intellidealer");
    expect(intellidealer?.replacementSurface).toBe("QEP Catalog + QRM");
    expect(intellidealer?.badgeLabel).toBe("QEP Native");
  });

  test("uses runtime lifecycle metadata only after an approved replacement is recorded", () => {
    expect(
      getReplacedIntegrationDescriptor("ironguides", {
        lifecycle: "decision_required",
        external_dependency_required: true,
        replacement_surface: "QEP fallback/blended valuation",
      }),
    ).toBeNull();

    const ironguides = getReplacedIntegrationDescriptor("ironguides", {
      lifecycle: "replaced",
      external_dependency_required: false,
      replacement_surface: "QEP fallback/blended valuation",
      replacement_label: "QEP Valuation",
      replacement_summary: "IronGuides is not required for this deployment.",
    });

    expect(ironguides?.replacementSurface).toBe("QEP fallback/blended valuation");
    expect(ironguides?.badgeLabel).toBe("QEP Valuation");
  });
});
