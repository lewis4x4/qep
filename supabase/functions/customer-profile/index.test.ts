import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  type CustomerProfileDependencies,
  handleCustomerProfile,
} from "./index.ts";

type Row = Record<string, unknown>;

const baseProfile = {
  hubspot_contact_id: "hub-a",
  intellidealer_customer_id: "intelli-a",
  customer_name: "Workspace A Customer",
  company_name: "Company A",
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

class Query implements PromiseLike<{ data: Row[] | null; error: null }> {
  #filters: Array<(row: Row) => boolean> = [];
  #insertRows: Row[] | null = null;

  constructor(
    private readonly owner: ProfileClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.#filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown): this {
    this.#filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.#filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  insert(value: Row | Row[]): this {
    this.#insertRows = Array.isArray(value) ? value : [value];
    if (this.table === "customer_profile_access_audit") {
      this.owner.auditWrites += this.#insertRows.length;
    }
    return this;
  }

  #rows(): Row[] {
    if (this.#insertRows) return this.#insertRows;
    return (this.owner.fixtures[this.table] ?? []).filter((row) =>
      this.#filters.every((filter) => filter(row))
    );
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.#rows()[0] ?? null, error: null };
  }

  then<TResult1 = { data: Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
        data: Row[] | null;
        error: null;
      }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.#rows(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class ProfileClient {
  auditWrites = 0;
  fromCalls = 0;
  readonly fixtures: Record<string, Row[]> = {
    customer_profiles_extended: [
      {
        ...baseProfile,
        id: "profile-a",
        crm_company_id: "company-a",
      },
      {
        ...baseProfile,
        id: "profile-b",
        hubspot_contact_id: "hub-b",
        intellidealer_customer_id: "intelli-b",
        customer_name: "Workspace B Customer",
        crm_company_id: "company-b",
      },
    ],
    crm_companies: [
      { id: "company-a", workspace_id: "workspace-a", deleted_at: null },
      { id: "company-b", workspace_id: "workspace-b", deleted_at: null },
    ],
    qrm_companies: [
      {
        id: "company-a",
        workspace_id: "workspace-a",
        deleted_at: null,
        ein: "12-3456789",
      },
      {
        id: "company-b",
        workspace_id: "workspace-b",
        deleted_at: null,
        ein: "98-7654321",
      },
    ],
    crm_contacts: [
      {
        id: "contact-a",
        workspace_id: "workspace-a",
        first_name: "A",
        last_name: "Customer",
        email: "a@example.test",
        hubspot_contact_id: "hub-a",
        dge_customer_profile_id: "profile-a",
        primary_company_id: "company-a",
        deleted_at: null,
      },
      {
        id: "contact-b",
        workspace_id: "workspace-b",
        first_name: "B",
        last_name: "Customer",
        email: "b@example.test",
        hubspot_contact_id: "hub-b",
        dge_customer_profile_id: "profile-b",
        primary_company_id: "company-b",
        deleted_at: null,
      },
    ],
    customer_profile_access_audit: [],
  };

  from(table: string): Query {
    this.fromCalls++;
    return new Query(this, table);
  }
}

function caller(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer staff-token",
    userId: "user-a",
    role: "manager",
    isServiceRole: false,
    workspaceId: "workspace-a",
    ...overrides,
  };
}

function dependencies(
  client: ProfileClient,
  context: CallerContext,
): Partial<CustomerProfileDependencies> {
  return {
    createAdminClient: (() => client) as never,
    createCallerClient: (() => client) as never,
    resolveCallerContext: (async () => context) as never,
    checkRateLimit: (() => ({
      allowed: true,
      retryAfterSeconds: 0,
    })) as never,
    findOpenDgeRefreshJob: (async () => null) as never,
    enqueueDgeRefreshJob: (async () => {
      throw new Error("enqueue should not run");
    }) as never,
    triggerDgeRefreshWorker: (async () => {}) as never,
  };
}

function request(profileId: string): Request {
  return new Request(
    `https://example.test/functions/v1/customer-profile?customer_profiles_extended_id=${profileId}`,
  );
}

for (const role of ["rep", "admin", "manager", "owner"] as const) {
  Deno.test(`customer-profile ${role} read stays inside the active workspace`, async () => {
    const client = new ProfileClient();
    const response = await handleCustomerProfile(
      request("profile-a"),
      dependencies(client, caller({ role })),
    );
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.id, "profile-a");
    assertEquals(client.auditWrites, 1);
  });
}

Deno.test("customer-profile rejects a two-workspace staff read before audit mutation", async () => {
  const client = new ProfileClient();
  const response = await handleCustomerProfile(
    request("profile-b"),
    dependencies(client, caller()),
  );
  const body = await response.json();
  assertEquals(response.status, 403);
  assertEquals(body.error.code, "WORKSPACE_MISMATCH");
  assertEquals(client.auditWrites, 0);
});

Deno.test("customer-profile service reads require an explicit workspace", async () => {
  const client = new ProfileClient();
  const response = await handleCustomerProfile(
    request("profile-a"),
    dependencies(
      client,
      caller({
        authHeader: null,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: null,
      }),
    ),
  );
  assertEquals(response.status, 400);
  assertEquals(client.fromCalls, 0);
  assertEquals(client.auditWrites, 0);
});

Deno.test("customer-profile service workspace cannot select another tenant", async () => {
  const client = new ProfileClient();
  const response = await handleCustomerProfile(
    request("profile-b"),
    dependencies(
      client,
      caller({
        authHeader: "Bearer service-key",
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: "workspace-a",
      }),
    ),
  );
  assertEquals(response.status, 403);
  assertEquals(client.auditWrites, 0);
});
