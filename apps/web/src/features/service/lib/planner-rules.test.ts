import { describe, expect, test } from "bun:test";
import { normalizePlannerRules } from "./planner-rules";

describe("normalizePlannerRules", () => {
  test("accepts empty object", () => {
    const r = normalizePlannerRules({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  test("coerces valid numeric keys", () => {
    const r = normalizePlannerRules({
      transfer_default_lead_hours: "12",
      transfer_vs_order_slack_hours: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.transfer_default_lead_hours).toBe(12);
      expect(r.value.transfer_vs_order_slack_hours).toBe(2);
    }
  });

  test("rejects non-object", () => {
    expect(normalizePlannerRules([]).ok).toBe(false);
    expect(normalizePlannerRules("x").ok).toBe(false);
  });

  test("rejects bad numbers", () => {
    const r = normalizePlannerRules({ transfer_default_lead_hours: NaN });
    expect(r.ok).toBe(false);
  });
});
