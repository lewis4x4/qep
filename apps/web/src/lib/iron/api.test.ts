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
  lastCall: { name: string; body: unknown } | null = null;

  constructor(region: string) {
    this.region = region;
  }

  async invoke<T>(
    name: string,
    opts: { body: unknown },
  ): Promise<{ data: T | null; error: { message?: string } | null }> {
    // This is the line that crashes in Safari when `this` is undefined.
    // Touching it is the whole point of the test.
    void this.region;
    this.lastCall = { name, body: opts.body };
    return { data: ({ ok: true, echo: opts.body } as unknown) as T, error: null };
  }
}

const fakeClient = new FakeFunctionsClient("us-east-1");

mock.module("@/lib/supabase", () => ({
  supabase: { functions: fakeClient },
}));

const { ironOrchestrate, ironExecuteFlowStep, ironUndoFlowRun } = await import("./api");

describe("iron api - this.region binding", () => {
  test("ironOrchestrate keeps `this` bound to FunctionsClient", async () => {
    const res = await ironOrchestrate({ text: "pull part 4521 for Anderson" });
    expect(res).toBeDefined();
    expect(fakeClient.lastCall?.name).toBe("iron-orchestrator");
    expect((fakeClient.lastCall?.body as { text: string }).text).toBe(
      "pull part 4521 for Anderson",
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
      supabase: { functions: failing },
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
});
