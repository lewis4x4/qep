import { describe, expect, test } from "bun:test";
import {
  deriveServiceAgreementStatus,
  formatAgreementWindow,
  matchesAgreementSearch,
  normalizeServiceAgreementCompanyOptions,
  normalizeServiceAgreementEquipmentOptions,
  normalizeServiceAgreementMaintenanceRows,
  normalizeServiceAgreementRow,
  normalizeServiceAgreementRows,
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

  test("normalizes agreement rows and joined relation arrays", () => {
    expect(normalizeServiceAgreementRows([
      {
        id: "agreement-1",
        contract_number: "SAM-2026-001",
        status: "active",
        customer_id: "company-1",
        equipment_id: "equipment-1",
        location_code: "OCALA",
        program_name: "Premier PM",
        category: "Excavator",
        coverage_summary: "Full PM",
        starts_on: "2026-04-01",
        expires_on: "2027-04-01",
        renewal_date: null,
        billing_cycle: "monthly",
        term_months: "12",
        included_pm_services: "4",
        estimated_contract_value: "24000",
        notes: null,
        qrm_companies: [{ name: "Evergreen Farms" }],
        qrm_equipment: [{ stock_number: "EQ-44", serial_number: "SER-900", make: "Kubota", model: "KX080", name: "Excavator" }],
      },
      {
        id: "bad-status",
        contract_number: "SAM-2026-002",
        status: "unknown",
        program_name: "Premier PM",
      },
      {
        id: "missing-program",
        contract_number: "SAM-2026-003",
        status: "active",
        program_name: "",
      },
    ])).toEqual([
      {
        id: "agreement-1",
        contract_number: "SAM-2026-001",
        status: "active",
        customer_id: "company-1",
        equipment_id: "equipment-1",
        location_code: "OCALA",
        program_name: "Premier PM",
        category: "Excavator",
        coverage_summary: "Full PM",
        starts_on: "2026-04-01",
        expires_on: "2027-04-01",
        renewal_date: null,
        billing_cycle: "monthly",
        term_months: 12,
        included_pm_services: 4,
        estimated_contract_value: 24000,
        notes: null,
        qrm_companies: { name: "Evergreen Farms" },
        qrm_equipment: { stock_number: "EQ-44", serial_number: "SER-900", make: "Kubota", model: "KX080", name: "Excavator" },
      },
    ]);
  });

  test("normalizes single agreement detail rows", () => {
    expect(normalizeServiceAgreementRow({
      id: "agreement-1",
      contract_number: "SAM-2026-001",
      status: "draft",
      program_name: "Starter PM",
    })).toMatchObject({
      id: "agreement-1",
      contract_number: "SAM-2026-001",
      status: "draft",
      program_name: "Starter PM",
    });
    expect(normalizeServiceAgreementRow({ id: "bad", status: "draft", program_name: "Starter PM" })).toBeNull();
  });

  test("normalizes agreement company and equipment options", () => {
    expect(normalizeServiceAgreementCompanyOptions([
      { id: "company-1", name: "Evergreen Farms" },
      { id: "company-2", name: "" },
      { id: 42, name: "Bad ID" },
    ])).toEqual([
      { id: "company-1", name: "Evergreen Farms" },
    ]);

    expect(normalizeServiceAgreementEquipmentOptions([
      { id: "equipment-1", name: null, stock_number: "EQ-44", serial_number: "SER-900", make: "Kubota", model: "KX080" },
      { id: "", stock_number: "BAD" },
    ])).toEqual([
      { id: "equipment-1", name: null, stock_number: "EQ-44", serial_number: "SER-900", make: "Kubota", model: "KX080" },
    ]);
  });

  test("normalizes maintenance schedule rows", () => {
    expect(normalizeServiceAgreementMaintenanceRows([
      { id: "schedule-1", label: "250 hour PM", scheduled_date: "2026-05-01", status: "scheduled" },
      { id: "bad-status", label: "Bad", scheduled_date: "2026-05-01", status: "" },
    ])).toEqual([
      { id: "schedule-1", label: "250 hour PM", scheduled_date: "2026-05-01", status: "scheduled" },
    ]);
  });

  test("normalizers return safe empty values for non-array inputs", () => {
    expect(normalizeServiceAgreementRows(null)).toEqual([]);
    expect(normalizeServiceAgreementCompanyOptions({ id: "company-1" })).toEqual([]);
    expect(normalizeServiceAgreementEquipmentOptions(undefined)).toEqual([]);
    expect(normalizeServiceAgreementMaintenanceRows("bad")).toEqual([]);
  });
});
