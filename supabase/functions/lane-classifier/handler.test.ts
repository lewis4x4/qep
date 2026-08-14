import { assertEquals } from "jsr:@std/assert@1";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { handleLaneClassifier } from "./handler.ts";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
const originalDgeInternalSecret = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");
const SERVICE_KEY = "sb_secret_lane_classifier_handler_test_only";

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
    private readonly operation: "select" | "update",
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(_column: string, _value: unknown): this {
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  update(_values: Record<string, unknown>): this {
    return this;
  }

  maybeSingle(): this {
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result = this.owner.resolveQuery(this.table, this.operation);
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  readonly queries: string[] = [];
  readonly updates: string[] = [];

  from(table: string): {
    select: (columns: string) => QueryBuilder;
    update: (values: Record<string, unknown>) => QueryBuilder;
  } {
    return {
      select: (columns: string) => {
        this.queries.push(table);
        return new QueryBuilder(this, table, "select");
      },
      update: (values: Record<string, unknown>) => {
        this.updates.push(table);
        return new QueryBuilder(this, table, "update");
      },
    };
  }

  resolveQuery(table: string, operation: "select" | "update"): QueryResult {
    if (table === "qep_decisions" && operation === "select") {
      return {
        data: {
          id: "decision-1",
          code: "schema-cutover",
          lane: "ratify",
          question_plain: "Should we run the schema cutover?",
          recommended_rationale: "Compliance review required",
          reversal_cost: "high",
          options: [{ label: "Proceed" }],
          citations: [{ excerpt: "Legal review required" }],
          ai_prep_packet: { context: "schema migration" },
        },
        error: null,
      };
    }

    if (table === "qep_decisions" && operation === "update") {
      return {
        data: {
          id: "decision-1",
          code: "schema-cutover",
          lane: "authorize",
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
  return new Request("https://example.test/functions/v1/lane-classifier", {
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

Deno.test("lane-classifier rejects unauthenticated POST without DB access", async () => {
  const mock = new MockAdminClient();
  const response = await handleLaneClassifier(
    request({ question_plain: "Should we run the schema cutover?" }),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error, "service-role or internal-service-secret required");
  assertEquals(mock.queries.length, 0);
  assertEquals(mock.updates.length, 0);
});

Deno.test("lane-classifier rejects wrong bearer secret without DB access", async () => {
  const mock = new MockAdminClient();
  const response = await handleLaneClassifier(
    request(
      { question_plain: "Should we run the schema cutover?" },
      { Authorization: "Bearer sb_secret_wrong_lane_classifier_key" },
    ),
    dependencies(mock),
  );

  assertEquals(response.status, 401);
  assertEquals(mock.queries.length, 0);
  assertEquals(mock.updates.length, 0);
});

Deno.test("lane-classifier rejects wrong internal secret without DB access", async () => {
  const mock = new MockAdminClient();
  const response = await handleLaneClassifier(
    request(
      { question_plain: "Should we run the schema cutover?" },
      { "x-internal-service-secret": "wrong-internal-secret" },
    ),
    dependencies(mock),
  );

  assertEquals(response.status, 401);
  assertEquals(mock.queries.length, 0);
});

Deno.test("lane-classifier accepts bearer service caller for classify-only", async () => {
  const mock = new MockAdminClient();
  const response = await handleLaneClassifier(
    request(
      {
        question_plain: "Set a reversible feature flag and UI default copy change",
      },
      { Authorization: `Bearer ${SERVICE_KEY}` },
    ),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(mock.queries.length, 0);
  assertEquals(mock.updates.length, 0);
  assertEquals(body.lane, "auto");
  assertEquals(body.updated_decision, null);
});

Deno.test("lane-classifier accepts bearer service caller and can fetch open decisions", async () => {
  const mock = new MockAdminClient();
  const response = await handleLaneClassifier(
    request(
      { decision_code: "schema-cutover" },
      { Authorization: `Bearer ${SERVICE_KEY}` },
    ),
    dependencies(mock),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(mock.queries, ["qep_decisions"]);
  assertEquals(mock.updates.length, 0);
  assertEquals(body.lane, "authorize");
  assertEquals(body.updated_decision, null);
});

Deno.test("lane-classifier accepts internal secret caller and can apply_update", async () => {
  const previous = Deno.env.get("INTERNAL_SERVICE_SECRET");
  Deno.env.set("INTERNAL_SERVICE_SECRET", "lane-classifier-internal-test");
  const mock = new MockAdminClient();

  try {
    const response = await handleLaneClassifier(
      request(
        {
          decision_code: "schema-cutover",
          apply_update: true,
        },
        { "x-internal-service-secret": "lane-classifier-internal-test" },
      ),
      dependencies(mock),
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(mock.queries, ["qep_decisions"]);
    assertEquals(mock.updates, ["qep_decisions"]);
    assertEquals(body.lane, "authorize");
    assertEquals(body.updated_decision?.lane, "authorize");
  } finally {
    if (previous === undefined) {
      Deno.env.delete("INTERNAL_SERVICE_SECRET");
    } else {
      Deno.env.set("INTERNAL_SERVICE_SECRET", previous);
    }
  }
});

Deno.test({
  name: "lane-classifier handler env cleanup",
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
