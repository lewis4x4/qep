import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import { resolveCallerContext } from "../_shared/dge-auth.ts";
import { CustomerDnaWorkspaceError } from "../_shared/customer-dna-store.ts";
import {
  type CustomerDnaUpdateDependencies,
  handleCustomerDnaUpdate,
  resolveCustomerDnaTargetWorkspace,
} from "./handler.ts";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
const originalDgeInternalSecret = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");
const SERVICE_KEY = "sb_secret_customer_dna_handler_test_only";
const WORKSPACE_ID = "workspace-customer-dna-test";

Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.delete("INTERNAL_SERVICE_SECRET");
Deno.env.delete("DGE_INTERNAL_SERVICE_SECRET");

function request(
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/customer-dna-update", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function callerContext(
  overrides: Partial<CallerContext> = {},
): CallerContext {
  return {
    authHeader: "Bearer staff-token",
    userId: "user-1",
    role: "manager",
    isServiceRole: false,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  };
}

function dependencies(params: {
  caller?: CallerContext;
  refresh?: (
    adminClient: unknown,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
} = {}): Partial<CustomerDnaUpdateDependencies> {
  return {
    createAdminClient: (() => ({ kind: "admin-client" })) as never,
    resolveCallerContext:
      (async () => params.caller ?? callerContext()) as never,
    refreshCustomerProfileSnapshot: (params.refresh ??
      (async () => ({ refreshed: true }))) as never,
    checkRateLimit: (() => ({
      allowed: true,
      retryAfterSeconds: 0,
    })) as never,
  };
}

Deno.test("service workspace resolution requires an explicit tenant", () => {
  assertEquals(
    resolveCustomerDnaTargetWorkspace({
      isServiceRole: true,
      callerWorkspaceId: null,
      requestedWorkspaceId: null,
    }),
    {
      ok: false,
      status: 400,
      code: "WORKSPACE_REQUIRED",
      message: "Service callers must provide an explicit workspace target.",
    },
  );
});

Deno.test("workspace resolution rejects a conflicting target", () => {
  const result = resolveCustomerDnaTargetWorkspace({
    isServiceRole: false,
    callerWorkspaceId: WORKSPACE_ID,
    requestedWorkspaceId: "other-workspace",
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 403);
});

Deno.test("endpoint accepts a modern sb_secret bearer service caller", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleCustomerDnaUpdate(
    request(
      {
        workspace_id: WORKSPACE_ID,
        customer_profiles_extended_id: "profile-1",
      },
      { Authorization: `Bearer ${SERVICE_KEY}` },
    ),
    {
      ...dependencies({
        refresh: async (_client, input) => {
          calls.push(input);
          return { refreshed: true };
        },
      }),
      resolveCallerContext,
    },
  );

  assertEquals(response.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].workspaceId, WORKSPACE_ID);
  assertEquals(calls[0].isServiceRole, true);
});

Deno.test("endpoint accepts a modern sb_secret apikey service caller", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleCustomerDnaUpdate(
    request(
      { customer_profiles_extended_id: "profile-1" },
      { apikey: SERVICE_KEY, "x-workspace-id": WORKSPACE_ID },
    ),
    {
      ...dependencies({
        refresh: async (_client, input) => {
          calls.push(input);
          return { refreshed: true };
        },
      }),
      resolveCallerContext,
    },
  );

  assertEquals(response.status, 200);
  assertEquals(calls[0].workspaceId, WORKSPACE_ID);
});

Deno.test("endpoint preserves elevated staff authorization", async () => {
  for (const role of ["admin", "manager", "owner"] as const) {
    const response = await handleCustomerDnaUpdate(
      request({
        workspace_id: WORKSPACE_ID,
        customer_profiles_extended_id: "profile-1",
      }),
      dependencies({ caller: callerContext({ role }) }),
    );
    assertEquals(response.status, 200);
  }
});

Deno.test("endpoint keeps ordinary reps forbidden without mutation", async () => {
  let mutations = 0;
  const response = await handleCustomerDnaUpdate(
    request({ customer_profiles_extended_id: "profile-1" }),
    dependencies({
      caller: callerContext({ role: "rep" }),
      refresh: async () => {
        mutations++;
        return {};
      },
    }),
  );
  const body = await response.json();
  assertEquals(response.status, 403);
  assertEquals(body.error.code, "FORBIDDEN");
  assertEquals(mutations, 0);
});

Deno.test("endpoint rejects invalid authentication without mutation", async () => {
  let mutations = 0;
  const response = await handleCustomerDnaUpdate(
    request({ customer_profiles_extended_id: "profile-1" }),
    dependencies({
      caller: callerContext({
        authHeader: null,
        userId: null,
        role: null,
        workspaceId: null,
      }),
      refresh: async () => {
        mutations++;
        return {};
      },
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(mutations, 0);
});

Deno.test("endpoint rejects cross-workspace fixture requests before mutation", async () => {
  let mutations = 0;
  const response = await handleCustomerDnaUpdate(
    request({
      workspace_id: "other-workspace",
      customer_profiles_extended_id: "profile-1",
    }),
    dependencies({
      refresh: async () => {
        mutations++;
        return {};
      },
    }),
  );
  const body = await response.json();
  assertEquals(response.status, 403);
  assertEquals(body.error.code, "WORKSPACE_MISMATCH");
  assertEquals(mutations, 0);
});

Deno.test("endpoint maps a store-level tenant mismatch to 403", async () => {
  const response = await handleCustomerDnaUpdate(
    request({ customer_profiles_extended_id: "profile-1" }),
    dependencies({
      refresh: async () => {
        throw new CustomerDnaWorkspaceError();
      },
    }),
  );
  const body = await response.json();
  assertEquals(response.status, 403);
  assertEquals(body.error.code, "WORKSPACE_MISMATCH");
});

async function assertRealResolverRejectsWithoutMutation(
  headers: HeadersInit,
): Promise<void> {
  let mutations = 0;
  const response = await handleCustomerDnaUpdate(
    request(
      {
        workspace_id: WORKSPACE_ID,
        customer_profiles_extended_id: "profile-1",
      },
      headers,
    ),
    {
      ...dependencies({
        refresh: async () => {
          mutations++;
          return {};
        },
      }),
      resolveCallerContext,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(mutations, 0);
}

Deno.test("real resolver rejects a wrong bearer service secret without mutation", async () => {
  await assertRealResolverRejectsWithoutMutation({
    Authorization: "Bearer sb_secret_wrong_customer_dna_key",
  });
});

Deno.test("real resolver rejects a wrong apikey service secret without mutation", async () => {
  await assertRealResolverRejectsWithoutMutation({
    apikey: "sb_secret_wrong_customer_dna_key",
  });
});

Deno.test("real resolver rejects a wrong internal service secret without mutation", async () => {
  await assertRealResolverRejectsWithoutMutation({
    "x-internal-service-secret": "wrong-internal-secret",
  });
});

Deno.test("real resolver rejects a malformed bearer JWT without mutation", async () => {
  await assertRealResolverRejectsWithoutMutation({
    Authorization: "Bearer not-a-jwt",
  });
});

Deno.test("real resolver accepts the canonical internal secret path", async () => {
  const previous = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");
  Deno.env.set("DGE_INTERNAL_SERVICE_SECRET", "customer-dna-internal-test");
  let mutations = 0;
  try {
    const response = await handleCustomerDnaUpdate(
      request(
        {
          workspace_id: WORKSPACE_ID,
          customer_profiles_extended_id: "profile-1",
        },
        {
          "x-internal-service-secret": "customer-dna-internal-test",
          "x-workspace-id": WORKSPACE_ID,
        },
      ),
      {
        ...dependencies({
          refresh: async () => {
            mutations++;
            return { refreshed: true };
          },
        }),
        resolveCallerContext,
      },
    );
    assertEquals(response.status, 200);
    assertEquals(mutations, 1);
  } finally {
    if (previous === undefined) Deno.env.delete("DGE_INTERNAL_SERVICE_SECRET");
    else Deno.env.set("DGE_INTERNAL_SERVICE_SECRET", previous);
  }
});

Deno.test({
  name: "customer-dna handler env cleanup",
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
