import { describe, expect, test } from "bun:test";
import { resolveNotFoundHomeLabel } from "../src/lib/not-found-home-label";

describe("resolveNotFoundHomeLabel", () => {
  test("matches known role homes", () => {
    expect(resolveNotFoundHomeLabel("/floor")).toBe("Back to the floor");
    expect(resolveNotFoundHomeLabel("/dashboard")).toBe("Back to Dashboard");
    expect(resolveNotFoundHomeLabel("/qrm")).toBe("Back to QRM");
    expect(resolveNotFoundHomeLabel("/sales/today")).toBe("Back to sales");
  });

  test("falls back to a neutral label for other homes", () => {
    expect(resolveNotFoundHomeLabel("/owner")).toBe("Back to owner");
    expect(resolveNotFoundHomeLabel("/parts/companion/queue")).toBe("Back to parts");
    expect(resolveNotFoundHomeLabel("/nervous-system")).toBe("Back home");
  });
});
