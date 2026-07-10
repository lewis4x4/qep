import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import {
  discoverServiceWorkspaces,
  handleHealthScoreRefresh,
  resolveHealthScoreWorkspaceSelection,
} from "./handler.ts";

type Filter = { table: string; column: string; value: unknown };

class QueryBuilder implements
  PromiseLike<{
    data: Array<Record<string, unknown>>;
    error: null;
  }> {
  readonly filters: Filter[] = [];

  constructor(
    private readonly owner: HealthClient,
    private readonly table: string,
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

  is(column: string, value: unknown): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  not(_column: string, _operator: string, _value: unknown): this {
    return this;
  }

  gt(_column: string, _value: unknown): this {
    return this;
  }

  lte(_column: string, _value: unknown): this {
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  in(column: string, value: unknown[]): this {
    const filter = { table: this.table, column, value };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  #rows(): Array<Record<string, unknown>> {
    if (this.table === "profiles") {
      return [{ active_workspace_id: "workspace-a" }];
    }
    if (this.table === "crm_companies") {
      const workspace = this.filters.find((filter) =>
        filter.column === "workspace_id"
      )?.value;
      return workspace
        ? [{ id: `company-${workspace}` }]
        : [{ workspace_id: "workspace-b" }];
    }
    if (this.table === "crm_contacts") {
      const workspace = this.filters.find((filter) =>
        filter.column === "workspace_id"
      )?.value;
      return [{ dge_customer_profile_id: `profile-${workspace}` }];
    }
    if (this.table === "customer_profiles_extended") {
      const anchor = this.filters.find((filter) =>
        filter.column === "crm_company_id" || filter.column === "id"
      )?.value;
      const firstAnchor = Array.isArray(anchor) ? String(anchor[0] ?? "") : "";
      const workspace = firstAnchor.replace(/^company-/, "").replace(
        /^profile-/,
        "",
      ) || "workspace-unknown";
      return [{
        id: `profile-${workspace}`,
        crm_company_id: `company-${workspace}`,
        health_score: 75,
        customer_name: `Customer ${workspace}`,
        health_score_updated_at: null,
      }];
    }
    return [];
  }

  then<
    TResult1 = {
      data: Array<Record<string, unknown>>;
      error: null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
        data: Array<Record<string, unknown>>;
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

class HealthClient {
  filters: Filter[] = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(
    private readonly claimPhase: "scores" | "dna" = "scores",
    private readonly activeProfileIds: string[] = [],
    private readonly scoreProfileIds: string[] = [],
    private readonly scoreFailureIds: string[] = [],
    private readonly consecutiveFailureCount = 0,
  ) {}

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    if (name === "list_health_score_refresh_workspaces") {
      return Promise.resolve({
        data: ["workspace-a", "workspace-b"],
        error: null,
      });
    }
    if (name === "list_customer_health_profiles_for_workspace") {
      const workspace = String(args.p_workspace_id);
      const profileIds = args.p_order === "stale_asc" &&
          this.scoreProfileIds.length > 0
        ? this.scoreProfileIds
        : [`profile-${workspace}`];
      return Promise.resolve({
        data: profileIds.map((id) => ({
          id,
          crm_company_id: `company-${workspace}`,
          health_score: 75,
          customer_name: `Customer ${id}`,
          health_score_updated_at: null,
        })),
        error: null,
      });
    }
    if (name === "enqueue_health_score_refresh_jobs") {
      return Promise.resolve({ data: 2, error: null });
    }
    if (name === "claim_health_score_refresh_jobs") {
      return Promise.resolve({
        data: ["workspace-a", "workspace-b"].map((workspace, index) => ({
          job_id: `00000000-0000-0000-0000-00000000000${index + 1}`,
          workspace_id: workspace,
          snapshot_at: "2026-07-09T12:00:00.000Z",
          phase: this.claimPhase,
          score_cursor_updated_at: null,
          score_cursor_id: null,
          dna_cursor_id: this.claimPhase === "dna" ? "profile-000" : null,
          attempt_count: 1,
          failure_count: this.consecutiveFailureCount,
          lease_token: `10000000-0000-0000-0000-00000000000${index + 1}`,
        })),
        error: null,
      });
    }
    if (name === "list_customer_health_profiles_page") {
      const workspace = String(args.p_workspace_id);
      const profileIds = this.scoreProfileIds.length > 0
        ? this.scoreProfileIds
        : [`profile-${workspace}`];
      return Promise.resolve({
        data: profileIds.map((id) => ({
          id,
          crm_company_id: `company-${workspace}`,
          health_score: 75,
          customer_name: `Customer ${id}`,
          health_score_updated_at: null,
        })),
        error: null,
      });
    }
    if (name === "list_active_customer_dna_profiles_page") {
      return Promise.resolve({
        data: this.activeProfileIds.map((id) => ({ id })),
        error: null,
      });
    }
    if (name === "compute_customer_health_score") {
      const profileId = String(args.p_customer_profile_id);
      return Promise.resolve({
        data: null,
        error: this.scoreFailureIds.includes(profileId)
          ? { message: `transient score failure for ${profileId}` }
          : null,
      });
    }
    return Promise.resolve({
      data: name === "generate_cross_department_alerts" ? 2 : null,
      error: null,
    });
  }
}

class ManualConcurrencyHealthClient extends HealthClient {
  activeScoreCalls = 0;
  maxActiveScoreCalls = 0;

  override rpc(name: string, args: Record<string, unknown>) {
    if (name !== "compute_customer_health_score") return super.rpc(name, args);
    this.rpcCalls.push({ name, args });
    this.activeScoreCalls++;
    this.maxActiveScoreCalls = Math.max(
      this.maxActiveScoreCalls,
      this.activeScoreCalls,
    );
    return new Promise<{ data: null; error: null }>((resolve) => {
      setTimeout(() => {
        this.activeScoreCalls--;
        resolve({ data: null, error: null });
      }, 2);
    });
  }
}

function caller(overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    authHeader: "Bearer user-token",
    userId: "user-1",
    role: "manager",
    isServiceRole: false,
    workspaceId: "workspace-a",
    ...overrides,
  };
}

function overrides(client: HealthClient, context: CallerContext) {
  return {
    createAdminClient: (() => client) as never,
    resolveCallerContext: (async () => context) as never,
    refreshCustomerProfileSnapshot:
      (async () => ({ refreshed: true })) as never,
  };
}

Deno.test("manual health workspace selection is bound to current profile truth", () => {
  assertEquals(
    resolveHealthScoreWorkspaceSelection({
      caller: caller(),
      requestedWorkspaceId: null,
      isCron: false,
    }),
    { ok: true, mode: "single", workspaceId: "workspace-a" },
  );
  assertEquals(
    resolveHealthScoreWorkspaceSelection({
      caller: caller(),
      requestedWorkspaceId: "workspace-b",
      isCron: false,
    }),
    {
      ok: false,
      status: 403,
      message: "The requested workspace is not authorized for this caller",
    },
  );
});

Deno.test("manager GET reads only profiles anchored to the caller workspace", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh"),
    overrides(client, caller()),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.workspace_id, "workspace-a");
  assertEquals(body.total_scored, 1);
  assertEquals(
    client.rpcCalls.some((call) =>
      call.name === "list_customer_health_profiles_for_workspace" &&
      call.args.p_workspace_id === "workspace-a" &&
      call.args.p_order === "score_desc" && call.args.p_limit === 100
    ),
    true,
  );
});

Deno.test("manager cross-workspace GET is rejected before database reads", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request(
      "https://example.test/functions/v1/health-score-refresh?workspace_id=workspace-b",
    ),
    overrides(client, caller()),
  );
  assertEquals(response.status, 403);
  assertEquals(client.filters.length, 0);
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("targeted POST scopes profile, activity, score, and alert work to one workspace", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace_id: "workspace-a" }),
    }),
    overrides(client, caller()),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.workspace_id, "workspace-a");
  assertEquals(body.scores_refreshed, 1);
  const healthProfiles = client.rpcCalls.find((call) =>
    call.name === "list_customer_health_profiles_for_workspace" &&
    call.args.p_order === "stale_asc"
  );
  assertEquals(healthProfiles?.args.p_limit, 200);
  const activeDna = client.rpcCalls.find((call) =>
    call.name === "list_active_customer_dna_profiles_page"
  );
  assertEquals(activeDna?.args.p_workspace_id, "workspace-a");
  assertEquals(activeDna?.args.p_limit, 50);
  const alert = client.rpcCalls.find((call) =>
    call.name === "generate_cross_department_alerts"
  );
  assertEquals(alert?.args.p_workspace_id, "workspace-a");
});

Deno.test("targeted POST preserves 200/50 coverage with bounded score and DNA concurrency", async () => {
  const scoreIds = Array.from({ length: 200 }, (_, index) => `score-${index}`);
  const dnaIds = Array.from({ length: 50 }, (_, index) => `dna-${index}`);
  const client = new ManualConcurrencyHealthClient(
    "scores",
    dnaIds,
    scoreIds,
  );
  let activeDnaCalls = 0;
  let maxActiveDnaCalls = 0;
  let dnaCalls = 0;
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace_id: "workspace-a" }),
    }),
    {
      ...overrides(client, caller()),
      refreshCustomerProfileSnapshot: (async () => {
        dnaCalls++;
        activeDnaCalls++;
        maxActiveDnaCalls = Math.max(maxActiveDnaCalls, activeDnaCalls);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeDnaCalls--;
        return { refreshed: true };
      }) as never,
    },
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.scores_refreshed, 200);
  assertEquals(body.dna_refreshed, 50);
  assertEquals(
    client.rpcCalls.filter((call) =>
      call.name === "compute_customer_health_score"
    ).length,
    200,
  );
  assertEquals(dnaCalls, 50);
  assertEquals(client.maxActiveScoreCalls <= 8, true);
  assertEquals(maxActiveDnaCalls <= 4, true);
});

Deno.test("service cron DNA phase uses complete SQL keyset paging and checkpoints its cursor", async () => {
  const activeIds = Array.from(
    { length: 6 },
    (_, index) => `profile-00${index + 1}`,
  );
  const client = new HealthClient("dna", activeIds);
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "cron" }),
    }),
    overrides(
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
  assertEquals(response.status, 200);
  const pages = client.rpcCalls.filter((call) =>
    call.name === "list_active_customer_dna_profiles_page"
  );
  assertEquals(pages.length, 2);
  assertEquals(
    pages.every((call) =>
      call.args.p_after_id === "profile-000" && call.args.p_limit === 6
    ),
    true,
  );
  const completions = client.rpcCalls.filter((call) =>
    call.name === "complete_health_score_refresh_job"
  );
  assertEquals(completions.length, 2);
  assertEquals(
    completions.every((call) =>
      call.args.p_status === "queued" && call.args.p_phase === "dna" &&
      call.args.p_dna_cursor_id === "profile-005"
    ),
    true,
  );
});

Deno.test("service cron requeues a transient score failure without advancing the score cursor", async () => {
  const client = new HealthClient(
    "scores",
    [],
    ["score-001", "score-002", "score-003"],
    ["score-002"],
  );
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      body: JSON.stringify({ source: "cron" }),
    }),
    overrides(
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
  assertEquals(response.status, 200);
  const completions = client.rpcCalls.filter((call) =>
    call.name === "complete_health_score_refresh_job"
  );
  assertEquals(completions.length, 2);
  assertEquals(
    completions.every((call) =>
      call.args.p_status === "queued" && call.args.p_phase === "scores" &&
      call.args.p_score_cursor_id === null &&
      String(call.args.p_last_error).includes("transient profile failure")
    ),
    true,
  );
  assertEquals(
    client.rpcCalls.some((call) =>
      call.name === "generate_cross_department_alerts"
    ),
    false,
  );
});

Deno.test("service cron dead-letters the fifth consecutive slice failure with durable evidence", async () => {
  const client = new HealthClient(
    "scores",
    [],
    ["score-001"],
    ["score-001"],
    4,
  );
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      body: JSON.stringify({ source: "cron" }),
    }),
    overrides(
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
  const body = await response.json();
  assertEquals(response.status, 500);
  assertEquals(body.terminal_failure_count, 2);
  const completions = client.rpcCalls.filter((call) =>
    call.name === "complete_health_score_refresh_job"
  );
  assertEquals(
    completions.every((call) =>
      call.args.p_status === "failed" &&
      String(call.args.p_last_error).includes("transient profile failure")
    ),
    true,
  );
});

Deno.test("service cron checkpoints successful DNA before a transient failure and does not skip it", async () => {
  const client = new HealthClient("dna", [
    "profile-001",
    "profile-002",
    "profile-003",
  ]);
  const attempted: string[] = [];
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      body: JSON.stringify({ source: "cron" }),
    }),
    {
      ...overrides(
        client,
        caller({
          authHeader: null,
          userId: null,
          role: null,
          isServiceRole: true,
          workspaceId: null,
        }),
      ),
      refreshCustomerProfileSnapshot: (async (
        _admin: unknown,
        input: { lookup: Record<string, unknown> },
      ) => {
        const id = String(input.lookup.customer_profiles_extended_id);
        attempted.push(id);
        if (id === "profile-002") throw new Error("temporary DNA outage");
        return { refreshed: true };
      }) as never,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(attempted.filter((id) => id === "profile-001").length, 2);
  assertEquals(attempted.filter((id) => id === "profile-002").length, 2);
  const completions = client.rpcCalls.filter((call) =>
    call.name === "complete_health_score_refresh_job"
  );
  assertEquals(completions.length, 2);
  assertEquals(
    completions.every((call) =>
      call.args.p_status === "queued" && call.args.p_phase === "dna" &&
      call.args.p_dna_cursor_id === "profile-001" &&
      String(call.args.p_last_error).includes("temporary DNA outage")
    ),
    true,
  );
  assertEquals(attempted.includes("profile-003"), false);
});

Deno.test("non-cron service calls require an explicit workspace", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      body: "{}",
    }),
    overrides(
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
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("service cron claims only a bounded durable workspace batch", async () => {
  const client = new HealthClient();
  const response = await handleHealthScoreRefresh(
    new Request("https://example.test/functions/v1/health-score-refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "cron" }),
    }),
    overrides(
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
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.enqueued_workspace_count, 2);
  assertEquals(body.claimed_workspace_count, 2);
  assertEquals(body.terminal_failure_count, 0);
  const claim = client.rpcCalls.find((call) =>
    call.name === "claim_health_score_refresh_jobs"
  );
  assertEquals(claim?.args.p_limit, 2);
  assertEquals(claim?.args.p_lease_seconds, 300);
  const alertWorkspaces = client.rpcCalls
    .filter((call) => call.name === "generate_cross_department_alerts")
    .map((call) => call.args.p_workspace_id)
    .sort();
  assertEquals(alertWorkspaces, ["workspace-a", "workspace-b"]);
  const completions = client.rpcCalls.filter((call) =>
    call.name === "complete_health_score_refresh_job"
  );
  assertEquals(completions.length, 2);
  assertEquals(
    completions.every((call) =>
      call.args.p_status === "queued" && call.args.p_phase === "dna"
    ),
    true,
  );
  for (const workspaceId of ["workspace-a", "workspace-b"]) {
    assertEquals(
      client.rpcCalls.some((call) =>
        call.name === "list_customer_health_profiles_page" &&
        call.args.p_workspace_id === workspaceId &&
        call.args.p_limit === 21
      ),
      true,
    );
  }
});

Deno.test("service workspace discovery preserves more than one thousand RPC results", async () => {
  const workspaceIds = Array.from(
    { length: 1005 },
    (_, index) => `workspace-${String(index).padStart(4, "0")}`,
  );
  const resolved = await discoverServiceWorkspaces({
    rpc() {
      return Promise.resolve({ data: workspaceIds, error: null });
    },
  } as never);
  assertEquals(resolved.length, 1005);
  assertEquals(resolved[1004], "workspace-1004");
});
