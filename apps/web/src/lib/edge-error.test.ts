import { describe, expect, test } from "bun:test";
import {
  COMMAND_CENTER_TEAM_SCOPE_DENIED_MESSAGE,
  sanitizeClientError,
  sanitizeCommandCenterInvokeMessage,
} from "./edge-error";

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

describe("sanitizeCommandCenterInvokeMessage", () => {
  const oldLiveFormula =
    "Team scope requires Iron Manager privileges (blend weight ≥ 0.5) (HTTP 403)";
  const newMainFormula =
    "Team scope requires manager/admin privileges or Iron Manager blend weight ≥ 0.5 (HTTP 403)";

  test("never surfaces internal privilege formulas from old or new edge bodies", () => {
    for (const raw of [oldLiveFormula, newMainFormula]) {
      const sanitized = sanitizeCommandCenterInvokeMessage(raw, 403);
      expect(sanitized).toBe(COMMAND_CENTER_TEAM_SCOPE_DENIED_MESSAGE);
      expect(sanitized.toLowerCase()).not.toContain("blend weight");
      expect(sanitized).not.toContain("≥ 0.5");
    }
  });

  test("maps generic team-scope 403 copy without leaking jargon", () => {
    const sanitized = sanitizeCommandCenterInvokeMessage(
      "Team scope denied for this profile (HTTP 403)",
      403,
    );
    expect(sanitized).toBe(COMMAND_CENTER_TEAM_SCOPE_DENIED_MESSAGE);
  });

  test("preserves unrelated outage messages", () => {
    const outage = "Upstream signal query timed out (HTTP 503)";
    expect(sanitizeCommandCenterInvokeMessage(outage, 503)).toBe(outage);
  });
});
