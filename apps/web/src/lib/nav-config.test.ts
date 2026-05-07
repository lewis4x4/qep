import { describe, expect, test } from "bun:test";

import { resolveActivePrimaryHeader } from "./nav-config";

describe("nav-config", () => {
  test("keeps voice quote under the Sales chrome", () => {
    expect(resolveActivePrimaryHeader("/voice-quote")).toBe("sales");
  });
});
