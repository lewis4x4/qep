import { describe, expect, test } from "bun:test";
import {
  deriveServiceAgreementStatus,
  formatAgreementWindow,
  matchesAgreementSearch,
} from "./service-agreement-utils";

describe("service-agreement-utils", () => {
  test("marks active agreements expired when end date passes", () => {
    expect(
      deriveServiceAgreementStatus("active", "2026-04-01", new Date("2026-04-22T12:00:00.000Z")),
    ).toBe("expired");
    expect(
      deriveServiceAgreementStatus("cancelled", "2026-04-01", new Date("2026-04-22T12:00:00.000Z")),
    ).toBe("cancelled");
  });

  test("formats agreement window", () => {
    expect(formatAgreementWindow("2026-04-01", "2027-04-01")).toContain("2026");
    expect(formatAgreementWindow(null, null)).toBe("— → —");
  });

  test("matches by contract, machine, program, and customer", () => {
    const row = {
      contract_number: "SAM-2026-001",
      location_code: "OCALA",
      program_name: "Premier PM",
      category: "Excavator",
      qrm_companies: { name: "Evergreen Farms" },
      qrm_equipment: { stock_number: "EQ-44", serial_number: "SER-900", make: "Kubota", model: "KX080" },
    };
    expect(matchesAgreementSearch(row, "SAM-2026")).toBe(true);
    expect(matchesAgreementSearch(row, "evergreen")).toBe(true);
    expect(matchesAgreementSearch(row, "eq-44")).toBe(true);
    expect(matchesAgreementSearch(row, "wheel loader")).toBe(false);
  });
});
