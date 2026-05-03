import { describe, expect, test } from "bun:test";

import { firstMutationErrorMessage } from "../quote-review-workflow-normalizers";

describe("quote review workflow normalizers", () => {
  test("returns the first meaningful mutation error message", () => {
    expect(firstMutationErrorMessage([
      null,
      new Error("Save draft failed"),
      new Error("Publish failed"),
    ])).toBe("Save draft failed");
  });

  test("normalizes string and message-like unknown errors", () => {
    expect(firstMutationErrorMessage([undefined, "  Submit failed  "])).toBe("Submit failed");
    expect(firstMutationErrorMessage([{ message: "Return failed" }])).toBe("Return failed");
  });

  test("falls back for unknown truthy errors and returns null when none exist", () => {
    expect(firstMutationErrorMessage([false, { code: "bad" }], "Portal revision action failed"))
      .toBe("Portal revision action failed");
    expect(firstMutationErrorMessage([null, undefined, ""])).toBeNull();
  });
});
