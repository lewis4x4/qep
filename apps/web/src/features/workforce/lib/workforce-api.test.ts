import { describe, expect, test } from "bun:test";

import {
  calculateAppraisalRollup,
  canAccessWorkforce,
  canManageWorkforce,
  filterManageableEmployees,
  normalizeProgression,
  scoreToBand,
  type WorkforceEmployee,
} from "./workforce-api";

const employees: WorkforceEmployee[] = [
  { id: "mgr-emp", profile_id: "mgr", employee_number: "M1", display_name: "Manager", class_code: null, profit_center: null, category_code: null, hire_date: null, termination_date: null, supervisor_id: null },
  { id: "tech-1", profile_id: "tech-profile", employee_number: "T1", display_name: "Tech One", class_code: null, profit_center: null, category_code: null, hire_date: null, termination_date: null, supervisor_id: "mgr-emp" },
  { id: "tech-2", profile_id: "other-profile", employee_number: "T2", display_name: "Tech Two", class_code: null, profit_center: null, category_code: null, hire_date: null, termination_date: null, supervisor_id: "other-mgr" },
];

describe("workforce appraisal helpers", () => {
  test("matches backend band thresholds", () => {
    expect(scoreToBand(3.99)).toBe("Sub-Par");
    expect(scoreToBand(4)).toBe("Normal");
    expect(scoreToBand(7.99)).toBe("Normal");
    expect(scoreToBand(8)).toBe("Excellent");
  });

  test("calculates COL + performance raise only when all seven scores are present", () => {
    expect(calculateAppraisalRollup([10, 9, 8, 8, 9, 10, 9], 3)).toEqual({
      overallScore: 9,
      band: "Excellent",
      performanceRaisePct: 9,
      recommendedRaisePct: 12,
    });
    expect(calculateAppraisalRollup([10, 9, 8], 3).overallScore).toBeNull();
  });
});

describe("workforce role helpers", () => {
  test("allows HR-sensitive workforce roles without opening reps/client stakeholders", () => {
    expect(canAccessWorkforce("admin")).toBe(true);
    expect(canAccessWorkforce("manager")).toBe(true);
    expect(canAccessWorkforce("technician")).toBe(true);
    expect(canAccessWorkforce("service_writer")).toBe(true);
    expect(canAccessWorkforce("rep")).toBe(false);
    expect(canAccessWorkforce("client_stakeholder")).toBe(false);
  });

  test("manager picker narrows to direct reports while admin can see active employees", () => {
    expect(canManageWorkforce("manager")).toBe(true);
    expect(filterManageableEmployees(employees, "mgr", "manager").map((employee) => employee.id)).toEqual(["tech-1"]);
    expect(filterManageableEmployees(employees, "admin", "admin").map((employee) => employee.id)).toEqual(["mgr-emp", "tech-1", "tech-2"]);
  });
});

describe("pay ladder normalizer", () => {
  test("normalizes missing requirement JSON and required certification arrays", () => {
    const row = normalizeProgression({
      technician_profile_id: "tp-1",
      technician_user_id: "u-1",
      technician_name: "Avery Tech",
      pay_ladder_role: "road",
      required_oem_certifications: [{ vendor: "cummins", min_status: "started" }],
      required_in_house_cert_keys: ["safety_standards"],
      vendor_login_required_vendors: ["cummins"],
      missing_requirements: [{ key: "efficiency_pct", required: 80, actual: 72 }],
      eligible_for_next_tier: false,
    });

    expect(row.technician_name).toBe("Avery Tech");
    expect(row.required_oem_certifications[0]?.vendor).toBe("cummins");
    expect(row.required_in_house_cert_keys).toEqual(["safety_standards"]);
    expect(row.missing_requirements[0]?.key).toBe("efficiency_pct");
  });
});
