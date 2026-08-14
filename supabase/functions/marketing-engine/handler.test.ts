import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  authenticateMarketingEngine,
  handleMarketingEngine,
  resolveMarketingEngineWorkspace,
  type MarketingEngineAuthResult,
} from "./handler.ts";

const SHOP_A = "shop-a-workspace";
const SHOP_B = "shop-b-workspace";
const FORGED_WORKSPACE = "forged-workspace";
const SERVICE_KEY = "service-role-token";

const TRIGGERS = [
  {
    id: "trigger-a-1",
    workspace_id: SHOP_A,
    is_active: true,
    auto_create_campaign: true,
    event_type: "new_arrival",
    target_segment: {},
    equipment_filter: {},
    trigger_count: 0,
  },
  {
    id: "trigger-b-1",
    workspace_id: SHOP_B,
    is_active: true,
    auto_create_campaign: true,
    event_type: "new_arrival",
    target_segment: {},
    equipment_filter: {},
    trigger_count: 0,
  },
];

const CAMPAIGNS = [
  {
    id: "campaign-a-1",
    workspace_id: SHOP_A,
    campaign_type: "inventory_arrival",
    target_segment: {},
  },
  {
    id: "campaign-b-1",
    workspace_id: SHOP_B,
    campaign_type: "inventory_arrival",
    target_segment: {},
  },
];

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type Filter = { table: string; column: string; value: unknown; op?: string };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private insertRow: Record<string, unknown> | null = null;
  private updateRow: Record<string, unknown> | null = null;

  constructor(
    private readonly owner: MockAdminClient,
    private readonly table: string,
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "eq" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  insert(row: Record<string, unknown>): this {
    this.insertRow = row;
    this.owner.inserts.push({ table: this.table, row });
    return this;
  }

  update(row: Record<string, unknown>): this {
    this.updateRow = row;
    return this;
  }

  single(): this {
    return this;
  }

  maybeSingle(): this {
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.updateRow) {
      const idFilter = this.filters.find((filter) => filter.column === "id")?.value;
      if (this.table === "inventory_event_triggers" && typeof idFilter === "string") {
        this.owner.updatedTriggerIds.push(idFilter);
      }
      if (this.table === "marketing_campaigns" && typeof idFilter === "string") {
        this.owner.updatedCampaignIds.push(idFilter);
      }
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    }

    let data: unknown = null;

    if (this.table === "inventory_event_triggers") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      const isActive = this.filters.find((filter) => filter.column === "is_active")?.value;
      let rows = [...TRIGGERS];
      if (isActive === true) {
        rows = rows.filter((row) => row.is_active);
      }
      if (typeof workspace === "string") {
        rows = rows.filter((row) => row.workspace_id === workspace);
      }
      data = rows;
    } else if (this.table === "marketing_campaigns") {
      const campaignId = this.filters.find((filter) => filter.column === "id")?.value;
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      if (this.insertRow) {
        data = { id: "campaign-new-1", ...this.insertRow };
      } else if (typeof campaignId === "string") {
        const campaign = CAMPAIGNS.find((row) => row.id === campaignId);
        if (campaign && (typeof workspace !== "string" || campaign.workspace_id === workspace)) {
          data = campaign;
        } else {
          data = null;
        }
      }
    }

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  updatedTriggerIds: string[] = [];
  updatedCampaignIds: string[] = [];
  fromCalls = 0;

  from(table: string): QueryBuilder {
    this.fromCalls += 1;
    return new QueryBuilder(this, table);
  }
}

function request(
  body?: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/marketing-engine", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers as Record<string, string>,
    },
    body: JSON.stringify(body ?? {}),
  });
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter(
    (filter) => filter.table === table && filter.column === "workspace_id" && filter.op === "eq",
  );
}

function dependencies(
  client: MockAdminClient,
  authResult: MarketingEngineAuthResult,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<MarketingEngineAuthResult>;
  generateContent: () => Promise<{ subject: string; body: string; social_copy: string }>;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
    generateContent: async () => ({
      subject: "Test subject",
      body: "Test body",
      social_copy: "Test social",
    }),
  };
}

Deno.test("resolveMarketingEngineWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveMarketingEngineWorkspace({
      isServiceRole: false,
      authWorkspaceId: SHOP_A,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: SHOP_A },
  );
});

Deno.test("resolveMarketingEngineWorkspace allows service-role callers to target a workspace", () => {
  assertEquals(
    resolveMarketingEngineWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: SHOP_B,
    }),
    { mode: "scoped", workspaceId: SHOP_B },
  );
});

Deno.test("resolveMarketingEngineWorkspace defaults service-role callers to unscoped", () => {
  assertEquals(
    resolveMarketingEngineWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("missing auth returns 401 without touching the database", async () => {
  const client = new MockAdminClient();
  const response = await handleMarketingEngine(
    request({ action: "process_triggers", workspace_id: FORGED_WORKSPACE }),
    dependencies(client, { ok: false, status: 401 }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.fromCalls, 0);
});

Deno.test("forbidden role returns 403 without touching the database", async () => {
  const client = new MockAdminClient();
  const response = await handleMarketingEngine(
    request({ action: "process_triggers" }, { Authorization: "Bearer rep-token" }),
    dependencies(client, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fromCalls, 0);
});

Deno.test("JWT process_triggers scopes inventory_event_triggers to profile workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleMarketingEngine(
    request({
      action: "process_triggers",
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: SHOP_A,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.results.triggers_processed, 1);
  assertEquals(body.results.campaigns_created, 1);
  assertEquals(
    workspaceFilters(client, "inventory_event_triggers").some((filter) => filter.value === SHOP_A),
    true,
  );
  assertEquals(
    workspaceFilters(client, "inventory_event_triggers").some((filter) => filter.value === FORGED_WORKSPACE),
    false,
  );
  assertEquals(client.updatedTriggerIds, ["trigger-a-1"]);
  assertEquals(client.updatedTriggerIds.includes("trigger-b-1"), false);
});

Deno.test("JWT process_triggers never updates another shop trigger", async () => {
  const client = new MockAdminClient();
  await handleMarketingEngine(
    request({ action: "process_triggers" }, { Authorization: "Bearer manager-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-manager-1",
      role: "manager",
      workspaceId: SHOP_A,
    }),
  );

  assertEquals(client.updatedTriggerIds.includes("trigger-b-1"), false);
});

Deno.test("JWT generate_content returns 404 for another shop campaign_id", async () => {
  const client = new MockAdminClient();
  const response = await handleMarketingEngine(
    request({
      action: "generate_content",
      campaign_id: "campaign-b-1",
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer owner-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      role: "owner",
      workspaceId: SHOP_A,
    }),
  );

  assertEquals(response.status, 404);
  assertEquals(
    workspaceFilters(client, "marketing_campaigns").some((filter) => filter.value === SHOP_A),
    true,
  );
  assertEquals(client.updatedCampaignIds.includes("campaign-b-1"), false);
});

Deno.test("JWT generate_content updates own workspace campaign", async () => {
  const client = new MockAdminClient();
  const response = await handleMarketingEngine(
    request({
      action: "generate_content",
      campaign_id: "campaign-a-1",
    }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: SHOP_A,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.results.content_generated, 1);
  assertEquals(client.updatedCampaignIds, ["campaign-a-1"]);
});

Deno.test("service-role unscoped process_triggers processes both shops", async () => {
  const client = new MockAdminClient();
  const response = await handleMarketingEngine(
    request({ action: "process_triggers" }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.results.triggers_processed, 2);
  assertEquals(body.results.campaigns_created, 2);
  assertEquals(workspaceFilters(client, "inventory_event_triggers").length, 0);
  assertEquals(client.updatedTriggerIds.includes("trigger-a-1"), true);
  assertEquals(client.updatedTriggerIds.includes("trigger-b-1"), true);
});

Deno.test("service-role can narrow process_triggers to one workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleMarketingEngine(
    request({
      action: "process_triggers",
      workspace_id: SHOP_B,
    }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.results.triggers_processed, 1);
  assertEquals(
    workspaceFilters(client, "inventory_event_triggers").some((filter) => filter.value === SHOP_B),
    true,
  );
  assertEquals(client.updatedTriggerIds, ["trigger-b-1"]);
});

Deno.test("authenticateMarketingEngine returns 401 when no auth credentials are present", async () => {
  const client = new MockAdminClient();
  const result = await authenticateMarketingEngine(
    request({ action: "process_triggers" }),
    client as never,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test({
  name: "marketing-engine handler env cleanup",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    if (originalServiceRoleKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
    }
  },
});
