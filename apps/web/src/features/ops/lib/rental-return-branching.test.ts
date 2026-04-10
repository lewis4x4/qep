import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RETURN_CHECKLIST,
  computeDamageAssessment,
  inspectionComplete,
  normalizeReturnChecklist,
  refundMethodMatchesOriginal,
  updateReturnChecklistItem,
} from "./rental-return-branching";

describe("rental-return-branching helpers", () => {
  test("falls back to the default return checklist", () => {
    expect(normalizeReturnChecklist(null)).toEqual(DEFAULT_RETURN_CHECKLIST);
  });

  test("updates a checklist item by label", () => {
    const updated = updateReturnChecklistItem(DEFAULT_RETURN_CHECKLIST, "Inspect exterior condition", true);
    expect(updated[0].completed).toBe(true);
  });

  test("inspection completion requires all checklist items and at least one photo", () => {
    const completeChecklist = DEFAULT_RETURN_CHECKLIST.map((item) => ({ ...item, completed: true }));
    expect(inspectionComplete(completeChecklist, 1)).toBe(true);
    expect(inspectionComplete(completeChecklist, 0)).toBe(false);
  });

  test("computes deposit coverage and balance due", () => {
    expect(computeDamageAssessment(900, 1000)).toEqual({
      depositCoversCharges: true,
      balanceDue: 0,
    });
    expect(computeDamageAssessment(1400, 1000)).toEqual({
      depositCoversCharges: false,
      balanceDue: 400,
    });
  });

  test("refund method must match original payment method", () => {
    expect(refundMethodMatchesOriginal("credit_card", "credit_card")).toBe(true);
    expect(refundMethodMatchesOriginal("credit_card", "check")).toBe(false);
  });
});
