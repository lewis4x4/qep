import { describe, expect, test } from "bun:test";
import {
  getReplacedIntegrationDescriptor,
  isReplacedIntegration,
} from "./replaced-integrations";

describe("replaced-integrations", () => {
  test("identifies deprecated external systems that are replaced by native QEP surfaces", () => {
    expect(isReplacedIntegration("hubspot")).toBe(true);
    expect(isReplacedIntegration("intellidealer")).toBe(true);
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
});
