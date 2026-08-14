import { assertEquals } from "jsr:@std/assert@1";
import type { CallerContext } from "../_shared/dge-auth.ts";
import { resolveCallerContext } from "../_shared/dge-auth.ts";
import {
  handleRunRequest,
  resolveDocumentPlaysRunWorkspace,
  type RunPlaysService,
} from "./handler.ts";

const originalServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const originalInternalSecret = Deno.env.get("INTERNAL_SERVICE_SECRET");
const originalDgeInternalSecret = Deno.env.get("DGE_INTERNAL_SERVICE_SECRET");
const SERVICE_KEY = "sb_secret_document_plays_run_test_only";
const WORKSPACE_A = "workspace-shop-a";
const WORKSPACE_B = "workspace-shop-b";

Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.delete("INTERNAL_SERVICE_SECRET");
Deno.env.delete("DGE_INTERNAL_SERVICE_SECRET");

function request(
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/document-plays-run/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function callerContext(
  overrides: Partial<CallerContext> = {},
): CallerContext {
  return {
    authHeader: "Bearer owner-token",
    userId: "user-owner-1",
    role: "owner",
    isServiceRole: false,
    workspaceId: WORKSPACE_A,
    ...overrides,
  };
}

function mockService(calls: RunPlaysInputCapture[]): RunPlaysService {
  return {
    run: async (input) => {
      calls.push(input);
      return {
        batchId: "batch-1",
        workspaceId: input.workspaceId,
        documentId: input.documentId,
        plays: [],
        expiredCount: 0,
        fulfilledCount: 0,
        exceptionsPushed: 0,
      };
    },
  };
}

type RunPlaysInputCapture = {
  documentId: string | null;
  workspaceId: string | null;
};

function dependencies(params: {
  caller?: CallerContext;
  serviceCalls?: RunPlaysInputCapture[];
} = {}) {
  const serviceCalls = params.serviceCalls ?? [];
  return {
    service: mockService(serviceCalls),
    deps: {
      createAdminClient: (() => ({ kind: "admin-client" })) as never,
      resolveCallerContext:
        (async () => params.caller ?? callerContext()) as never,
    },
  };
}

Deno.test("resolveDocumentPlaysRunWorkspace ignores forged workspace for JWT callers", () => {
  assertEquals(
    resolveDocumentPlaysRunWorkspace({
      isServiceRole: false,
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, workspaceId: WORKSPACE_A },
  );
});

Deno.test("resolveDocumentPlaysRunWorkspace fails closed when JWT caller has no workspace", () => {
  const result = resolveDocumentPlaysRunWorkspace({
    isServiceRole: false,
    callerWorkspaceId: null,
    requestedWorkspaceId: WORKSPACE_B,
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 403);
    assertEquals(result.code, "FORBIDDEN");
  }
});

Deno.test("resolveDocumentPlaysRunWorkspace allows service-role callers to target body workspace", () => {
  assertEquals(
    resolveDocumentPlaysRunWorkspace({
      isServiceRole: true,
      callerWorkspaceId: null,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, workspaceId: WORKSPACE_B },
  );
});

Deno.test("resolveDocumentPlaysRunWorkspace prefers x-workspace-id for service-role callers", () => {
  assertEquals(
    resolveDocumentPlaysRunWorkspace({
      isServiceRole: true,
      callerWorkspaceId: WORKSPACE_A,
      requestedWorkspaceId: WORKSPACE_B,
    }),
    { ok: true, workspaceId: WORKSPACE_A },
  );
});

Deno.test("JWT caller with forged body.workspaceId runs plays in profile workspace only", async () => {
  const serviceCalls: RunPlaysInputCapture[] = [];
  const { service, deps } = dependencies({ serviceCalls });
  const response = await handleRunRequest(
    request({ workspaceId: WORKSPACE_B }),
    service,
    deps,
  );

  assertEquals(response.status, 200);
  assertEquals(serviceCalls.length, 1);
  assertEquals(serviceCalls[0].workspaceId, WORKSPACE_A);
});

Deno.test("JWT caller without an active workspace returns 403 without running plays", async () => {
  const serviceCalls: RunPlaysInputCapture[] = [];
  const { service, deps } = dependencies({
    serviceCalls,
    caller: callerContext({ workspaceId: null }),
  });
  const response = await handleRunRequest(
    request({ workspaceId: WORKSPACE_B }),
    service,
    deps,
  );
  const body = await response.json();

  assertEquals(response.status, 403);
  assertEquals(body.error.code, "FORBIDDEN");
  assertEquals(serviceCalls.length, 0);
});

Deno.test("missing JWT auth returns 401 without running plays", async () => {
  const serviceCalls: RunPlaysInputCapture[] = [];
  const { service, deps } = dependencies({
    serviceCalls,
    caller: callerContext({
      authHeader: null,
      userId: null,
      role: null,
      workspaceId: null,
    }),
  });
  const response = await handleRunRequest(
    request({ workspaceId: WORKSPACE_A }),
    service,
    deps,
  );
  const body = await response.json();

  assertEquals(response.status, 401);
  assertEquals(body.error.code, "UNAUTHORIZED");
  assertEquals(serviceCalls.length, 0);
});

Deno.test("service-role caller honors explicit body workspace", async () => {
  const serviceCalls: RunPlaysInputCapture[] = [];
  const response = await handleRunRequest(
    request(
      { workspaceId: WORKSPACE_B },
      { Authorization: `Bearer ${SERVICE_KEY}` },
    ),
    mockService(serviceCalls),
    {
      createAdminClient: (() => ({ kind: "admin-client" })) as never,
      resolveCallerContext,
    },
  );

  assertEquals(response.status, 200);
  assertEquals(serviceCalls.length, 1);
  assertEquals(serviceCalls[0].workspaceId, WORKSPACE_B);
});

Deno.test("service-role caller honors x-workspace-id header", async () => {
  const serviceCalls: RunPlaysInputCapture[] = [];
  const response = await handleRunRequest(
    request({}, { apikey: SERVICE_KEY, "x-workspace-id": WORKSPACE_B }),
    mockService(serviceCalls),
    {
      createAdminClient: (() => ({ kind: "admin-client" })) as never,
      resolveCallerContext,
    },
  );

  assertEquals(response.status, 200);
  assertEquals(serviceCalls.length, 1);
  assertEquals(serviceCalls[0].workspaceId, WORKSPACE_B);
});

Deno.test({
  name: "document-plays-run handler env cleanup",
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
