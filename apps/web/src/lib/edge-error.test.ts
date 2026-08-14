import { describe, expect, test } from "bun:test";
import { sanitizeClientError } from "./edge-error";

describe("sanitizeClientError", () => {
  const fallback = "Vendor metrics unavailable.";

  test("replaces permission denied for table vendor_profiles", () => {
    expect(
      sanitizeClientError(
        new Error("permission denied for table vendor_profiles"),
        fallback,
      ),
    ).toBe(fallback);
  });

  test("replaces RLS and PostgREST signatures", () => {
    expect(sanitizeClientError({ message: "new row violates row-level security policy" }, fallback)).toBe(
      fallback,
    );
    expect(sanitizeClientError({ message: "PGRST301 JWT expired" }, fallback)).toBe(fallback);
  });

  test("returns fallback for nullish errors", () => {
    expect(sanitizeClientError(null, fallback)).toBe(fallback);
    expect(sanitizeClientError(undefined, fallback)).toBe(fallback);
  });
});
