import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolvePrimaryNavGroups } from "../../../../lib/nav-config";

const appSource = readFileSync(resolve(import.meta.dir, "../../../../App.tsx"), "utf8");
const navConfigSource = readFileSync(resolve(import.meta.dir, "../../../../lib/nav-config.ts"), "utf8");
const opportunityMapSource = readFileSync(resolve(import.meta.dir, "../OpportunityMapPage.tsx"), "utf8");

describe("QRM route contracts", () => {
  it("renders dedicated contacts and companies pages directly while preserving duplicate redirect", () => {
    expect(appSource).toContain('path="/qrm/contacts"');
    expect(appSource).toContain('<QrmContactsPage />');
    expect(appSource).toContain('path="/qrm/companies"');
    expect(appSource).toContain('<QrmCompaniesPage />');
    expect(appSource).toContain('path="/qrm/duplicates"');
    expect(appSource).toContain('to="/admin/duplicates"');

    const contactsRoute = appSource.slice(
      appSource.indexOf('path="/qrm/contacts"'),
      appSource.indexOf('path="/qrm/contacts/:contactId"'),
    );
    const companiesRoute = appSource.slice(
      appSource.indexOf('path="/qrm/companies"'),
      appSource.indexOf('path="/qrm/companies/:companyId"'),
    );

    expect(contactsRoute).not.toContain("WithGraphExplorer");
    expect(companiesRoute).not.toContain("WithGraphExplorer");
    expect(contactsRoute).toContain('["rep", "admin", "manager", "owner"].includes(profile.role)');
    expect(companiesRoute).toContain('["rep", "admin", "manager", "owner"].includes(profile.role)');
  });

  it("keeps the QRM Opportunity Map menu item on the map page", () => {
    const qrmGroup = resolvePrimaryNavGroups(false, false, "owner").find((group) => group.id === "qrm");
    const opportunityMapItem = qrmGroup?.sections
      .flatMap((section) => section.items)
      .find((item) => item.label === "Opportunity Map");

    expect(opportunityMapItem?.href).toBe("/qrm/opportunity-map");
    expect(navConfigSource).toContain('label: "Opportunity Map"');
    expect(navConfigSource).toContain('href: "/qrm/opportunity-map"');
    expect(appSource.indexOf('path="/qrm/opportunity-map"')).toBeLessThan(appSource.indexOf('path="/qrm/companies"'));
    expect(appSource).toContain('path="/qrm/opportunities-map"');
    expect(appSource).toContain('path="/qrm/opportunies-map"');
    expect(appSource).toContain('to="/qrm/opportunity-map"');
    expect(appSource).toContain('<OpportunityMapPage />');
    expect(opportunityMapSource).not.toContain('Navigate to="/qrm/companies"');
    expect(opportunityMapSource).not.toContain('navigate("/qrm/companies")');
    expect(opportunityMapSource).not.toContain('to="/qrm/companies"');
  });

  it("registers every shared account detail menu destination", () => {
    expect(appSource).toContain('path="/qrm/accounts/:accountId/command"');
    expect(appSource).toContain('<AccountCommandCenterPage />');
    expect(appSource).toContain('path="/qrm/accounts/:accountId/timeline"');
    expect(appSource).toContain('<AccountTimelinePage />');
    expect(appSource).toContain('path="/qrm/accounts/:accountId/genome"');
    expect(appSource).toContain('<CustomerGenomePage />');
    expect(appSource).toContain('path="/qrm/accounts/:accountId/operating-profile"');
    expect(appSource).toContain('<CustomerOperatingProfilePage />');
    expect(appSource).toContain('path="/qrm/accounts/:accountId/fleet-intelligence"');
    expect(appSource).toContain('<FleetIntelligencePage />');
    expect(appSource).toContain('path="/qrm/accounts/:accountId/relationship-map"');
    expect(appSource).toContain('<RelationshipMapPage />');
    expect(appSource).toContain('path="/qrm/accounts/:accountId/white-space"');
    expect(appSource).toContain('<WhiteSpaceMapPage />');
    expect(appSource).toContain('path="/qrm/accounts/:accountId/rental-conversion"');
    expect(appSource).toContain('<RentalConversionEnginePage />');
    expect(appSource).toContain('path="/qrm/accounts/:accountId/strategist"');
    expect(appSource).toContain('<CustomerStrategistPage />');
    expect(appSource).toContain('path="/qrm/companies/:companyId/fleet-radar"');
    expect(appSource).toContain('<FleetRadarPage />');
    expect(appSource).toContain('path="/qrm/duplicates"');
    expect(appSource).toContain('to="/admin/duplicates"');
  });
});
