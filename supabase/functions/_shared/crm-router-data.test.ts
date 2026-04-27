import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { RouterCtx } from "./crm-router-service.ts";
import {
  createActivity,
  createCompany,
  deliverActivity,
  getCommunicationTarget,
  patchActivity,
  patchCompany,
} from "./crm-router-data.ts";

interface QueryResult {
  data: unknown;
  error: unknown;
}

type QueryHandler = (
  table: string,
  selected: string | null,
  filters: Map<string, unknown>,
) => Promise<QueryResult>;

function makeClient(handler: QueryHandler): SupabaseClient {
  return {
    from(table: string) {
      let selected: string | null = null;
      const filters = new Map<string, unknown>();
      const query = {
        select(value: string) {
          selected = value;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.set(`eq:${column}`, value);
          return query;
        },
        is(column: string, value: unknown) {
          filters.set(`is:${column}`, value);
          return query;
        },
        order(column: string, value: unknown) {
          filters.set(`order:${column}`, value);
          return query;
        },
        limit(value: number) {
          filters.set("limit", value);
          return query;
        },
        maybeSingle() {
          return handler(table, selected, filters);
        },
      };

      return query;
    },
  } as unknown as SupabaseClient;
}

function makeCtx(overrides: Partial<RouterCtx> = {}): RouterCtx {
  return {
    admin: makeClient(async () => ({ data: null, error: null })),
    callerDb: makeClient(async () => ({ data: null, error: null })),
    caller: {
      authHeader: "Bearer token",
      userId: "user-1",
      role: "rep",
      isServiceRole: false,
      workspaceId: null,
    },
    workspaceId: "default",
    requestId: "req-1",
    route: "/crm/communication-target",
    method: "GET",
    ipInet: null,
    userAgent: null,
    ...overrides,
  };
}

function makeMutableClient(
  tables: Record<string, Array<Record<string, unknown>>>,
): SupabaseClient {
  return {
    from(table: string) {
      let selected: string | null = null;
      const filters = new Map<string, unknown>();

      const query = {
        select(value: string) {
          selected = value;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.set(`eq:${column}`, value);
          return query;
        },
        is(column: string, value: unknown) {
          filters.set(`is:${column}`, value);
          return query;
        },
        maybeSingle() {
          const rows = tables[table] ?? [];
          const data = rows.find((row) =>
            Array.from(filters.entries()).every(([key, value]) => {
              const [, type, column] = key.match(/^(eq|is):(.*)$/) ?? [];
              if (!type || !column) return true;
              const rowValue = row[column];
              if (type === "eq") return rowValue === value;
              return value === null ? rowValue === null || rowValue === undefined : rowValue === value;
            })
          ) ?? null;
          return Promise.resolve({ data, error: null });
        },
        insert(payload: Record<string, unknown>) {
          const rows = tables[table] ?? (tables[table] = []);
          rows.push({
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...payload,
          });
          return Promise.resolve({ error: null });
        },
      };

      return query;
    },
  } as unknown as SupabaseClient;
}

function makeActivityMutationClient(
  tables: Record<string, Array<Record<string, unknown>>>,
): SupabaseClient {
  return {
    from(table: string) {
      let filters = new Map<string, unknown>();
      let updatePayload: Record<string, unknown> | null = null;
      let selectValue: string | null = null;

      const matches = (row: Record<string, unknown>) =>
        Array.from(filters.entries()).every(([key, value]) => {
          const [, type, column] = key.match(/^(eq|is):(.*)$/) ?? [];
          if (!type || !column) return true;
          const rowValue = row[column];
          if (type === "eq") return rowValue === value;
          return value === null ? rowValue === null || rowValue === undefined : rowValue === value;
        });

      const latestRow = () => (tables[table] ?? []).find(matches) ?? null;

      const query = {
        select(value: string) {
          selectValue = value;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.set(`eq:${column}`, value);
          return query;
        },
        is(column: string, value: unknown) {
          filters.set(`is:${column}`, value);
          return query;
        },
        insert(payload: Record<string, unknown>) {
          const rows = tables[table] ?? (tables[table] = []);
          const now = new Date().toISOString();
          rows.push({
            created_at: now,
            updated_at: now,
            ...payload,
          });
          return Promise.resolve({ error: null });
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return query;
        },
        maybeSingle() {
          if (updatePayload) {
            const row = latestRow();
            if (!row) return Promise.resolve({ data: null, error: null });
            Object.assign(row, updatePayload, {
              updated_at: new Date().toISOString(),
            });
            if (selectValue === "id") {
              return Promise.resolve({ data: { id: row.id }, error: null });
            }
            return Promise.resolve({ data: row, error: null });
          }
          return Promise.resolve({ data: latestRow(), error: null });
        },
        single() {
          if (updatePayload) {
            const row = latestRow();
            if (!row) return Promise.resolve({ data: null, error: null });
            Object.assign(row, updatePayload, {
              updated_at: new Date().toISOString(),
            });
            return Promise.resolve({ data: row, error: null });
          }
          return Promise.resolve({ data: latestRow(), error: null });
        },
      };

      return query;
    },
  } as unknown as SupabaseClient;
}

Deno.test("createCompany rejects rep EIN writes before database mutation", async () => {
  const ctx = makeCtx({
    callerDb: makeClient(async () => {
      throw new Error("database should not be called for unauthorized EIN writes");
    }),
  });

  await assertRejects(
    () => createCompany(ctx, { name: "Evergreen Farms", ein: "12-3456789" }),
    Error,
    "FORBIDDEN_CUSTOMER_EIN_WRITE",
  );
});

Deno.test("patchCompany rejects rep EIN writes before database mutation", async () => {
  const ctx = makeCtx({
    callerDb: makeClient(async () => {
      throw new Error("database should not be called for unauthorized EIN writes");
    }),
  });

  await assertRejects(
    () => patchCompany(ctx, "company-1", { name: "Evergreen Farms", ein: "12-3456789" }),
    Error,
    "FORBIDDEN_CUSTOMER_EIN_WRITE",
  );
});

Deno.test("getCommunicationTarget fails closed for cross-rep hidden contacts", async () => {
  const ctx = makeCtx({
    callerDb: makeClient(async (table, selected, filters) => {
      assertEquals(table, "crm_contacts");
      assertEquals(selected, "id");
      assertEquals(filters.get("eq:workspace_id"), "default");
      assertEquals(filters.get("eq:id"), "contact-hidden");
      return { data: null, error: null };
    }),
    admin: makeClient(async () => {
      throw new Error("provider lookup should not run for hidden contacts");
    }),
  });

  const target = await getCommunicationTarget(ctx, {
    activityType: "email",
    contactId: "contact-hidden",
  });

  assertEquals(target, {
    available: false,
    contact: null,
    reasonCode: "missing_recipient_contact",
    mergeFields: {},
  });
});

Deno.test("getCommunicationTarget fails closed for cross-workspace hidden contacts", async () => {
  const ctx = makeCtx({
    workspaceId: "tenant-b",
    caller: {
      authHeader: "Bearer token",
      userId: "tenant-b-user",
      role: "rep",
      isServiceRole: false,
      workspaceId: null,
    },
    callerDb: makeClient(async (table, selected, filters) => {
      assertEquals(table, "crm_contacts");
      assertEquals(selected, "id");
      assertEquals(filters.get("eq:workspace_id"), "tenant-b");
      assertEquals(filters.get("eq:id"), "contact-default-workspace");
      return { data: null, error: null };
    }),
    admin: makeClient(async () => {
      throw new Error(
        "provider lookup should not run for cross-workspace targets",
      );
    }),
  });

  const target = await getCommunicationTarget(ctx, {
    activityType: "sms",
    contactId: "contact-default-workspace",
  });

  assertEquals(target, {
    available: false,
    contact: null,
    reasonCode: "missing_recipient_contact",
    mergeFields: {},
  });
});

Deno.test("getCommunicationTarget preserves deterministic readiness for in-scope contacts", async () => {
  const ctx = makeCtx({
    callerDb: makeClient(async (table, selected, filters) => {
      if (selected === "id") {
        assertEquals(table, "crm_contacts");
        assertEquals(filters.get("eq:id"), "contact-visible");
        return { data: { id: "contact-visible" }, error: null };
      }

      assertEquals(table, "crm_contacts");
      throw new Error(`unexpected callerDb query: ${table} ${selected}`);
    }),
    admin: makeClient(async (table, selected, filters) => {
      if (table === "crm_contacts") {
        assertEquals(
          selected,
          "id, workspace_id, first_name, last_name, email, phone, title, sms_opt_in, sms_opt_in_at, sms_opt_in_source, crm_companies(name)",
        );
        assertEquals(filters.get("eq:workspace_id"), "default");
        assertEquals(filters.get("eq:id"), "contact-visible");
        return {
          data: {
            id: "contact-visible",
            workspace_id: "default",
            first_name: "Mason",
            last_name: "Reed",
            email: "mason@example.com",
            phone: "+15555550123",
            title: "Fleet Manager",
            sms_opt_in: true,
            sms_opt_in_at: "2026-04-01T00:00:00.000Z",
            sms_opt_in_source: "trade_show",
            crm_companies: { name: "QEP Rentals" },
          },
          error: null,
        };
      }

      assertEquals(table, "integration_status");
      assertEquals(filters.get("eq:workspace_id"), "default");
      assertEquals(filters.get("eq:integration_key"), "sendgrid");
      assertEquals(filters.get("eq:status"), "connected");
      return {
        data: {
          workspace_id: "default",
          endpoint_url: "https://api.sendgrid.com",
          credentials_encrypted: null,
          config: null,
        },
        error: null,
      };
    }),
  });

  const target = await getCommunicationTarget(ctx, {
    activityType: "email",
    contactId: "contact-visible",
  });

  assertEquals(target, {
    available: false,
    contact: {
      id: "contact-visible",
      companyName: "QEP Rentals",
      email: "mason@example.com",
      firstName: "Mason",
      fullName: "Mason Reed",
      lastName: "Reed",
      phone: "+15555550123",
      smsOptIn: true,
      smsOptInAt: "2026-04-01T00:00:00.000Z",
      smsOptInSource: "trade_show",
      title: "Fleet Manager",
    },
    mergeFields: {
      company_name: "QEP Rentals",
      email: "mason@example.com",
      first_name: "Mason",
      full_name: "Mason Reed",
      last_name: "Reed",
      phone: "+15555550123",
      title: "Fleet Manager",
    },
    provider: "sendgrid",
    reasonCode: "sendgrid_not_configured",
  });
});

Deno.test("createActivity reads contact-linked rep activities in a follow-up query", async () => {
  const tables = {
    crm_contacts: [{
      id: "contact-visible",
      workspace_id: "default",
      deleted_at: null,
    }],
    crm_activities: [] as Array<Record<string, unknown>>,
  };

  const ctx = makeCtx({
    callerDb: makeMutableClient(tables),
  });

  const activity = await createActivity(ctx, {
    activityType: "note",
    body: "Follow up with the yard foreman before dispatch.",
    occurredAt: "2026-04-02T12:00:00.000Z",
    contactId: "contact-visible",
  }) as {
    id: string;
    activityType: string;
    body: string | null;
    contactId: string | null;
    createdBy: string | null;
  };

  assertEquals(activity.activityType, "note");
  assertEquals(activity.body, "Follow up with the yard foreman before dispatch.");
  assertEquals(activity.contactId, "contact-visible");
  assertEquals(activity.createdBy, "user-1");
  assertEquals(tables.crm_activities.length, 1);
  assertEquals(tables.crm_activities[0].contact_id, "contact-visible");
});

Deno.test("createActivity keeps disconnected sendNow requests fail-open with manual metadata when body is blank", async () => {
  const tables = {
    crm_contacts: [{
      id: "contact-visible",
      workspace_id: "default",
      deleted_at: null,
    }],
    crm_activities: [] as Array<Record<string, unknown>>,
  };

  const ctx = makeCtx({
    callerDb: makeActivityMutationClient(tables),
    admin: makeClient(async (table, selected, filters) => {
      if (table === "integration_status") {
        assertEquals(filters.get("eq:workspace_id"), "default");
        assertEquals(filters.get("eq:integration_key"), "sendgrid");
        assertEquals(filters.get("eq:status"), "connected");
        return { data: null, error: null };
      }
      throw new Error(`unexpected admin query: ${table} ${selected}`);
    }),
  });

  const activity = await createActivity(ctx, {
    activityType: "email",
    body: "   ",
    occurredAt: "2026-04-02T12:00:00.000Z",
    contactId: "contact-visible",
    sendNow: true,
  }) as { metadata: { communication: Record<string, unknown> } };

  assertEquals(activity.metadata.communication.status, "manual_logged");
  assertEquals(activity.metadata.communication.reasonCode, "missing_body");
  assertEquals(activity.metadata.communication.mode, "manual");
  assertEquals(tables.crm_activities.length, 1);
});

Deno.test("patchActivity rejects body edits while a fresh delivery lock is active", async () => {
  const now = new Date().toISOString();
  const tables = {
    crm_activities: [{
      id: "activity-1",
      workspace_id: "default",
      activity_type: "email",
      body: "Initial body",
      occurred_at: "2026-04-02T12:00:00.000Z",
      contact_id: "contact-visible",
      company_id: null,
      deal_id: null,
      created_by: "user-1",
      metadata: {
        communication: {
          deliveryInProgress: true,
          deliveryInProgressAt: now,
        },
      },
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }],
  };

  const ctx = makeCtx({
    callerDb: makeActivityMutationClient(tables),
  });

  await assertRejects(
    () =>
      patchActivity(ctx, "activity-1", {
        body: "Updated body",
      }),
    Error,
    "VALIDATION_ACTIVITY_BODY_LOCKED",
  );
});

Deno.test("deliverActivity rejects resend while a fresh delivery lock is active", async () => {
  const now = new Date().toISOString();
  const tables = {
    crm_activities: [{
      id: "activity-1",
      workspace_id: "default",
      activity_type: "sms",
      body: "Dispatch is on the way.",
      occurred_at: "2026-04-02T12:00:00.000Z",
      contact_id: "contact-visible",
      company_id: null,
      deal_id: null,
      created_by: "user-1",
      metadata: {
        communication: {
          deliveryInProgress: true,
          deliveryInProgressAt: now,
        },
      },
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }],
  };

  const ctx = makeCtx({
    callerDb: makeActivityMutationClient(tables),
  });

  await assertRejects(
    () => deliverActivity(ctx, "activity-1", { sendNow: true }),
    Error,
    "VALIDATION_ACTIVITY_DELIVERY_IN_PROGRESS",
  );
});
