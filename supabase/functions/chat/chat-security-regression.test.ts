import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("chat tool calls execute with caller-scoped client, not service-role admin client", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  assert(
    source.includes("const callerClient = createCallerClient(caller.authHeader);"),
    "chat must construct an RLS-scoped caller client",
  );
  assert(
    source.includes("executeToolCalls(callerClient, result.toolCalls, traceId)"),
    "chat tools must run through callerClient so RLS and workspace policies apply",
  );
  assertEquals(
    source.includes("executeToolCalls(adminClient, result.toolCalls, traceId)"),
    false,
    "chat tools must not run through the service-role admin client",
  );
});
