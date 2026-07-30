import { assert, assertGreater } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("admin client is initialized before workspace resolution", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const adminClientIndex = source.indexOf("const adminClient = createClient");
  const workspaceIndex = source.indexOf("resolveProfileActiveWorkspaceId(adminClient, userId)");

  assertGreater(adminClientIndex, -1);
  assertGreater(workspaceIndex, -1);
  assert(
    adminClientIndex < workspaceIndex,
    "voice-to-parts-order must create adminClient before resolving the active workspace",
  );
});
