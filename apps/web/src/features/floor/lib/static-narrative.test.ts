import { describe, expect, test } from "bun:test";
import { buildStaticNarrative, isNarrativeRelevantForRole } from "./static-narrative";

describe("floor narrative role policy", () => {
  test("keeps advisor fallback sales-owned", () => {
    expect(buildStaticNarrative("iron_advisor", "Sam")).toBe(
      "Sam, today's selling motion is ordered by the next action most likely to move a deal.",
    );
  });

  test("rejects ops-heavy cached narratives for advisors", () => {
    expect(
      isNarrativeRelevantForRole(
        "iron_advisor",
        "3,552 parts at critical stockout with $79K in dead capital sitting on the shelf before 2 service tickets stall.",
      ),
    ).toBe(false);
  });

  test("allows sales-owned cached narratives for advisors", () => {
    expect(
      isNarrativeRelevantForRole(
        "iron_advisor",
        "4 active quotes, 3 follow-ups, and 2 open deals are staged for the next sales move.",
      ),
    ).toBe(true);
  });

  test("does not block parts language for parts manager narratives", () => {
    expect(
      isNarrativeRelevantForRole(
        "iron_parts_manager",
        "14 open parts orders are visible with demand, inventory, and supplier health below.",
      ),
    ).toBe(true);
  });
});
