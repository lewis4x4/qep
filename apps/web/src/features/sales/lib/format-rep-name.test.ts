import { describe, expect, test } from "bun:test";
import { formatRepFirstName } from "./format-rep-name";

describe("formatRepFirstName", () => {
  test("uses first word of full name", () => {
    expect(formatRepFirstName({ full_name: "Brian Lewis", email: null })).toBe(
      "Brian",
    );
  });

  test("suppresses 'Sales' placeholder and falls back to email", () => {
    expect(
      formatRepFirstName({ full_name: "Sales", email: "brian@qep.com" }),
    ).toBe("Brian");
  });

  test("suppresses 'Demo' placeholder and falls back to email", () => {
    expect(
      formatRepFirstName({ full_name: "Demo User", email: "jane.doe@x.com" }),
    ).toBe("Jane");
  });

  test("returns null when both name and email are placeholders", () => {
    expect(
      formatRepFirstName({ full_name: "Admin", email: "support@qep.com" }),
    ).toBeNull();
  });

  test("returns null when nothing usable", () => {
    expect(formatRepFirstName({ full_name: null, email: null })).toBeNull();
  });

  test("handles email-only profile", () => {
    expect(
      formatRepFirstName({ full_name: null, email: "alex.morgan@qep.com" }),
    ).toBe("Alex");
  });

  test("is case-insensitive on placeholder detection", () => {
    expect(
      formatRepFirstName({ full_name: "SALES", email: "brian@qep.com" }),
    ).toBe("Brian");
  });
});
