import { expect, test } from "bun:test";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { RentalInquiryAssessment } from "./RentalInquiryAssessment";
import {
  emptyRentalAssessment,
  RENTAL_ASSESSMENT_FIELDS,
} from "../../../../../../shared/rental-needs-assessment";
test("all rental questions are represented and changing an answer invalidates advisor review", () => {
  function Harness() {
    const initial = emptyRentalAssessment();
    for (const [key] of RENTAL_ASSESSMENT_FIELDS) {
      initial.answers[key] = { status: "unknown", value: "" };
    }
    initial.reviewed = true;
    const [value, onChange] = useState(initial);
    return <RentalInquiryAssessment value={value} onChange={onChange} />;
  }
  render(<Harness />);
  expect(screen.getAllByRole("combobox", { hidden: true }).length).toBe(28);
  const reviewed = screen.getByRole("checkbox", {
    name: "I reviewed all five categories with the customer",
  }) as HTMLInputElement;
  expect(reviewed.checked).toBe(true);
  fireEvent.change(screen.getByLabelText("Equipment type"), {
    target: { value: "Mini excavator" },
  });
  expect(reviewed.checked).toBe(false);
  fireEvent.change(screen.getByLabelText("Delivery or customer self-haul"), {
    target: { value: "delivery" },
  });
  expect(
    (screen.getByLabelText(
      "Delivery or customer self-haul",
    ) as HTMLSelectElement).value,
  ).toBe("delivery");
  expect(screen.getByText(/Confirm duration before quoting/)).toBeTruthy();
});
