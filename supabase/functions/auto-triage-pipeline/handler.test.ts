import { assertEquals } from "jsr:@std/assert@1";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { handleAutoTriagePipeline } from "./handler.ts";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
const originalDgeInternalSecret = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");
const SERVICE_KEY = "sb_secret_auto_triage_handler_test_only";

Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.delete("INTERNAL_SERVICE_SECRET");
Deno.env.delete("DGE_INTERNAL_SERVICE_SECRET");

type QueryResult = {
  data: unknown;
  error: null | { message: string };
};

class QueryBuilder implements PromiseLike<QueryResult> {
  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  upsert(_values: Record<string, unknown>, _options?: Record<string, unknown>): this {
    return this;
  }

  maybeSingle(): this {
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result = this.owner.resolveQuery(this.table);
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  readonly queries: string[] = [];
  readonly upserts: Array<Record<string, unknown>> = [];

  from(table: string): QueryBuilder {
    this.queries.push(table);
    return new QueryBuilder(this, table);
  }

  resolveQuery(table: string): QueryResult {
    if (table === "qep_decision_precedents") {
      return {
        data: [{
          id: "precedent-1",
          source_decision_id: "decision-1",
          pattern_summary: "approve rental extension for repeat customer",
          applied_answer: "approve",
          applied_rationale: "repeat customer with clean history",
          owner_role: "brian",
        }],
        error: null,
      };
    }

    if (table === "qep_decisions") {
      this.upserts.push({ table });
      return {
        data: {
          id: "decision-new",
          code: "rental-extension-repeat-customer",
          lane: "rental",
          owner_role: "brian",
          status: "open",
        },
        error: null,
      };
    }

    return { data: null, error: null };
  }
}

function request(
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/auto-triage-pipeline", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dependencies(mock = new MockAdminClient()) {
  return {
    createAdminClient: () => mock as never,
    isServiceRoleCaller,
  };
}

Deno.test("auto-triage-pipeline rejects unauthenticated POST without DB access", async () => {
  const mock = new MockAdminClient();
  const response = await handleAutoTriagePipeline(
    request({ question: "Should we extend the rental?" }),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "service-role or internal-service-secret required");
  assertEquals(mock.queries.length, 0);
  assertEquals(mock.upserts.length, 0);
});

Deno.test("auto-triage-pipeline rejects wrong bearer secret without DB access", async () => {
  const mock = new MockAdminClient();
  const response = await handleAutoTriagePipeline(
    request(
      { question: "Should we extend the rental?" },
      { Authorization: "Bearer sb_secret_wrong_auto_triage_key" },
    ),
    dependencies(mock),
  );

  assertEquals(response.status, 401);
  assertEquals(mock.queries.length, 0);
});

Deno.test("auto-triage-pipeline rejects wrong internal secret without DB access", async () => {
  const mock = new MockAdminClient();
  const response = await handleAutoTriagePipeline(
    request(
      { question: "Should we extend the rental?" },
      { "x-internal-service-secret": "wrong-internal-secret" },
    ),
    dependencies(mock),
  );

  assertEquals(response.status, 401);
  assertEquals(mock.queries.length, 0);
});

Deno.test("auto-triage-pipeline accepts bearer service caller and reads precedents", async () => {
  const mock = new MockAdminClient();
  const response = await handleAutoTriagePipeline(
    request(
      { question: "Should we extend the rental for a repeat customer?" },
      { Authorization: `Bearer ${SERVICE_KEY}` },
    ),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(mock.queries, ["qep_decision_precedents"]);
  assertEquals(mock.upserts.length, 0);
  assertEquals(body.applied_update, false);
  assertEquals(typeof body.code, "string");
  assertEquals(typeof body.question_plain, "string");
});

Deno.test("auto-triage-pipeline accepts internal secret caller and can upsert decisions", async () => {
  const previous = Deno.env.get("INTERNAL_SERVICE_SECRET");
  Deno.env.set("INTERNAL_SERVICE_SECRET", "auto-triage-internal-test");
  const mock = new MockAdminClient();

  try {
    const response = await handleAutoTriagePipeline(
      request(
        {
          question: "Should we extend the rental for a repeat customer?",
          upsert: true,
        },
        { "x-internal-service-secret": "auto-triage-internal-test" },
      ),
      dependencies(mock),
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(mock.queries, ["qep_decision_precedents", "qep_decisions"]);
    assertEquals(body.applied_update, true);
    assertEquals(body.upserted_decision?.status, "open");
  } finally {
    if (previous === undefined) {
      Deno.env.delete("INTERNAL_SERVICE_SECRET");
    } else {
      Deno.env.set("INTERNAL_SERVICE_SECRET", previous);
    }
  }
});

Deno.test({
  name: "auto-triage handler env cleanup",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    };
    restore("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
    restore("INTERNAL_SERVICE_SECRET", originalInternalSecret);
    restore("DGE_INTERNAL_SERVICE_SECRET", originalDgeInternalSecret);
  },
});
