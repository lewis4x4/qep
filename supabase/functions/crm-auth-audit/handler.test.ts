import { createClient } from "jsr:@supabase/supabase-js@2";
import type { CrmAuditClient } from "../_shared/crm-auth-audit.ts";
import { assertEquals } from "jsr:@std/assert@1";
import { handleCrmAuthAuditRequest } from "./handler.ts";

class MockAdminClient {
  calls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  rpc: CrmAuditClient["rpc"];
  constructor() {
    // Real PostgREST RPC builder with an isolated transport. No network is used.
    const client = createClient("https://audit-test.invalid", "test-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const body = (init as { body?: unknown } | undefined)?.body;
        this.calls.push({ fn: url.pathname.split("/").at(-1)!, args: typeof body === "string" ? JSON.parse(body) : {} });
        return Promise.resolve(Response.json(null));
      } },
    });
    this.rpc = client.rpc.bind(client);
  }
}

function jsonRequest(body: Record<string, unknown>, headers: HeadersInit = {}): Request {
  return new Request("https://example.supabase.co/functions/v1/crm-auth-audit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("logs login_failure with a hashed email hint", async () => {
  const admin = new MockAdminClient();
  const response = await handleCrmAuthAuditRequest(
    jsonRequest({
      eventType: "login_failure",
      email: "Rep@QepUSA.com",
      resource: "/login/password",
      metadata: { auth_method: "password" },
    }),
    {
      admin,
      actorUserId: null,
      requestIdFactory: () => "req-login-failure",
    },
  );

  assertEquals(response.status, 200);
  assertEquals(admin.calls.length, 1);
  const args = admin.calls[0]?.args;
  assertEquals(args.p_event_type, "login_failure");
  assertEquals(args.p_outcome, "failure");
  assertEquals(args.p_request_id, "req-login-failure");
  assertEquals(args.p_resource, "/login/password");
  assertEquals(
    (args.p_metadata as Record<string, unknown>).subject_email_hash,
    "7e08506d32a3f7d3e4c856a9dd68b5f9ebb2034c647543325da6e516437a3d64",
  );
});

Deno.test("logs login_success for an authenticated session", async () => {
  const admin = new MockAdminClient();
  const response = await handleCrmAuthAuditRequest(
    jsonRequest(
      {
        eventType: "login_success",
        resource: "/auth/session",
        metadata: { source_event: "SIGNED_IN" },
      },
      {
        Authorization: "Bearer access-token",
        "x-forwarded-for": "203.0.113.42, 10.0.0.1",
        "user-agent": "QEP Test Agent",
      },
    ),
    {
      admin,
      actorUserId: "user-123",
      requestIdFactory: () => "req-login-success",
    },
  );

  assertEquals(response.status, 200);
  const args = admin.calls[0]?.args;
  assertEquals(args.p_event_type, "login_success");
  assertEquals(args.p_outcome, "success");
  assertEquals(args.p_actor_user_id, "user-123");
  assertEquals(args.p_subject_user_id, "user-123");
  assertEquals(args.p_ip_inet, "203.0.113.42");
  assertEquals(args.p_user_agent, "QEP Test Agent");
});

Deno.test("logs logout for an authenticated session", async () => {
  const admin = new MockAdminClient();
  const response = await handleCrmAuthAuditRequest(
    jsonRequest(
      {
        eventType: "logout",
        resource: "/auth/logout",
        metadata: { initiated_by: "user" },
      },
      { Authorization: "Bearer logout-token" },
    ),
    {
      admin,
      actorUserId: "user-logout",
      requestIdFactory: () => "req-logout",
    },
  );

  assertEquals(response.status, 200);
  assertEquals(admin.calls[0]?.args.p_event_type, "logout");
  assertEquals(admin.calls[0]?.args.p_actor_user_id, "user-logout");
});

Deno.test("logs token_refresh for an authenticated session", async () => {
  const admin = new MockAdminClient();
  const response = await handleCrmAuthAuditRequest(
    jsonRequest(
      {
        eventType: "token_refresh",
        resource: "/auth/token-refresh",
        metadata: { source_event: "TOKEN_REFRESHED" },
      },
      { Authorization: "Bearer refresh-token" },
    ),
    {
      admin,
      actorUserId: "user-refresh",
      requestIdFactory: () => "req-refresh",
    },
  );

  assertEquals(response.status, 200);
  assertEquals(admin.calls[0]?.args.p_event_type, "token_refresh");
  assertEquals(admin.calls[0]?.args.p_actor_user_id, "user-refresh");
});

Deno.test("logs password_reset_request with a hashed email hint", async () => {
  const admin = new MockAdminClient();
  const response = await handleCrmAuthAuditRequest(
    jsonRequest({
      eventType: "password_reset_request",
      email: "reset@qepusa.com",
      resource: "/auth/password-reset/request",
      metadata: { source: "forgot-password-dialog" },
    }),
    {
      admin,
      actorUserId: null,
      requestIdFactory: () => "req-reset-request",
    },
  );

  assertEquals(response.status, 200);
  assertEquals(admin.calls[0]?.args.p_event_type, "password_reset_request");
  assertEquals(
    typeof (admin.calls[0]?.args.p_metadata as Record<string, unknown>).subject_email_hash,
    "string",
  );
});

Deno.test("logs password_reset_complete for an authenticated session", async () => {
  const admin = new MockAdminClient();
  const response = await handleCrmAuthAuditRequest(
    jsonRequest(
      {
        eventType: "password_reset_complete",
        resource: "/auth/password-reset/complete",
        metadata: { source: "recovery-dialog" },
      },
      { Authorization: "Bearer recovery-token" },
    ),
    {
      admin,
      actorUserId: "user-recovery",
      requestIdFactory: () => "req-reset-complete",
    },
  );

  assertEquals(response.status, 200);
  assertEquals(admin.calls[0]?.args.p_event_type, "password_reset_complete");
  assertEquals(admin.calls[0]?.args.p_actor_user_id, "user-recovery");
});


Deno.test("authenticated lifecycle audit cannot trust an arbitrary request bearer header", async () => {
  const admin = new MockAdminClient();
  const response = await handleCrmAuthAuditRequest(
    jsonRequest({ eventType: "login_success" }, { Authorization: "Bearer unvalidated-token" }),
    { admin, actorUserId: null },
  );
  assertEquals(response.status, 401);
  assertEquals(admin.calls.length, 0);
});
