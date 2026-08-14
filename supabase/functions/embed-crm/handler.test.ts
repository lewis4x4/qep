import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  authenticateEmbedCrm,
  type EmbedCrmAuthResult,
  handleEmbedCrm,
  resolveEmbedCrmWorkspace,
} from "./handler.ts";

const PROFILE_WORKSPACE = "workspace-profile-a";
const FORGED_WORKSPACE = "workspace-forged-b";
const CRON_WORKSPACE = "workspace-cron-target";
const SERVICE_KEY = "service-role-token";
const INTERNAL_SECRET = "embed-crm-internal-test";

const SHOP_A = {
  contact: "contact-a-1",
  company: "company-a-1",
  deal: "deal-a-1",
  equipment: "equipment-a-1",
  activity: "activity-a-1",
  voice: "voice-a-1",
};

const SHOP_B = {
  contact: "contact-b-1",
  company: "company-b-1",
  deal: "deal-b-1",
  equipment: "equipment-b-1",
  activity: "activity-b-1",
  voice: "voice-b-1",
};

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

  gt(column: string, value: unknown): this {
    const filter = { table: this.table, column, value, op: "gt" };
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

  range(_from: number, _to: number): this {
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

  upsert(rows: unknown): this {
    this.owner.upserts.push({ table: this.table, rows });
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
    } else if (this.table === "crm_embeddings") {
      const entityType = this.filters.find((filter) => filter.column === "entity_type" && filter.op === "eq")?.value;
      const entityIds = this.filters.find((filter) => filter.column === "entity_id" && filter.op === "in")?.value;
      const watermarkQuery = this.filters.some((filter) => filter.column === "updated_at" && filter.op === "gt");

      if (watermarkQuery) {
        data = null;
      } else if (Array.isArray(entityIds)) {
        if (entityIds.includes(SHOP_A.contact)) {
          data = { updated_at: "2026-01-01T00:00:00Z" };
        } else if (entityIds.includes(SHOP_B.contact)) {
          data = { updated_at: "2026-02-01T00:00:00Z" };
        } else {
          data = null;
        }
      } else if (entityType && !entityIds) {
        data = { updated_at: "2026-03-01T00:00:00Z" };
      } else {
        data = null;
      }
    } else if (this.table === "crm_contacts") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      const idIn = this.filters.find((filter) => filter.column === "id" && filter.op === "in")?.value;
      if (workspace === PROFILE_WORKSPACE) {
        data = [{
          id: SHOP_A.contact,
          first_name: "Alice",
          last_name: "ShopA",
          updated_at: "2026-04-01T00:00:00Z",
          primary_company_id: SHOP_A.company,
        }];
      } else if (workspace === FORGED_WORKSPACE) {
        data = [{
          id: SHOP_B.contact,
          first_name: "Bob",
          last_name: "ShopB",
          updated_at: "2026-04-01T00:00:00Z",
          primary_company_id: SHOP_B.company,
        }];
      } else if (workspace === CRON_WORKSPACE) {
        data = [{ id: "contact-cron-1", first_name: "Cron", last_name: "User", updated_at: "2026-04-01T00:00:00Z" }];
      } else if (!workspace) {
        data = [
          {
            id: SHOP_A.contact,
            first_name: "Alice",
            last_name: "ShopA",
            updated_at: "2026-04-01T00:00:00Z",
            primary_company_id: SHOP_A.company,
          },
          {
            id: SHOP_B.contact,
            first_name: "Bob",
            last_name: "ShopB",
            updated_at: "2026-04-01T00:00:00Z",
            primary_company_id: SHOP_B.company,
          },
        ];
      } else if (Array.isArray(idIn) && idIn.includes(SHOP_A.contact)) {
        data = [{ id: SHOP_A.contact, first_name: "Alice", last_name: "ShopA" }];
      } else {
        data = [];
      }
    } else if (this.table === "crm_companies") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      const idIn = this.filters.find((filter) => filter.column === "id" && filter.op === "in")?.value;
      if (workspace === PROFILE_WORKSPACE) {
        data = [{
          id: SHOP_A.company,
          name: "Shop A Co",
          updated_at: "2026-04-01T00:00:00Z",
        }];
      } else if (workspace === FORGED_WORKSPACE) {
        data = [{
          id: SHOP_B.company,
          name: "Shop B Co",
          updated_at: "2026-04-01T00:00:00Z",
        }];
      } else if (!workspace) {
        data = [
          { id: SHOP_A.company, name: "Shop A Co", updated_at: "2026-04-01T00:00:00Z" },
          { id: SHOP_B.company, name: "Shop B Co", updated_at: "2026-04-01T00:00:00Z" },
        ];
      } else if (Array.isArray(idIn) && idIn.includes(SHOP_A.company)) {
        data = [{ id: SHOP_A.company, name: "Shop A Co" }];
      } else {
        data = [];
      }
    } else if (this.table === "crm_deals") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      const idIn = this.filters.find((filter) => filter.column === "id" && filter.op === "in")?.value;
      if (workspace === PROFILE_WORKSPACE) {
        data = [{
          id: SHOP_A.deal,
          name: "Shop A Deal",
          updated_at: "2026-04-01T00:00:00Z",
        }];
      } else if (workspace === FORGED_WORKSPACE) {
        data = [{
          id: SHOP_B.deal,
          name: "Shop B Deal",
          updated_at: "2026-04-01T00:00:00Z",
        }];
      } else if (!workspace) {
        data = [
          { id: SHOP_A.deal, name: "Shop A Deal", updated_at: "2026-04-01T00:00:00Z" },
          { id: SHOP_B.deal, name: "Shop B Deal", updated_at: "2026-04-01T00:00:00Z" },
        ];
      } else if (Array.isArray(idIn) && idIn.includes(SHOP_A.deal)) {
        data = [{ id: SHOP_A.deal, name: "Shop A Deal" }];
      } else {
        data = [];
      }
    } else if (this.table === "crm_equipment") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      if (workspace === PROFILE_WORKSPACE) {
        data = [{
          id: SHOP_A.equipment,
          name: "Shop A Tractor",
          updated_at: "2026-04-01T00:00:00Z",
        }];
      } else if (workspace === FORGED_WORKSPACE) {
        data = [{
          id: SHOP_B.equipment,
          name: "Shop B Tractor",
          updated_at: "2026-04-01T00:00:00Z",
        }];
      } else if (!workspace) {
        data = [
          { id: SHOP_A.equipment, name: "Shop A Tractor", updated_at: "2026-04-01T00:00:00Z" },
          { id: SHOP_B.equipment, name: "Shop B Tractor", updated_at: "2026-04-01T00:00:00Z" },
        ];
      } else {
        data = [];
      }
    } else if (this.table === "crm_activities") {
      const workspace = this.filters.find((filter) => filter.column === "workspace_id")?.value;
      if (workspace === PROFILE_WORKSPACE) {
        data = [{
          id: SHOP_A.activity,
          activity_type: "note",
          body: "Shop A note",
          occurred_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-01T00:00:00Z",
        }];
      } else if (workspace === FORGED_WORKSPACE) {
        data = [{
          id: SHOP_B.activity,
          activity_type: "note",
          body: "Shop B note",
          occurred_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-01T00:00:00Z",
        }];
      } else if (!workspace) {
        data = [
          {
            id: SHOP_A.activity,
            activity_type: "note",
            body: "Shop A note",
            occurred_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
          },
          {
            id: SHOP_B.activity,
            activity_type: "note",
            body: "Shop B note",
            occurred_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
          },
        ];
      } else {
        data = [];
      }
    } else if (this.table === "voice_captures") {
      const linkedContactIds = this.filters.find(
        (filter) => filter.column === "linked_contact_id" && filter.op === "in",
      )?.value;
      const linkedCompanyIds = this.filters.find(
        (filter) => filter.column === "linked_company_id" && filter.op === "in",
      )?.value;
      const linkedDealIds = this.filters.find(
        (filter) => filter.column === "linked_deal_id" && filter.op === "in",
      )?.value;
      const globalScan = !linkedContactIds && !linkedCompanyIds && !linkedDealIds;

      if (globalScan) {
        data = [
          {
            id: SHOP_A.voice,
            transcript: "Shop A voice",
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
            linked_contact_id: SHOP_A.contact,
            linked_company_id: null,
            linked_deal_id: null,
          },
          {
            id: SHOP_B.voice,
            transcript: "Shop B voice",
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
            linked_contact_id: SHOP_B.contact,
            linked_company_id: null,
            linked_deal_id: null,
          },
        ];
      } else if (Array.isArray(linkedContactIds) && linkedContactIds.includes(SHOP_A.contact)) {
        data = [{
          id: SHOP_A.voice,
          transcript: "Shop A voice",
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-01T00:00:00Z",
          linked_contact_id: SHOP_A.contact,
          linked_company_id: null,
          linked_deal_id: null,
        }];
      } else if (Array.isArray(linkedContactIds) && linkedContactIds.includes(SHOP_B.contact)) {
        data = [{
          id: SHOP_B.voice,
          transcript: "Shop B voice",
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-01T00:00:00Z",
          linked_contact_id: SHOP_B.contact,
          linked_company_id: null,
          linked_deal_id: null,
        }];
      } else if (Array.isArray(linkedCompanyIds) || Array.isArray(linkedDealIds)) {
        data = [];
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
  upserts: Array<{ table: string; rows: unknown }> = [];
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
  return new Request("https://example.test/functions/v1/embed-crm", init);
}

function workspaceFilters(client: MockAdminClient, table: string): Filter[] {
  return client.filters.filter(
    (filter) => filter.table === table && filter.column === "workspace_id" && filter.op === "eq",
  );
}

function upsertedEntityIds(client: MockAdminClient): string[] {
  const ids: string[] = [];
  for (const upsert of client.upserts) {
    if (upsert.table !== "crm_embeddings") continue;
    const rows = upsert.rows as Array<{ entity_id: string }>;
    for (const row of rows) ids.push(row.entity_id);
  }
  return ids;
}

function dependencies(
  client: MockAdminClient,
  authResult: EmbedCrmAuthResult,
): {
  createAdminClient: () => SupabaseClient;
  authenticate: () => Promise<EmbedCrmAuthResult>;
  embedTextsFn: typeof import("../_shared/openai-embeddings.ts").embedTexts;
} {
  return {
    createAdminClient: (() => client) as never,
    authenticate: (async () => authResult) as never,
    embedTextsFn: (async (texts: string[]) => texts.map(() => Array(1536).fill(0.1))) as never,
  };
}

const jwtAuth = {
  ok: true as const,
  isServiceRole: false as const,
  userId: "user-admin-1",
  role: "admin",
  workspaceId: PROFILE_WORKSPACE,
};

Deno.test("resolveEmbedCrmWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveEmbedCrmWorkspace({
      isServiceRole: false,
      authWorkspaceId: PROFILE_WORKSPACE,
      requestedWorkspaceId: FORGED_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: PROFILE_WORKSPACE },
  );
});

Deno.test("resolveEmbedCrmWorkspace allows service-role callers to target a workspace", () => {
  assertEquals(
    resolveEmbedCrmWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: CRON_WORKSPACE,
    }),
    { mode: "scoped", workspaceId: CRON_WORKSPACE },
  );
});

Deno.test("resolveEmbedCrmWorkspace defaults service-role callers to unscoped", () => {
  assertEquals(
    resolveEmbedCrmWorkspace({
      isServiceRole: true,
      authWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    { mode: "unscoped" },
  );
});

Deno.test("missing auth returns 401 without touching the database", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({ force_all: true, workspace_id: FORGED_WORKSPACE }),
    dependencies(client, { ok: false, status: 401 }),
  );

  assertEquals(response.status, 401);
  assertEquals(client.fromCalls, 0);
});

Deno.test("forbidden role returns 403 without touching the database", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({}, { Authorization: "Bearer rep-token" }),
    dependencies(client, { ok: false, status: 403 }),
  );

  assertEquals(response.status, 403);
  assertEquals(client.fromCalls, 0);
});

Deno.test("JWT embed scopes CRM tables to profile workspace and ignores forged workspace_id", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({
      entity_types: ["contact", "company", "deal", "equipment", "activity"],
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer admin-token" }),
    dependencies(client, jwtAuth),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.workspace_scope, "scoped");
  assertEquals(body.workspace_id, PROFILE_WORKSPACE);

  for (const table of ["crm_contacts", "crm_companies", "crm_deals", "crm_equipment", "crm_activities"]) {
    assertEquals(
      workspaceFilters(client, table).some((filter) => filter.value === PROFILE_WORKSPACE),
      true,
      `expected ${table} workspace filter for shop A`,
    );
    assertEquals(
      workspaceFilters(client, table).some((filter) => filter.value === FORGED_WORKSPACE),
      false,
      `forged workspace must not appear on ${table}`,
    );
  }

  const entityIds = upsertedEntityIds(client);
  assertEquals(entityIds.includes(SHOP_A.contact), true);
  assertEquals(entityIds.includes(SHOP_A.company), true);
  assertEquals(entityIds.includes(SHOP_A.deal), true);
  assertEquals(entityIds.includes(SHOP_A.equipment), true);
  assertEquals(entityIds.includes(SHOP_A.activity), true);
  assertEquals(entityIds.includes(SHOP_B.contact), false);
  assertEquals(entityIds.includes(SHOP_B.company), false);
  assertEquals(entityIds.includes(SHOP_B.deal), false);
  assertEquals(entityIds.includes(SHOP_B.equipment), false);
  assertEquals(entityIds.includes(SHOP_B.activity), false);
});

Deno.test("JWT voice_capture embed uses linked CRM ids in workspace, not global voice_captures scan", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({ entity_types: ["voice_capture"] }, { Authorization: "Bearer admin-token" }),
    dependencies(client, jwtAuth),
  );

  assertEquals(response.status, 200);
  assertEquals(
    client.filters.some(
      (filter) => filter.table === "voice_captures" && filter.column === "linked_contact_id",
    ),
    true,
  );
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "voice_captures" &&
        filter.column === "linked_contact_id" &&
        filter.op === "in" &&
        Array.isArray(filter.value) &&
        (filter.value as string[]).includes(SHOP_A.contact),
    ),
    true,
  );
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "voice_captures" &&
        filter.column === "linked_contact_id" &&
        filter.op === "in" &&
        Array.isArray(filter.value) &&
        (filter.value as string[]).includes(SHOP_B.contact),
    ),
    false,
  );

  const entityIds = upsertedEntityIds(client);
  assertEquals(entityIds.includes(SHOP_A.voice), true);
  assertEquals(entityIds.includes(SHOP_B.voice), false);
});

Deno.test("JWT force_all only re-embeds within profile workspace", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({
      force_all: true,
      entity_types: ["contact"],
      workspace_id: FORGED_WORKSPACE,
    }, { Authorization: "Bearer owner-token" }),
    dependencies(client, {
      ok: true,
      isServiceRole: false,
      userId: "user-owner-1",
      role: "owner",
      workspaceId: PROFILE_WORKSPACE,
    }),
  );

  assertEquals(response.status, 200);
  const entityIds = upsertedEntityIds(client);
  assertEquals(entityIds.includes(SHOP_A.contact), true);
  assertEquals(entityIds.includes(SHOP_B.contact), false);
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "crm_embeddings" &&
        filter.column === "entity_id" &&
        filter.op === "in" &&
        Array.isArray(filter.value) &&
        (filter.value as string[]).includes(SHOP_B.contact),
    ),
    false,
  );
});

Deno.test("JWT incremental sync uses workspace-scoped embedding watermark", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({ entity_types: ["contact"] }, { Authorization: "Bearer admin-token" }),
    dependencies(client, jwtAuth),
  );

  assertEquals(response.status, 200);
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "crm_embeddings" &&
        filter.column === "entity_id" &&
        filter.op === "in" &&
        Array.isArray(filter.value) &&
        (filter.value as string[]).includes(SHOP_A.contact),
    ),
    true,
  );
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "crm_embeddings" &&
        filter.column === "entity_type" &&
        filter.value === "contact" &&
        !client.filters.some(
          (inner) => inner.table === "crm_embeddings" && inner.column === "entity_id",
        ),
    ),
    false,
  );
});

Deno.test("service-role unscoped embed can process multiple shops", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({
      force_all: true,
      entity_types: ["contact"],
    }, { Authorization: `Bearer ${SERVICE_KEY}` }),
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
  assertEquals(workspaceFilters(client, "crm_contacts").length, 0);

  const entityIds = upsertedEntityIds(client);
  assertEquals(entityIds.includes(SHOP_A.contact), true);
  assertEquals(entityIds.includes(SHOP_B.contact), true);
});

Deno.test("service-role scoped embed honors explicit workspace_id", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({
      force_all: true,
      entity_types: ["contact"],
      workspace_id: CRON_WORKSPACE,
    }, { Authorization: `Bearer ${SERVICE_KEY}` }),
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
    workspaceFilters(client, "crm_contacts").some((filter) => filter.value === CRON_WORKSPACE),
    true,
  );
});

Deno.test("service-role unscoped incremental sync uses global embedding watermark", async () => {
  const client = new MockAdminClient();
  const response = await handleEmbedCrm(
    request({ entity_types: ["contact"] }, { Authorization: `Bearer ${SERVICE_KEY}` }),
    dependencies(client, {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: null,
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(
    client.filters.some(
      (filter) =>
        filter.table === "crm_embeddings" &&
        filter.column === "entity_type" &&
        filter.value === "contact" &&
        filter.op === "eq",
    ),
    true,
  );
  assertEquals(
    client.filters.some(
      (filter) => filter.table === "crm_embeddings" && filter.column === "entity_id",
    ),
    false,
  );
});

Deno.test("authenticateEmbedCrm returns 401 when no auth credentials are present", async () => {
  const client = new MockAdminClient();
  const result = await authenticateEmbedCrm(request(), client as never);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test({
  name: "embed-crm handler env cleanup",
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
