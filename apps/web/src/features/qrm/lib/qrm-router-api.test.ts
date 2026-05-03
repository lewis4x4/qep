import { describe, expect, it } from "bun:test";
import {
  normalizeRouterErrorPayload,
  readRouterJsonPayload,
  requireRouterArrayPayload,
  requireRouterObjectPayload,
} from "./qrm-router-api";

describe("qrm router api response normalizers", () => {
  it("preserves valid object payloads and extracts typed object/array containers", async () => {
    const payload = await readRouterJsonPayload(
      new Response(JSON.stringify({
        results: [{ id: "contact-1", label: "Ava Fields" }],
        activity: { id: "activity-1", body: "Call customer" },
      })),
      "test route",
    );

    expect(requireRouterArrayPayload(payload, "results")).toEqual([
      { id: "contact-1", label: "Ava Fields" },
    ]);
    expect(requireRouterObjectPayload(payload, "activity")).toEqual({
      id: "activity-1",
      body: "Call customer",
    });
  });

  it("normalizes edge error envelopes without trusting malformed fields", () => {
    expect(normalizeRouterErrorPayload({
      error: {
        code: "bad_request",
        message: "Invalid customer",
        details: { field: "customer_id" },
      },
    })).toEqual({
      code: "bad_request",
      message: "Invalid customer",
      details: { field: "customer_id" },
    });

    expect(normalizeRouterErrorPayload({ error: "bad" })).toBeNull();
  });

  it("fails safely on malformed JSON and unexpected container shapes", async () => {
    await expect(readRouterJsonPayload(new Response("{bad"), "test route"))
      .rejects.toThrow("test route returned malformed JSON.");
    await expect(readRouterJsonPayload(new Response("[]"), "test route"))
      .rejects.toThrow("test route returned an invalid JSON payload.");

    expect(() => requireRouterArrayPayload({ results: {} }, "results"))
      .toThrow("QRM router response is missing a valid 'results' array.");
    expect(() => requireRouterObjectPayload({ activity: [] }, "activity"))
      .toThrow("QRM router response is missing a valid 'activity' object.");
  });
});
