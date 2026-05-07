import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(import.meta.dir, "../../../../App.tsx"), "utf8");

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
});
