import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { CallerContext } from "./dge-auth.ts";
import {
  hydrateCaller,
  requireCaller,
  type RouterCtx,
} from "./crm-router-service.ts";

function makeRouterCtx(overrides: Partial<RouterCtx> = {}): RouterCtx {
  return {
    admin: {} as SupabaseClient,
    callerDb: {} as SupabaseClient,
    caller: {
      authHeader: null,
      userId: null,
      role: null,
      isServiceRole: false,
      workspaceId: null,
    },
    workspaceId: "default",
    requestId: "req-1",
    route: "/crm/search",
    method: "GET",
    ipInet: null,
    userAgent: null,
    ...overrides,
  };
}

Deno.test("hydrateCaller ignores x-workspace-id for bound service callers", async () => {
  const req = new Request("https://example.com/functions/v1/crm-router/crm/search?q=acme", {
    headers: {
      "x-internal-service-secret": "shared-secret",
      "x-workspace-id": "workspace-b",
    },
  });

  const ctx = await hydrateCaller(
    req,
    makeRouterCtx(),
    async (): Promise<CallerContext> => ({
      authHeader: null,
      userId: null,
      role: null,
      isServiceRole: true,
      workspaceId: "workspace-a",
    }),
  );

  assertEquals(ctx.workspaceId, "workspace-a");
});

Deno.test("requireCaller rejects service callers without a bound workspace", () => {
  const ctx = makeRouterCtx({
    caller: {
      authHeader: "Bearer signed-token",
      userId: null,
      role: null,
      isServiceRole: true,
      workspaceId: null,
    },
  });

  assertThrows(() => requireCaller(ctx), Error, "SERVICE_WORKSPACE_UNBOUND");
});
