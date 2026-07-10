import { describe, expect, it } from "bun:test";
import {
  resolveNumberingBranch,
  resolveRentalTax,
} from "./rental-finance.ts";

type Row = Record<string, unknown>;

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];

  constructor(private readonly rows: Row[]) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    expect(operator).toBe("is");
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  order(column: string, options: { ascending: boolean }): this {
    this.orders.push({ column, ascending: options.ascending });
    return this;
  }

  limit(): this {
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const matches = this.rows.filter((row) =>
      this.filters.every((filter) => filter(row))
    );
    matches.sort((left, right) => {
      for (const order of this.orders) {
        const a = String(left[order.column] ?? "");
        const b = String(right[order.column] ?? "");
        const comparison = a.localeCompare(b);
        if (comparison !== 0) return order.ascending ? comparison : -comparison;
      }
      return 0;
    });
    return { data: matches[0] ?? null, error: null };
  }
}

function adminFor(
  tables: Record<string, Row[]>,
  jurisdiction: Row | null = null,
) {
  return {
    from(table: string) {
      return new Query(tables[table] ?? []);
    },
    async rpc() {
      return { data: jurisdiction, error: null };
    },
  };
}

const version = {
  created_at: "2026-01-01T00:00:00+00:00",
  updated_at: "2026-01-02T00:00:00+00:00",
};

describe("rental finance tenant and source-version guards", () => {
  it("fails closed when an explicit branch exists only in another workspace", async () => {
    const admin = adminFor({
      branches: [{
        id: "branch-1",
        workspace_id: "other",
        slug: "other",
        legacy_code: "99",
        state_province: "FL",
        deleted_at: null,
        ...version,
      }],
    });

    await expect(
      resolveNumberingBranch(admin, "default", "branch-1"),
    ).rejects.toThrow("RENTAL_BRANCH_ANCHOR_INVALID");
  });

  it("fails closed for cross-workspace portal and ship-to anchors", async () => {
    const crossWorkspacePortal = adminFor({
      qrm_companies: [],
      portal_customers: [{
        id: "portal-1",
        workspace_id: "other",
        crm_company_id: "company-1",
        ...version,
      }],
    });
    await expect(resolveRentalTax(
      crossWorkspacePortal,
      "default",
      { portal_customer_id: "portal-1" },
      10_000,
      null,
      "period",
    )).rejects.toThrow("RENTAL_PORTAL_ANCHOR_INVALID");

    const crossWorkspaceShipTo = adminFor({
      qrm_companies: [{
        id: "company-1",
        workspace_id: "default",
        deleted_at: null,
        ...version,
      }],
      portal_customers: [],
      qrm_company_ship_to_addresses: [{
        id: "ship-1",
        workspace_id: "other",
        company_id: "company-1",
        county_name: "Columbia",
        state: "FL",
        is_default: true,
        is_active: true,
        tax_jurisdiction_override: null,
        deleted_at: null,
        ...version,
      }],
    });
    await expect(resolveRentalTax(
      crossWorkspaceShipTo,
      "default",
      { qrm_company_id: "company-1", ship_to_address_id: "ship-1" },
      10_000,
      null,
      "period",
    )).rejects.toThrow("RENTAL_SHIP_TO_ANCHOR_INVALID");
  });

  it("uses only a same-workspace default and records every tax source version", async () => {
    const jurisdiction = {
      id: "tax-1",
      workspace_id: "global",
      state_code: "FL",
      county_name: "Columbia",
      jurisdiction_name: "Columbia County, FL",
      state_rate: 0.06,
      county_surtax_rate: 0.015,
      surtax_cap_amount: 5000,
      source_label: "test",
      effective_date: "2026-01-01",
      expires_at: "2026-12-31",
      is_active: true,
      metadata: {},
      ...version,
    };
    const admin = adminFor({
      portal_customers: [{
        id: "portal-1",
        workspace_id: "default",
        crm_company_id: "company-1",
        ...version,
      }],
      qrm_companies: [{
        id: "company-1",
        workspace_id: "default",
        deleted_at: null,
        ...version,
      }],
      qrm_company_ship_to_addresses: [
        {
          id: "cross-workspace-default",
          workspace_id: "other",
          company_id: "company-1",
          county_name: "Orange",
          state: "FL",
          is_default: true,
          is_active: true,
          tax_jurisdiction_override: null,
          deleted_at: null,
          ...version,
        },
        {
          id: "same-workspace-default",
          workspace_id: "default",
          company_id: "company-1",
          county_name: "Columbia",
          state: "FL",
          is_default: true,
          is_active: true,
          tax_jurisdiction_override: null,
          deleted_at: null,
          ...version,
        },
      ],
    }, jurisdiction);

    const result = await resolveRentalTax(
      admin,
      "default",
      { portal_customer_id: "portal-1" },
      10_000,
      null,
      "period",
    );

    expect(result.shipToAddressId).toBe("same-workspace-default");
    expect(result.sourceSnapshot.company).toMatchObject({
      id: "company-1",
      workspace_id: "default",
      updated_at: version.updated_at,
    });
    expect(result.sourceSnapshot.portal_customer?.updated_at).toBe(
      version.updated_at,
    );
    expect(result.sourceSnapshot.ship_to_address).toMatchObject({
      id: "same-workspace-default",
      workspace_id: "default",
      resolution: "company_default",
      updated_at: version.updated_at,
    });
    expect(result.sourceSnapshot.tax_jurisdiction).toEqual(jurisdiction);
  });

  it("rejects explicit customer anchors that disagree", async () => {
    const admin = adminFor({
      portal_customers: [{
        id: "portal-1",
        workspace_id: "default",
        crm_company_id: "company-from-portal",
        ...version,
      }],
      qrm_companies: [{
        id: "company-from-contract",
        workspace_id: "default",
        deleted_at: null,
        ...version,
      }],
    });

    await expect(resolveRentalTax(
      admin,
      "default",
      {
        portal_customer_id: "portal-1",
        qrm_company_id: "company-from-contract",
      },
      10_000,
      null,
      "period",
    )).rejects.toThrow("RENTAL_CUSTOMER_ANCHOR_MISMATCH");
  });

  it("fails closed when a direct company anchor belongs to another workspace", async () => {
    const admin = adminFor({
      qrm_companies: [{
        id: "company-1",
        workspace_id: "other",
        deleted_at: null,
        ...version,
      }],
    });

    await expect(resolveRentalTax(
      admin,
      "default",
      { qrm_company_id: "company-1" },
      10_000,
      null,
      "period",
    )).rejects.toThrow("RENTAL_COMPANY_ANCHOR_INVALID");
  });
});
