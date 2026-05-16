import { describe, expect, test } from "bun:test";

import {
  dateInputValue,
  dateTimeInputValue,
  isoFromDateInput,
  isoFromDateTimeInput,
} from "../quote-date-input";

describe("quote-date-input", () => {
  test("dateInputValue formats UTC ISO to local date input", () => {
    const value = dateInputValue("2026-06-15T18:30:00.000Z");
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("isoFromDateInput returns noon-local ISO or null", () => {
    expect(isoFromDateInput("")).toBeNull();
    expect(isoFromDateInput("2026-06-15")).toMatch(/^2026-06-15T/);
  });

  test("dateTimeInputValue and isoFromDateTimeInput round-trip", () => {
    const iso = "2026-06-15T14:30:00.000Z";
    const input = dateTimeInputValue(iso);
    expect(input).toContain("T");
    const back = isoFromDateTimeInput(input);
    expect(back).toBeTruthy();
    expect(new Date(back!).getTime()).toBe(new Date(iso).getTime());
  });
});
