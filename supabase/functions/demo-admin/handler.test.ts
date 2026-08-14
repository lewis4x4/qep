import { assertEquals } from "jsr:@std/assert@1";
import {
  handleDemoAdminRequest,
  LIVE_DISABLED_RESET_MESSAGE,
  LIVE_DISABLED_SEED_MESSAGE,
} from "./handler.ts";

const DEMO_ADMIN_SECRET = "demo-admin-test-secret";

function jsonRequest(
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Request {
  return new Request("https://example.test/functions/v1/demo-admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function handlerDeps(overrides: Partial<{ demoAdminSecret: string | undefined }> = {}) {
  return {
    demoAdminSecret: DEMO_ADMIN_SECRET,
    captureException: () => {},
    ...overrides,
  };
}

Deno.test("reset is refused on live with 410 before any mutation path", async () => {
  const response = await handleDemoAdminRequest(
    jsonRequest({ action: "reset" }, { "x-demo-admin-secret": DEMO_ADMIN_SECRET }),
    handlerDeps(),
  );

  assertEquals(response.status, 410);
  const payload = await response.json();
  assertEquals(payload.error, LIVE_DISABLED_RESET_MESSAGE);
});

Deno.test("seed stays disabled on live with 410", async () => {
  const response = await handleDemoAdminRequest(
    jsonRequest({ action: "seed" }, { "x-demo-admin-secret": DEMO_ADMIN_SECRET }),
    handlerDeps(),
  );

  assertEquals(response.status, 410);
  const payload = await response.json();
  assertEquals(payload.error, LIVE_DISABLED_SEED_MESSAGE);
});

Deno.test("default action remains seed and stays disabled on live", async () => {
  const response = await handleDemoAdminRequest(
    jsonRequest({}, { "x-demo-admin-secret": DEMO_ADMIN_SECRET }),
    handlerDeps(),
  );

  assertEquals(response.status, 410);
  const payload = await response.json();
  assertEquals(payload.error, LIVE_DISABLED_SEED_MESSAGE);
});

Deno.test("missing secret returns 401", async () => {
  const response = await handleDemoAdminRequest(
    jsonRequest({ action: "reset" }),
    handlerDeps(),
  );

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "Unauthorized");
});

Deno.test("wrong secret returns 401", async () => {
  const response = await handleDemoAdminRequest(
    jsonRequest({ action: "reset" }, { "x-demo-admin-secret": "wrong-secret" }),
    handlerDeps(),
  );

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "Unauthorized");
});

const LIVE_ENTRY_FILES = ["./handler.ts", "./index.ts"] as const;

Deno.test("live entry files never reference voice_captures purge/delete paths", async () => {
  for (const file of LIVE_ENTRY_FILES) {
    const source = await Deno.readTextFile(new URL(file, import.meta.url));
    assertEquals(source.includes("voice_captures"), false, file);
    assertEquals(source.includes("purgeVoiceCaptures"), false, file);
    assertEquals(source.includes('.from("voice_captures")'), false, file);
  }
});
