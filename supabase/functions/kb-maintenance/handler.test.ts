import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { authenticateKbMaintenance,
  type KbMaintenanceAuthResult,
  handleKbMaintenance,
  resolveKbMaintenanceWorkspace,
} from "./handler.ts";

const PROFILE_WORKSPACE = "workspace-profile-a";
const FORGED_WORKSPACE = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";
const SHOP_B_DOC_ID = "doc-shop-b-1";
const VALID_EMBEDDING = JSON.stringify(Array(1536).fill(0.1));
const SERVICE_KEY = "service-role-token";
const INTERNAL_SECRET = "kb-maintenance-internal-test";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
const originalDgeInternalSecret = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");

Deno.env.set("SUPABASE_URL", "https://example.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");

type Filter = { table: string; column: string; value: unknown; op?: string };

class QueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  readonly filters: Filter[] = [];
  private insertRow: Record<string, unknown> | null = null;
  private updateRow: Record<string, unknown> | null = null;
  private deleteMode = false;

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

  in(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "in" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  is(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "is" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    const filter = { table: this.table, column, value: `${operator}:${value}`, op: "not" };
    this.filters.push(filter);
    this.owner.filters.push(filter);
    return this;
  }

  order(_column: string, _options?: Record<string, unknown>): this {
    return this;
  }

  limit(_count: number): this {
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

  delete(): this {
    this.deleteMode = true;
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
    if (this.updateRow || this.deleteMode) {
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    }

    let data: unknown = null;

    if (this.table === "kb_job_runs" && this.insertRow) {
      data = { id: "run-1" };
    } else if (this.table === "documents") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      const requestedIds = this.filters.find((filter) => filter.column === "id" && filter.op === "in")?.value;
      if (workspace === PROFILE_WORKSPACE) {
        data = [{
          id: "doc-shop-a-1",
          title: "Shop A Manual",
          raw_text: "",
          mime_type: "text/plain",
        }];
      } else if (workspace === CRON_WORKSPACE) {
        data = [{
          id: "doc-cron-1",
          title: "Cron Manual",
          raw_text: "",
          mime_type: "text/plain",
        }];
      } else if (!workspace && Array.isArray(requestedIds) && requestedIds.includes(SHOP_B_DOC_ID)) {
        data = [{
          id: SHOP_B_DOC_ID,
          title: "Shop B Manual",
          raw_text: "",
          mime_type: "text/plain",
        }];
      } else if (!workspace) {
        data = [{ id: "doc-global-1", title: "Global", raw_text: "", mime_type: "text/plain" }];
      } else {
        data = [];
      }
    } else if (this.table === "machine_knowledge_notes" && !this.updateRow) {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      data = workspace === PROFILE_WORKSPACE
        ? [{ id: "note-a-1", content: "", embedding: VALID_EMBEDDING }]
        : workspace === CRON_WORKSPACE
        ? [{ id: "note-cron-1", content: "", embedding: VALID_EMBEDDING }]
        : !workspace
        ? [{ id: "note-global-1", content: "", embedding: VALID_EMBEDDING }]
        : [];
    } else if (this.table === "chunks" && !this.deleteMode) {
      const documentIds = this.filters.find((filter) => filter.column === "document_id" && filter.op === "in")?.value;
      if (Array.isArray(documentIds) && documentIds.includes("doc-shop-a-1")) {
        data = [{ id: "chunk-a-1", embedding: VALID_EMBEDDING }];
      } else if (!documentIds) {
        data = [{ id: "chunk-global-1", embedding: VALID_EMBEDDING }];
      } else {
        data = [];
      }
    } else if (this.table === "crm_embeddings") {
      const entityType = this.filters.find((filter) => filter.column === "entity_type" && filter.op === "eq")?.value;
      const entityIds = this.filters.find((filter) => filter.column === "entity_id" && filter.op === "in")?.value;
      if (entityType === "voice_capture" && Array.isArray(entityIds)) {
        if (entityIds.includes("voice-a-1")) {
          data = [{
            id: "crm-emb-voice-a-1",
            embedding: VALID_EMBEDDING,
            entity_id: "voice-a-1",
          }];
        } else if (entityIds.includes("voice-b-1")) {
          data = [{
            id: "crm-emb-voice-b-1",
            embedding: VALID_EMBEDDING,
            entity_id: "voice-b-1",
          }];
        } else {
          data = [];
        }
      } else if (Array.isArray(entityIds) && entityIds.includes("company-a-1")) {
        data = [{ id: "crm-emb-a-1", embedding: VALID_EMBEDDING }];
      } else if (!entityIds && !entityType) {
        data = [{ id: "crm-emb-global-1", embedding: VALID_EMBEDDING }];
      } else {
        data = [];
      }
    } else if (this.table === "voice_captures") {
      const linkedCompanyIds = this.filters.find(
        (filter) => filter.column === "linked_company_id" && filter.op === "in",
      )?.value;
      const linkedContactIds = this.filters.find(
        (filter) => filter.column === "linked_contact_id" && filter.op === "in",
      )?.value;
      const linkedDealIds = this.filters.find(
        (filter) => filter.column === "linked_deal_id" && filter.op === "in",
      )?.value;
      if (Array.isArray(linkedCompanyIds) && linkedCompanyIds.includes("company-a-1")) {
        data = [{
          id: "voice-a-1",
          linked_contact_id: null,
          linked_company_id: "company-a-1",
          linked_deal_id: null,
        }];
      } else if (Array.isArray(linkedCompanyIds) && linkedCompanyIds.includes("company-b-1")) {
        data = [{
          id: "voice-b-1",
          linked_contact_id: null,
          linked_company_id: "company-b-1",
          linked_deal_id: null,
        }];
      } else if (Array.isArray(linkedContactIds) || Array.isArray(linkedDealIds)) {
        data = [];
      } else {
        data = [];
      }
    } else if (
      this.table === "crm_contacts" ||
      this.table === "crm_companies" ||
      this.table === "crm_deals" ||
      this.table === "crm_equipment" ||
      this.table === "crm_activities"
    ) {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      const idIn = this.filters.find((filter) => filter.column === "id" && filter.op === "in")?.value;
      if (workspace === PROFILE_WORKSPACE) {
        data = [{ id: "company-a-1" }];
      } else if (workspace === FORGED_WORKSPACE) {
        data = [{ id: "company-b-1" }];
      } else if (workspace === CRON_WORKSPACE) {
        data = [{ id: "company-cron-1" }];
      } else if (Array.isArray(idIn) && idIn.includes("company-a-1")) {
        data = [{ id: "company-a-1", workspace_id: PROFILE_WORKSPACE }];
      } else {
        data = [];
      }
    }

    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockAdminClient {
  filters: Filter[] = [];
  inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
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
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers as Record<string, string>,
    },
    body: JSON.stringify(body ?? {}),
  };
  return new Request("https://example.test/functions/v1/kb-maintenance", init);
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter(
    (filter) => filter.table === table && filter.column === "workspace_id" && filter.op === "eq",
  );
}

function dependencies(
  client: MockAdminClient,
  authResult: KbMaintenanceAuthResult,
  fetchImpl?: typeof fetch,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<KbMaintenanceAuthResult>;
  fetchImpl: typeof fetch;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
    fetchImpl: fetchImpl ?? (async () => new Response(JSON.stringify({
      total_processed: 1,
      total_errors: 0,
    }), { status: 200 })) as typeof fetch,
  };
}

Deno.test("resolveKbMaintenanceWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveKbMaintenanceWorkspace({
      isServiceRole: false,
      authWorkspaceId: PROFILE_WORKSPACE,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: PROFILE_WORKSPACE },
  );
});

Deno.test("resolveKbMaintenanceWorkspace allows service-role callers to target a workspace", () => {
  assertEquals(
    resolveKbMaintenanceWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: CRON_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("resolveKbMaintenanceWorkspace defaults service-role callers to unscoped maintenance", () => {
  assertEquals(
    resolveKbMaintenanceWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("missing auth returns 401 without touching the database", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({ action: "validate-dimensions", workspace_id: FORGED_WORKSPACE }),
    dependencies(client, { ok: false, status: 401 }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.fromCalls, 0);
});

Deno.test("forbidden role returns 403 without touching the database", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({ action: "validate-dimensions" }, { Authorization: "Bearer rep-token" }),
    dependencies(client, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fromCalls, 0);
});

Deno.test("JWT validate-dimensions scopes documents, notes, and CRM embeddings to profile workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({
      action: "validate-dimensions",
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(
    workspaceFilters(client, "documents").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
  assertEquals(
    workspaceFilters(client, "machine_knowledge_notes").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
  assertEquals(
    workspaceFilters(client, "crm_companies").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
  assertEquals(
    workspaceFilters(client, "documents").some((filter) => filter.value === FORGED_WORKSPACE),
    false,
  );
});

Deno.test("JWT re-embed-documents filters to profile workspace and no-ops forged document_ids", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({
      action: "re-embed-documents",
      document_ids: [SHOP_B_DOC_ID],
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer manager-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-manager-1",
      role: "manager",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.documents_processed, 0);
  assertEquals(
    workspaceFilters(client, "documents").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
  assertEquals(
    workspaceFilters(client, "documents").some((filter) => filter.value === FORGED_WORKSPACE),
    false,
  );
  assertEquals(
    workspaceFilters(client, "machine_knowledge_notes").some((filter) => filter.value === PROFILE_WORKSPACE),
    true,
  );
});

Deno.test("service-role caller can run unscoped validate-dimensions for cron", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({ action: "validate-dimensions" }, { Authorization: "Bearer service-role-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "unscoped");
  assertEquals(body.workspace_id, null);
  assertEquals(workspaceFilters(client, "documents").length, 0);
  assertEquals(workspaceFilters(client, "machine_knowledge_notes").length, 0);
});

Deno.test("service-role caller can target an explicit workspace on validate-dimensions", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({
      action: "validate-dimensions",
      workspace_id: CRON_WORKSPACE,
    }, { Authorization: "Bearer service-role-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, CRON_WORKSPACE);
  assertEquals(
    workspaceFilters(client, "documents").some((filter) => filter.value === CRON_WORKSPACE),
    true,
  );
});

Deno.test("service-role re-embed-crm passes workspace_id when scoped", async () => {
  const client = new MockAdminClient();
  const capture = { body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ total_processed: 3, total_errors: 0 }), { status: 200 });
  }) as typeof fetch;

  const response = await handleKbMaintenance(
    request({
      action: "re-embed-crm",
      workspace_id: CRON_WORKSPACE,
    }, { Authorization: "Bearer service-role-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }, fetchImpl),
  );

  assertEquals(response.status, 200);
  assertEquals(capture.body.force_all, true);
  assertEquals(capture.body.workspace_id, CRON_WORKSPACE);
  assertEquals(capture.headers["x-workspace-id"], CRON_WORKSPACE);
});

Deno.test("service-role unscoped re-embed-crm delegates global force_all without workspace", async () => {
  const client = new MockAdminClient();
  const capture = { body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ total_processed: 5, total_errors: 0 }), { status: 200 });
  }) as typeof fetch;

  const response = await handleKbMaintenance(
    request({ action: "re-embed-crm" }, { Authorization: "Bearer service-role-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }, fetchImpl),
  );

  assertEquals(response.status, 200);
  assertEquals(capture.body.force_all, true);
  assertEquals(capture.body.workspace_id, undefined);
  assertEquals(capture.headers["x-workspace-id"], undefined);
});

Deno.test("JWT re-embed-crm passes profile workspace without global force_all", async () => {
  const client = new MockAdminClient();
  const capture = { body: {} as Record<string, unknown>, headers: {} as Record<string, string> };
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({ total_processed: 2, total_errors: 0 }), { status: 200 });
  }) as typeof fetch;

  const response = await handleKbMaintenance(
    request({
      action: "re-embed-crm",
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer owner-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      role: "owner",
      workspaceId: PROFILE_WORKSPACE,
    }, fetchImpl),
  );

  assertEquals(response.status, 200);
  assertEquals(capture.body.workspace_id, PROFILE_WORKSPACE);
  assertEquals(capture.body.force_all, undefined);
  assertEquals(capture.headers["x-workspace-id"], PROFILE_WORKSPACE);
  assertEquals(capture.body.workspace_id === FORGED_WORKSPACE, false);
});

Deno.test("JWT validate-dimensions scopes voice_capture CRM embeddings via linked company workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({ action: "validate-dimensions" }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.crm_embeddings.checked >= 1, true);
  assertEquals(
    client.filters.some(
      (filter) => filter.table === "voice_captures" && filter.column === "linked_company_id",
    ),
    true,
  );
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "crm_embeddings" &&
        filter.column === "entity_type" &&
        filter.value === "voice_capture",
    ),
    true,
  );
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "crm_embeddings" &&
        filter.column === "entity_id" &&
        filter.op === "in" &&
        Array.isArray(filter.value) &&
        (filter.value as string[]).includes("voice-a-1"),
    ),
    true,
  );
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "crm_embeddings" &&
        filter.column === "entity_id" &&
        filter.op === "in",
    ),
    true,
  );
});

Deno.test("JWT validate-dimensions excludes out-of-workspace voice_capture embeddings", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({ action: "validate-dimensions" }, { Authorization: "Bearer admin-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-admin-1",
      role: "admin",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.crm_embeddings.checked >= 1, true);
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "crm_embeddings" &&
        filter.column === "entity_id" &&
        filter.op === "in" &&
        Array.isArray(filter.value) &&
        (filter.value as string[]).includes("voice-b-1"),
    ),
    false,
  );
});

Deno.test("service-role validate-dimensions accepts apikey without Authorization header", async () => {
  const client = new MockAdminClient();
  const response = await handleKbMaintenance(
    request({ action: "validate-dimensions" }, { apikey: SERVICE_KEY }),
    {
      createAdminClient: (() => client) as never,
      authenticate: authenticateKbMaintenance,
      fetchImpl: (async () => new Response(JSON.stringify({
        total_processed: 1,
        total_errors: 0,
      }), { status: 200 })) as typeof fetch,
    },
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "unscoped");
});

Deno.test("service-role validate-dimensions accepts internal secret without Authorization header", async () => {
  const previous = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");
  Deno.env.set("DGE_INTERNAL_SERVICE_SECRET", INTERNAL_SECRET);
  const client = new MockAdminClient();
  try {
    const response = await handleKbMaintenance(
      request(
        { action: "validate-dimensions" },
        { "x-internal-service-secret": INTERNAL_SECRET },
      ),
      {
        createAdminClient: (() => client) as never,
        authenticate: authenticateKbMaintenance,
        fetchImpl: (async () => new Response(JSON.stringify({
          total_processed: 1,
          total_errors: 0,
        }), { status: 200 })) as typeof fetch,
      },
    );

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.workspace_scope, "unscoped");
  } finally {
    if (previous === undefined) Deno.env.delete("DGE_INTERNAL_SERVICE_SECRET");
    else Deno.env.set("DGE_INTERNAL_SERVICE_SECRET", previous);
  }
});

Deno.test("authenticateKbMaintenance returns 401 when no auth credentials are present", async () => {
  const client = new MockAdminClient();
  const result = await authenticateKbMaintenance(
    request({ action: "validate-dimensions" }),
    client as never,
  );
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test({
  name: "kb-maintenance handler env cleanup",
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
