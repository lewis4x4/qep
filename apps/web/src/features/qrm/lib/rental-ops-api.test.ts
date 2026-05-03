import { describe, expect, it } from "bun:test";
import {
  normalizeRentalOpsErrorMessage,
  normalizeRentalOpsSuccessPayload,
  requireRentalOpsObjectPayload,
} from "./rental-ops-api";

describe("rental ops api response normalizers", () => {
  it("preserves valid success payloads and extracts expected object containers", () => {
    const payload = normalizeRentalOpsSuccessPayload(JSON.stringify({
      contract: { id: "contract-1", status: "approved" },
    }));

    expect(requireRentalOpsObjectPayload(payload, "contract")).toEqual({
      id: "contract-1",
      status: "approved",
    });
  });

  it("fails safely on malformed success JSON and non-object payloads", () => {
    expect(normalizeRentalOpsSuccessPayload("")).toEqual({});
    expect(() => normalizeRentalOpsSuccessPayload("{bad"))
      .toThrow("Rental ops returned malformed JSON.");
    expect(() => normalizeRentalOpsSuccessPayload("[]"))
      .toThrow("Rental ops returned an invalid JSON payload.");
    expect(() => requireRentalOpsObjectPayload({ contract: null }, "contract"))
      .toThrow("Rental ops response is missing a valid 'contract' object.");
  });

  it("normalizes error messages from JSON envelopes or text fallbacks", () => {
    expect(normalizeRentalOpsErrorMessage(JSON.stringify({ error: " Booking closed " }), 409))
      .toBe("Booking closed");
    expect(normalizeRentalOpsErrorMessage("upstream unavailable", 502))
      .toBe("upstream unavailable");
    expect(normalizeRentalOpsErrorMessage(JSON.stringify({ error: "" }), 500))
      .toBe("Request failed (500)");
  });
});
