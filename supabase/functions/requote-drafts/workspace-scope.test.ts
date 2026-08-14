import { assertEquals } from "jsr:@std/assert@1";
import type { EmailDraft } from "../_shared/draft-email.ts";
import type { ServiceAuthResult } from "../_shared/service-auth.ts";
import { handleRequoteDraftsRequest } from "./handler.ts";

type Filter = { table: string; column: string; value: unknown };

const QUOTE_A = "11111111-1111-1111-1111-111111111111";
const QUOTE_B = "22222222-2222-2222-2222-222222222222";

const impactRows = [
  {
    quote_package_id: QUOTE_A,
    workspace_id: "workspace-a",
    deal_id: "deal-a",
    make: "Kubota",
    price_delta_total: 1200,
    price_changed_at: "2026-08-01T00:00:00.000Z",
  },
  {
    quote_package_id: QUOTE_B,
    workspace_id: "workspace-b",
    deal_id: "deal-b",
    make: "John Deere",
    price_delta_total: 5000,
    price_changed_at: "2026-08-01T00:00:00.000Z",
  },
];

const quotePackages = [
  {
    id: QUOTE_A,
    workspace_id: "workspace-a",
    deal_id: "deal-a",
    contact_id: "contact-a",
    net_total: 25000,
  },
  {
    id: QUOTE_B,
    workspace_id: "workspace-b",
    deal_id: "deal-b",
    contact_id: "contact-b",
    net_total: 90000,
  },
];

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private pendingUpdate?: Record<string, unknown>;

  constructor(
    private readonly owner: RequoteClient,
    private readonly table: string,
    private readonly operation: "select" | "insert" | "update",
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  insert(payload: Record<string, unknown>): QueryBuilder {
    this.owner.inserts.push({ table: this.table, payload });
    return new QueryBuilder(this.owner, this.table, "insert");
  }

  update(payload: Record<string, unknown>): QueryBuilder {
    const builder = new QueryBuilder(this.owner, this.table, "update");
    builder.pendingUpdate = payload;
    return builder;
  }

  maybeSingle(): this {
    return this;
  }

  #resolveRows(): unknown {
    const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;

    if (this.table === "price_change_impact") {
      return impactRows.filter((row) =>
        (!workspace || row.workspace_id === workspace) &&
        this.filters.every((filter) => {
          if (filter.column === "workspace_id") return true;
          return (row as Record<string, unknown>)[filter.column] === filter.value;
        })
      );
    }

    if (this.table === "quote_packages") {
      if (this.operation === "select") {
        const quoteId = this.filters.find((filter) => filter.column === "id")?.value;
        const match = quotePackages.find((row) =>
          row.id === quoteId &&
          (!workspace || row.workspace_id === workspace)
        );
        return match ?? null;
      }
      return null;
    }

    if (this.table === "email_drafts" && this.operation === "insert") {
      return { id: "draft-1" };
    }

    return this.operation === "select" ? [] : null;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.operation === "update" && this.pendingUpdate) {
      this.owner.updates.push({
        table: this.table,
        payload: this.pendingUpdate,
        filters: [...this.filters],
      });
    }
    const data = this.#resolveRows();
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class RequoteClient {
  filters: Filter[] = [];
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Filter[];
  }> = [];

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table, "select");
  }
}

function auth(workspaceId = "workspace-a"): ServiceAuthResult {
  return {
    ok: true,
    supabase: {} as never,
    userId: "user-a",
    role: "manager",
    workspaceId,
  };
}

function dependencies(client: RequoteClient, workspaceId = "workspace-a") {
  return {
    createAdminClient: (() => client) as never,
    requireServiceUser: (async () => auth(workspaceId)) as never,
    draftEmail: (async (): Promise<EmailDraft> => ({
      subject: "Updated quote",
      body: "Heads up — pricing changed.",
      tone: "professional",
      ai_generated: false,
    })) as never,
  };
}

function impactFilters(client: RequoteClient): Filter[] {
  return client.filters.filter((filter) => filter.table === "price_change_impact");
}

function quoteFilters(client: RequoteClient): Filter[] {
  return client.filters.filter((filter) => filter.table === "quote_packages");
}

Deno.test("GET /impact scopes price_change_impact to caller workspace", async () => {
  const client = new RequoteClient();
  const response = await handleRequoteDraftsRequest(
    new Request("https://example.test/functions/v1/requote-drafts/impact", {
      method: "GET",
      headers: { Authorization: "Bearer token-a" },
    }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(
    impactFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === "workspace-a"
    ),
    true,
  );
  assertEquals(body.summary.total_quotes_affected, 1);
  assertEquals(body.impact_items[0]?.quote_package_id, QUOTE_A);
  assertEquals(body.impact_items.some((item: { quote_package_id: string }) =>
    item.quote_package_id === QUOTE_B
  ), false);
});

Deno.test("POST /draft rejects cross-workspace quote packages", async () => {
  const client = new RequoteClient();
  const response = await handleRequoteDraftsRequest(
    new Request("https://example.test/functions/v1/requote-drafts/draft", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-a",
        "content-type": "application/json",
      },
      body: JSON.stringify({ quote_package_id: QUOTE_B }),
    }),
    dependencies(client),
  );

  assertEquals(response.status, 404);
  assertEquals(
    quoteFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === "workspace-a"
    ),
    true,
  );
  assertEquals(client.inserts.length, 0);
  assertEquals(client.updates.length, 0);
});

Deno.test("POST /draft scopes quote, impact, and email draft writes to caller workspace", async () => {
  const client = new RequoteClient();
  const response = await handleRequoteDraftsRequest(
    new Request("https://example.test/functions/v1/requote-drafts/draft", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-a",
        "content-type": "application/json",
      },
      body: JSON.stringify({ quote_package_id: QUOTE_A }),
    }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.ok, true);
  assertEquals(
    impactFilters(client).some((filter) =>
      filter.column === "workspace_id" && filter.value === "workspace-a"
    ),
    true,
  );
  assertEquals(client.inserts[0]?.payload.workspace_id, "workspace-a");
  assertEquals(
    client.updates[0]?.filters.some((filter) =>
      filter.column === "workspace_id" && filter.value === "workspace-a"
    ),
    true,
  );
});

Deno.test("POST /batch skips cross-workspace quote ids without drafting", async () => {
  const client = new RequoteClient();
  const response = await handleRequoteDraftsRequest(
    new Request("https://example.test/functions/v1/requote-drafts/batch", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-a",
        "content-type": "application/json",
      },
      body: JSON.stringify({ quote_package_ids: [QUOTE_A, QUOTE_B] }),
    }),
    dependencies(client),
  );
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(body.generated, 1);
  assertEquals(body.failed, 1);
  assertEquals(body.results, [
    { quote_package_id: QUOTE_A, draft_id: "draft-1", voice_compliance: null },
    { quote_package_id: QUOTE_B, draft_id: null, error: "quote not found" },
  ]);
  assertEquals(client.inserts.length, 1);
  assertEquals(client.inserts[0]?.payload.workspace_id, "workspace-a");
});
