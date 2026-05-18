import { describe, expect, test } from "bun:test";
import {
  translateQuoteError,
  translateQuoteErrorAsString,
} from "../quote-error-messages";

describe("translateQuoteError", () => {
  test("translates ARCHIVED_REFERENCE_NOT_ALLOWED with recovery hint", () => {
    const copy = translateQuoteError(new Error("ARCHIVED_REFERENCE_NOT_ALLOWED"));
    expect(copy.title).toBe("Linked record is archived");
    expect(copy.description.toLowerCase()).toContain("re-link");
    expect(copy.recoveryHint).toContain("Customer step");
  });

  test("ARCHIVED_REFERENCE_NOT_ALLOWED carries a one-tap recovery action", () => {
    const copy = translateQuoteError(new Error("ARCHIVED_REFERENCE_NOT_ALLOWED"));
    expect(copy.recoveryAction?.kind).toBe("goto_customer_step");
    expect(copy.recoveryAction?.label).toBe("Re-link customer");
  });

  test("ARCHIVED_REFERENCE_NOT_ALLOWED also carries a discard-and-restart escape hatch", () => {
    const copy = translateQuoteError(new Error("ARCHIVED_REFERENCE_NOT_ALLOWED"));
    expect(copy.recoveryFallback?.kind).toBe("discard_and_restart");
    expect(copy.recoveryFallback?.label).toBe("Discard and start over");
  });

  test("other known errors do NOT carry a recovery action", () => {
    expect(
      translateQuoteError(new Error("JWT expired")).recoveryAction,
    ).toBeUndefined();
    expect(
      translateQuoteError(new Error("Failed to fetch")).recoveryAction,
    ).toBeUndefined();
    expect(
      translateQuoteError(new Error("SQLSTATE 23505")).recoveryAction,
    ).toBeUndefined();
  });

  test("matches archived reference inside a longer Postgres message", () => {
    const copy = translateQuoteError(
      new Error("ERROR:  ARCHIVED_REFERENCE_NOT_ALLOWED\nCONTEXT: ..."),
    );
    expect(copy.title).toBe("Linked record is archived");
  });

  test("handles bare string errors", () => {
    const copy = translateQuoteError("ARCHIVED_REFERENCE_NOT_ALLOWED");
    expect(copy.title).toBe("Linked record is archived");
  });

  test("handles error-like objects with message", () => {
    const copy = translateQuoteError({ message: "ARCHIVED_REFERENCE_NOT_ALLOWED" });
    expect(copy.title).toBe("Linked record is archived");
  });

  test("translates duplicate-key (23505) violations", () => {
    const copy = translateQuoteError(
      new Error("duplicate key value violates unique constraint (SQLSTATE 23505)"),
    );
    expect(copy.title).toBe("Duplicate record");
  });

  test("translates FK (23503) violations distinct from archived-ref", () => {
    const copy = translateQuoteError(
      new Error('insert or update violates foreign key constraint "fk_x" (SQLSTATE 23503)'),
    );
    expect(copy.title).toBe("Linked record not found");
  });

  test("does NOT mis-classify archived-ref as generic FK violation", () => {
    const copy = translateQuoteError(
      new Error("foreign key constraint -- ARCHIVED_REFERENCE_NOT_ALLOWED"),
    );
    expect(copy.title).toBe("Linked record is archived");
  });

  test("translates RLS / permission-denied", () => {
    const copy = translateQuoteError(
      new Error("new row violates row-level security policy"),
    );
    expect(copy.title).toBe("Permission denied");
  });

  test("translates JWT expired", () => {
    const copy = translateQuoteError(new Error("JWT expired"));
    expect(copy.title).toBe("Session expired");
  });

  test("translates Failed to fetch", () => {
    const copy = translateQuoteError(new TypeError("Failed to fetch"));
    expect(copy.title).toBe("Connection lost");
  });

  test("falls back to generic title + raw message for unknown errors", () => {
    const copy = translateQuoteError(new Error("Some weird novel error string"));
    expect(copy.title).toBe("Something went wrong");
    expect(copy.description).toBe("Some weird novel error string");
    expect(copy.recoveryHint).toBeUndefined();
  });

  test("handles null / undefined gracefully", () => {
    expect(translateQuoteError(null).title).toBe("Something went wrong");
    expect(translateQuoteError(undefined).title).toBe("Something went wrong");
  });

  test("handles empty-string error", () => {
    expect(translateQuoteError(new Error("")).title).toBe("Something went wrong");
  });

  test("translateQuoteErrorAsString concatenates description + hint", () => {
    const s = translateQuoteErrorAsString(new Error("ARCHIVED_REFERENCE_NOT_ALLOWED"));
    expect(s).toContain("Re-link");
    expect(s).toContain("Customer step");
  });

  test("translateQuoteErrorAsString omits hint when none provided", () => {
    const s = translateQuoteErrorAsString(new Error("Some unknown error"));
    expect(s).toBe("Some unknown error");
  });
});
