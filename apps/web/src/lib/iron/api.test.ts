/**
 * Regression: the FunctionsClient.invoke method on @supabase/functions-js
 * dereferences `this.region` internally. If we ever destructure `invoke`
 * off the receiver and call it as a free function, Safari throws
 * "undefined is not an object (evaluating 'this.region')" and every Iron
 * call dies silently. These tests pin the live-receiver call shape so we
 * never re-introduce that bug.
 */
import { describe, expect, mock, test } from "bun:test";

// Build a fake FunctionsClient whose `invoke` reads `this.region` exactly
// like the real @supabase/functions-js client does. If our wrapper calls
// it without `this` bound, the test fails the same way Safari did.
class FakeFunctionsClient {
  region: string;
  lastCall: {
    name: string;
    body: unknown;
    headers?: Record<string, string>;
  } | null = null;

  constructor(region: string) {
    this.region = region;
  }

  async invoke<T>(
    name: string,
    opts: { body: unknown; headers?: Record<string, string> },
  ): Promise<{ data: T | null; error: { message?: string } | null }> {
    // This is the line that crashes in Safari when `this` is undefined.
    // Touching it is the whole point of the test.
    void this.region;
    this.lastCall = { name, body: opts.body, headers: opts.headers };
    return { data: ({ ok: true, echo: opts.body } as unknown) as T, error: null };
  }
}

const fakeClient = new FakeFunctionsClient("us-east-1");

// Every iron call now resolves the session explicitly and passes the JWT
// in the invoke-level headers override. The test mock has to provide a
// session with expires_at in the future or every call would correctly
// fail with "not signed in".
const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
const fakeAuth = {
  getSession: async () => ({
    data: {
      session: {
        access_token: "fake-user-jwt-with-sub-claim",
        expires_at: futureExpiry,
      },
    },
    error: null,
  }),
  refreshSession: async () => ({
    data: { session: { access_token: "fresh-after-refresh" } },
    error: null,
  }),
};

mock.module("@/lib/supabase", () => ({
  supabase: { functions: fakeClient, auth: fakeAuth },
}));

const { ironOrchestrate, ironExecuteFlowStep, ironUndoFlowRun } = await import("./api");

describe("iron api - this.region binding", () => {
  test("ironOrchestrate keeps `this` bound to FunctionsClient + sends JWT header", async () => {
    const res = await ironOrchestrate({ text: "pull part 4521 for Anderson" });
    expect(res).toBeDefined();
    expect(fakeClient.lastCall?.name).toBe("iron-orchestrator");
    expect((fakeClient.lastCall?.body as { text: string }).text).toBe(
      "pull part 4521 for Anderson",
    );
    // Critical: the explicit Authorization header overrides supabase-js's
    // anon-key fallback. If this assertion fails, the function will receive
    // the anon key and reject every call as "Invalid JWT".
    expect(fakeClient.lastCall?.headers?.Authorization).toBe(
      "Bearer fake-user-jwt-with-sub-claim",
    );
  });

  test("ironExecuteFlowStep keeps `this` bound to FunctionsClient", async () => {
    const res = await ironExecuteFlowStep({
      flow_id: "pull_part",
      conversation_id: "conv-1",
      idempotency_key: "key-1",
      slots: { part_number: "4521" },
    });
    expect(res).toBeDefined();
    expect(fakeClient.lastCall?.name).toBe("iron-execute-flow-step");
  });

  test("ironUndoFlowRun keeps `this` bound to FunctionsClient", async () => {
    const res = await ironUndoFlowRun({ run_id: "run-1" });
    expect(res).toBeDefined();
    expect(fakeClient.lastCall?.name).toBe("iron-undo-flow-run");
  });

  test("calling invoke without `this` reproduces the original Safari error", async () => {
    // Sanity check: if someone reverts to the buggy destructure pattern,
    // this is exactly the error they will see in production. The negative
    // test guards the assertion above by proving the fake actually throws.
    const detached = fakeClient.invoke;
    let caught: unknown = null;
    try {
      await detached("anything", { body: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TypeError);
  });
});

describe("iron api - explainInvokeError extracts real error body", () => {
  // A second fake that always returns an error with a Response in `context`,
  // mimicking @supabase/functions-js's FunctionsHttpError. The wrapper must
  // unwrap it instead of falling back to the SDK's generic message.
  class FakeFailingClient {
    region = "us-east-1";
    async invoke<T>(
      _name: string,
      _opts: { body: unknown },
    ): Promise<{ data: T | null; error: { message: string; context: Response } }> {
      const ctx = new Response(
        JSON.stringify({ error: "Unauthorized: invalid JWT signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return {
        data: null,
        error: {
          message: "Edge Function returned a non-2xx status code",
          context: ctx,
        },
      };
    }
  }

  test("ironOrchestrate surfaces the real function error message + status", async () => {
    const failing = new FakeFailingClient();
    mock.module("@/lib/supabase", () => ({
      supabase: {
        functions: failing,
        auth: {
          getSession: async () => ({
            data: { session: { access_token: "fake-user-jwt-with-sub-claim" } },
            error: null,
          }),
        },
      },
    }));
    const { ironOrchestrate: orch } = await import("./api?failing");
    let caught: Error | null = null;
    try {
      await orch({ text: "anything" });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain("Unauthorized: invalid JWT signature");
    expect(caught?.message).toContain("401");
    expect(caught?.message).toContain("iron-orchestrator");
  });

  test("invokeIron throws 'not signed in' when session is missing", async () => {
    mock.module("@/lib/supabase", () => ({
      supabase: {
        functions: new FakeFunctionsClient("us-east-1"),
        auth: {
          getSession: async () => ({
            data: { session: null },
            error: null,
          }),
          refreshSession: async () => ({
            data: { session: null },
            error: null,
          }),
        },
      },
    }));
    const { ironOrchestrate: orch } = await import("./api?nosession");
    let caught: Error | null = null;
    try {
      await orch({ text: "anything" });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain("not signed in");
  });

  test("invokeIron auto-refreshes an expired access token before calling the function", async () => {
    const refreshClient = new FakeFunctionsClient("us-east-1");
    const expiredAt = Math.floor(Date.now() / 1000) - 60; // expired 60s ago
    let refreshCalled = false;
    mock.module("@/lib/supabase", () => ({
      supabase: {
        functions: refreshClient,
        auth: {
          getSession: async () => ({
            data: {
              session: {
                access_token: "stale-expired-token",
                expires_at: expiredAt,
              },
            },
            error: null,
          }),
          refreshSession: async () => {
            refreshCalled = true;
            return {
              data: {
                session: { access_token: "freshly-refreshed-token" },
              },
              error: null,
            };
          },
        },
      },
    }));
    const { ironOrchestrate: orch } = await import("./api?expired");
    await orch({ text: "test" });
    expect(refreshCalled).toBe(true);
    expect(refreshClient.lastCall?.headers?.Authorization).toBe(
      "Bearer freshly-refreshed-token",
    );
  });

  test("invokeIron throws when refresh itself fails", async () => {
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    mock.module("@/lib/supabase", () => ({
      supabase: {
        functions: new FakeFunctionsClient("us-east-1"),
        auth: {
          getSession: async () => ({
            data: {
              session: {
                access_token: "stale-expired-token",
                expires_at: expiredAt,
              },
            },
            error: null,
          }),
          refreshSession: async () => ({
            data: { session: null },
            error: { message: "refresh_token revoked" },
          }),
        },
      },
    }));
    const { ironOrchestrate: orch } = await import("./api?refreshfail");
    let caught: Error | null = null;
    try {
      await orch({ text: "test" });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain("session expired and refresh failed");
  });
});
