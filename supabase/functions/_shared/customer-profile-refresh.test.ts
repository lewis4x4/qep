import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { refreshCustomerProfileSnapshot } from "./customer-profile-refresh.ts";

type Row = Record<string, unknown>;
type QueryResult = {
  data: Row[];
  error: { message: string } | null;
};

const profile: Row = {
  id: "profile-1",
  hubspot_contact_id: null,
  intellidealer_customer_id: "intelli-1",
  crm_company_id: "company-1",
  customer_name: "Integrity Customer",
  company_name: "Integrity Co",
  pricing_persona: null,
  persona_confidence: null,
  persona_model_version: null,
  lifetime_value: 0,
  total_deals: 0,
  avg_deal_size: null,
  avg_discount_pct: null,
  avg_days_to_close: null,
  attachment_rate: null,
  service_contract_rate: null,
  fleet_size: 0,
  seasonal_pattern: null,
  last_interaction_at: null,
  price_sensitivity_score: null,
  metadata: {},
  updated_at: "2026-07-09T00:00:00.000Z",
};

class QueryBuilder implements PromiseLike<QueryResult> {
  #mode: "read" | "update" = "read";
  #patch: Row = {};
  readonly filters: Array<{ column: string; value: unknown }> = [];

  constructor(
    private readonly owner: RefreshClient,
    private readonly table: string,
    private readonly key: string,
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    this.owner.filters.push({ table: this.table, column, value });
    return this;
  }

  neq(_column: string, _value: unknown): this {
    return this;
  }

  not(_column: string, _operator: string, _value: unknown): this {
    return this;
  }

  is(_column: string, _value: unknown): this {
    return this;
  }

  in(_column: string, _values: unknown[]): this {
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  update(patch: Row): this {
    this.#mode = "update";
    this.#patch = patch;
    this.owner.finalUpdates++;
    return this;
  }

  #result(): QueryResult {
    const error = this.owner.errorAt === this.key
      ? { message: `forced source failure at ${this.key}` }
      : null;
    if (this.#mode === "update") {
      return { data: [{ ...profile, ...this.#patch }], error };
    }
    return { data: this.owner.rowsFor(this.table, this.key), error };
  }

  async single(): Promise<
    { data: Row | null; error: { message: string } | null }
  > {
    const result = this.#result();
    return { data: result.data[0] ?? null, error: result.error };
  }

  async maybeSingle(): Promise<{
    data: Row | null;
    error: { message: string } | null;
  }> {
    return await this.single();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.#result()).then(onfulfilled, onrejected);
  }
}

class RefreshClient {
  readonly #counts = new Map<string, number>();
  readonly filters: Array<{
    table: string;
    column: string;
    value: unknown;
  }> = [];
  finalUpdates = 0;

  constructor(
    readonly errorAt: string | null,
    readonly withContact = false,
    readonly identityError = false,
  ) {}

  from(table: string): QueryBuilder {
    const count = (this.#counts.get(table) ?? 0) + 1;
    this.#counts.set(table, count);
    return new QueryBuilder(this, table, `${table}:${count}`);
  }

  rpc(name: string) {
    if (name !== "get_or_create_customer_dna_profile") {
      throw new Error(`unexpected RPC ${name}`);
    }
    return Promise.resolve({
      data: this.identityError ? null : "profile-1",
      error: this.identityError ? { message: "identity RPC failed" } : null,
    });
  }

  rowsFor(table: string, key: string): Row[] {
    if (table === "customer_profiles_extended") return [profile];
    if (table === "crm_companies") return [{ id: "company-1" }];
    if (table === "crm_contacts" && this.withContact) {
      return [{
        id: "contact-1",
        workspace_id: "workspace-1",
        first_name: "Integrity",
        last_name: "Customer",
        email: "integrity@example.test",
        hubspot_contact_id: null,
        dge_customer_profile_id: "profile-1",
        primary_company_id: "company-1",
        deleted_at: null,
      }];
    }
    if (table === "portal_customers") return [{ id: "portal-1" }];
    if (table === "rental_contracts") return [{ id: "contract-1" }];
    if (table === "pricing_persona_models") {
      return [{ model_version: "test-v1" }];
    }
    // Both optional branches are deliberately entered: parts_orders:2 is the
    // portal-order read and rental_invoices:1 is the contract-invoice read.
    if (key === "parts_orders:1" || key === "parts_orders:2") return [];
    return [];
  }
}

async function runRefresh(
  admin: RefreshClient,
): Promise<Record<string, unknown>> {
  return await refreshCustomerProfileSnapshot(admin as never, {
    lookup: { customer_profiles_extended_id: "profile-1" },
    actorRole: "manager",
    actorUserId: "user-1",
    isServiceRole: false,
    workspaceId: "workspace-1",
  });
}

const sourceReads = [
  "customer_profiles_extended:1", // workspace-authorized target lookup
  "crm_companies:1", // target company tenancy
  "customer_profiles_extended:2", // full source snapshot
  "customer_deal_history:1",
  "crm_deals:1",
  "parts_orders:1", // direct parts stream
  "portal_customers:1",
  "parts_orders:2", // portal parts stream
  "customer_invoices:1", // service stream
  "rental_contracts:1",
  "rental_invoices:1",
  "pricing_persona_models:1",
];

for (const sourceRead of sourceReads) {
  Deno.test(`customer profile refresh fails closed before final update when ${sourceRead} errors`, async () => {
    const admin = new RefreshClient(sourceRead);
    await assertRejects(() => runRefresh(admin));
    assertEquals(admin.finalUpdates, 0);
  });
}

Deno.test("customer profile refresh performs one final update after all source reads succeed", async () => {
  const admin = new RefreshClient(null);
  const result = await runRefresh(admin);
  assertEquals(result.id, "profile-1");
  assertEquals(admin.finalUpdates, 1);
  for (
    const table of [
      "crm_deals",
      "customer_deal_history",
      "parts_orders",
      "portal_customers",
      "customer_invoices",
      "rental_contracts",
      "rental_invoices",
    ]
  ) {
    assertEquals(
      admin.filters.some((filter) =>
        filter.table === table && filter.column === "workspace_id" &&
        filter.value === "workspace-1"
      ),
      true,
      `${table} source read must be workspace-scoped`,
    );
  }
});

Deno.test("customer profile refresh does not write DNA fields when the atomic identity RPC fails", async () => {
  const admin = new RefreshClient(null, true, true);
  await assertRejects(() =>
    refreshCustomerProfileSnapshot(admin as never, {
      lookup: { email: "integrity@example.test" },
      actorRole: "manager",
      actorUserId: "user-1",
      isServiceRole: false,
      workspaceId: "workspace-1",
    })
  );
  assertEquals(admin.finalUpdates, 0);
});
