import { describe, expect, it } from "bun:test";
import {
  emptyRentalAssessment,
  RENTAL_ASSESSMENT_FIELDS,
  rentalAssessmentMissing,
} from "./rental-needs-assessment";
describe("rental inquiry qualification", () => {
  it("does not infer an assessment from an empty object", () =>
    expect(rentalAssessmentMissing({}).length).toBeGreaterThan(24));
  it("allows honest unknown/non-applicable answers except the confirmed quote prerequisites", () => {
    const a = emptyRentalAssessment();
    for (const [key] of RENTAL_ASSESSMENT_FIELDS) {
      a.answers[key] = { status: "unknown", value: "" };
    }
    for (const key of ["equipment_type", "duration", "delivery"]) {
      a.answers[key] = { status: "answered", value: "confirmed" };
    }
    a.answers.delivery = { status: "answered", value: "self_haul" };
    a.reviewed = true;
    expect(rentalAssessmentMissing(a)).toEqual([]);
    a.answers.delivery = { status: "unknown", value: "" };
    expect(rentalAssessmentMissing(a)).toContain(
      "Confirm delivery before quoting",
    );
  });
  it("does not accept unanswered fields, unchecked review or malformed answer values", () => {
    const a = emptyRentalAssessment();
    for (const [key] of RENTAL_ASSESSMENT_FIELDS) {
      a.answers[key] = { status: "answered", value: "answer" };
    }
    expect(rentalAssessmentMissing(a)).toContain(
      "Advisor review of all five categories",
    );
    a.reviewed = true;
    a.answers.email.value = "";
    expect(rentalAssessmentMissing(a)).toContain("Email");
    expect(() =>
      rentalAssessmentMissing({
        answers: { equipment_type: { status: "answered", value: 42 } },
      })
    ).not.toThrow();
  });
});
