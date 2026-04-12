import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { RouterCtx } from "./crm-router-service.ts";
import { getCommunicationTarget } from "./crm-router-data.ts";

interface FakeQueryState {
  table: string;
  filters: Array<{ type: "eq" | "is"; column: string; value: unknown }>;
  orderBy: string | null;
  ascending: boolean;
  limitCount: number | null;
}

function applyFilters(
  rows: Array<Record<string, unknown>>,
  state: FakeQueryState,
): Array<Record<string, unknown>> {
  let output = rows.filter((row) =>
    state.filters.every((filter) => {
      const value = row[filter.column];
      if (filter.type === "eq") {
        return value === filter.value;
      }
      return filter.value === null ? value === null || value === undefined : value === filter.value;
    })
  );

  if (state.orderBy) {
    output = [...output].sort((left, right) => {
      const leftValue = left[state.orderBy!];
      const rightValue = right[state.orderBy!];
      const leftText = leftValue === null || leftValue === undefined ? "" : String(leftValue);
      const rightText = rightValue === null || rightValue === undefined ? "" : String(rightValue);
      if (leftText === rightText) return 0;
      const comparison = leftText < rightText ? -1 : 1;
      return state.ascending ? comparison : -comparison;
    });
  }

  if (state.limitCount !== null) {
    output = output.slice(0, state.limitCount);
  }

  return output;
}

function createFakeClient(
  tables: Record<string, Array<Record<string, unknown>>>,
): SupabaseClient {
  return {
    from(table: string) {
      const state: FakeQueryState = {
        table,
        filters: [],
        orderBy: null,
        ascending: true,
        limitCount: null,
      };

      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          state.filters.push({ type: "eq", column, value });
          return query;
        },
        is(column: string, value: unknown) {
          state.filters.push({ type: "is", column, value });
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          state.orderBy = column;
          state.ascending = options?.ascending ?? true;
          return query;
        },
        limit(count: number) {
          state.limitCount = count;
          return query;
        },
        async maybeSingle<T>() {
          const matches = applyFilters(tables[state.table] ?? [], state);
          return { data: (matches[0] ?? null) as T | null, error: null };
        },
      };

      return query;
    },
  } as unknown as SupabaseClient;
}

function makeRouterCtx(overrides: Partial<RouterCtx> = {}): RouterCtx {
  return {
    admin: createFakeClient({}),
    callerDb: createFakeClient({}),
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

function makeContactRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "contact-1",
    workspace_id: "default",
    first_name: "Rylee",
    last_name: "McKenzie",
    email: "rylee@example.com",
    phone: "+13865551212",
    title: "Sales Manager",
    sms_opt_in: true,
    sms_opt_in_at: "2026-04-01T12:00:00.000Z",
    sms_opt_in_source: "trade_show",
    primary_company_id: "company-1",
    updated_at: "2026-04-01T12:00:00.000Z",
    deleted_at: null,
    crm_companies: { name: "QEP USA" },
    ...overrides,
  };
}

Deno.test("communication-target fails closed when a rep requests another rep's contact", async () => {
  const ctx = makeRouterCtx({
    admin: createFakeClient({
      crm_contacts: [makeContactRow()],
      integration_status: [],
    }),
    callerDb: createFakeClient({
      crm_contacts: [],
    }),
  });

  const target = await getCommunicationTarget(ctx, {
    activityType: "email",
    contactId: "contact-1",
  });

  assertEquals(target, {
    available: false,
    contact: null,
    reasonCode: "missing_recipient_contact",
    mergeFields: {},
  });
});

Deno.test("communication-target fails closed when the caller cannot see the deal in another workspace", async () => {
  const ctx = makeRouterCtx({
    admin: createFakeClient({
      crm_deals: [{ id: "deal-1", workspace_id: "default", primary_contact_id: "contact-1", deleted_at: null }],
      crm_contacts: [makeContactRow()],
      integration_status: [],
    }),
    callerDb: createFakeClient({
      crm_deals: [],
    }),
  });

  const target = await getCommunicationTarget(ctx, {
    activityType: "sms",
    dealId: "deal-1",
  });

  assertEquals(target, {
    available: false,
    contact: null,
    reasonCode: "missing_recipient_contact",
    mergeFields: {},
  });
});

Deno.test("communication-target keeps deterministic unavailable payloads for in-scope callers", async () => {
  const contactRow = makeContactRow();
  const ctx = makeRouterCtx({
    caller: {
      authHeader: "Bearer token",
      userId: "manager-1",
      role: "manager",
      isServiceRole: false,
      workspaceId: null,
    },
    admin: createFakeClient({
      crm_contacts: [contactRow],
      integration_status: [],
    }),
    callerDb: createFakeClient({
      crm_contacts: [{ id: "contact-1", workspace_id: "default", deleted_at: null }],
    }),
  });

  const target = await getCommunicationTarget(ctx, {
    activityType: "email",
    contactId: "contact-1",
  });

  assertEquals(target, {
    available: false,
    contact: {
      id: "contact-1",
      companyName: "QEP USA",
      email: "rylee@example.com",
      firstName: "Rylee",
      fullName: "Rylee McKenzie",
      lastName: "McKenzie",
      phone: "+13865551212",
      smsOptIn: true,
      smsOptInAt: "2026-04-01T12:00:00.000Z",
      smsOptInSource: "trade_show",
      title: "Sales Manager",
    },
    mergeFields: {
      company_name: "QEP USA",
      email: "rylee@example.com",
      first_name: "Rylee",
      full_name: "Rylee McKenzie",
      last_name: "McKenzie",
      phone: "+13865551212",
      title: "Sales Manager",
    },
    provider: "sendgrid",
    reasonCode: "sendgrid_not_configured",
  });
});

Deno.test("communication-target preserves service-mode reads after workspace-bound authorization", async () => {
  const contactRow = makeContactRow();
  const ctx = makeRouterCtx({
    caller: {
      authHeader: "Bearer service-token",
      userId: null,
      role: null,
      isServiceRole: true,
      workspaceId: "default",
    },
    admin: createFakeClient({
      crm_contacts: [contactRow],
      integration_status: [],
    }),
    callerDb: createFakeClient({
      crm_contacts: [],
    }),
  });

  const target = await getCommunicationTarget(ctx, {
    activityType: "email",
    contactId: "contact-1",
  });

  assertEquals(
    (target as { contact?: { id?: string } | null }).contact?.id,
    "contact-1",
  );
  assertEquals(
    (target as { reasonCode?: string | null }).reasonCode,
    "sendgrid_not_configured",
  );
});
