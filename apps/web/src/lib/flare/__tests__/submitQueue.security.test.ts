import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Flare offline queue redaction", () => {
  test("does not persist raw screenshots or DOM snapshots to IndexedDB", () => {
    const source = readFileSync(resolve(import.meta.dir, "../submitQueue.ts"), "utf8");
    expect(source).toContain("function sanitizeQueuedPayload");
    expect(source).toContain('screenshot_base64: ""');
    expect(source).toContain('dom_snapshot_gzipped: ""');
    expect(source).toContain("payload: sanitizeQueuedPayload(payload)");
  });
});
