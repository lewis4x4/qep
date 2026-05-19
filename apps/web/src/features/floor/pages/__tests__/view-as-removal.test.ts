import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("SC-1 view_as removal", () => {
  test("TopBar and FloorPage no longer contain view_as query behavior", () => {
    const topBarSource = readFileSync(
      join(import.meta.dir, "../../../../components/TopBar.tsx"),
      "utf8",
    );
    const floorPageSource = readFileSync(
      join(import.meta.dir, "../FloorPage.tsx"),
      "utf8",
    );

    expect(topBarSource.includes("view_as")).toBe(false);
    expect(floorPageSource.includes("view_as")).toBe(false);
  });
});
