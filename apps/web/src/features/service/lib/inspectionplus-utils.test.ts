import { describe, expect, test } from "bun:test";
import {
  INSPECTIONPLUS_TEMPLATES,
  buildInspectionFindingDrafts,
  groupInspectionFindings,
  makeInspectionNumber,
  normalizeInspectionFindings,
  normalizeInspectionHeader,
  normalizeInspectionRows,
  summarizeInspectionFindings,
  templateByKey,
} from "./inspectionplus-utils";

describe("inspectionplus-utils", () => {
  test("returns template by key", () => {
    expect(templateByKey("general_condition")?.name).toBe("General Condition");
    expect(templateByKey("missing")).toBeNull();
  });

  test("builds finding drafts from a template", () => {
    const drafts = buildInspectionFindingDrafts(INSPECTIONPLUS_TEMPLATES[0]!);
    expect(drafts.length).toBeGreaterThan(3);
    expect(drafts[0]).toMatchObject({
      response: "pending",
      sort_order: 0,
    });
  });

  test("creates deterministic inspection numbers when suffix provided", () => {
    const out = makeInspectionNumber(new Date("2026-04-22T12:00:00.000Z"), "ab12");
    expect(out).toBe("IP-260422-AB12");
  });

  test("summarizes finding progress", () => {
    expect(
      summarizeInspectionFindings([
        { response: "pending" },
        { response: "pass" },
        { response: "fail" },
        { response: "na" },
      ]),
    ).toEqual({
      total: 4,
      completed: 3,
      failed: 1,
      pending: 1,
    });
  });

  test("groups findings by section", () => {
    const grouped = groupInspectionFindings([
      { section_label: "Safety", sort_order: 2, id: "b" },
      { section_label: "Hydraulics", sort_order: 1, id: "c" },
      { section_label: "Safety", sort_order: 0, id: "a" },
    ]);
    expect(grouped.map((item) => item.section)).toEqual(["Safety", "Hydraulics"]);
    expect(grouped[0]?.findings.map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("normalizes inspection list rows and filters invalid statuses", () => {
    expect(normalizeInspectionRows([
      {
        id: "insp-1",
        inspection_number: "IP-260503-ABCD",
        title: "Rental return",
        template_name: "Rental Return",
        inspection_type: "rental_return",
        status: "in_progress",
        stock_number: "STK-1",
        reference_number: null,
        customer_name: "Evergreen Farms",
        machine_summary: "Kubota KX080",
        service_job_id: "job-1",
        assignee_name: "Jordan Lane",
        approver_name: null,
        created_by: "user-1",
        started_at: null,
        completed_at: null,
        created_at: "2026-05-03T10:00:00.000Z",
      },
      { id: "bad", inspection_number: "IP-1", title: "Bad", inspection_type: "x", status: "unknown" },
    ])).toEqual([
      {
        id: "insp-1",
        inspection_number: "IP-260503-ABCD",
        title: "Rental return",
        template_name: "Rental Return",
        inspection_type: "rental_return",
        status: "in_progress",
        stock_number: "STK-1",
        reference_number: null,
        customer_name: "Evergreen Farms",
        machine_summary: "Kubota KX080",
        service_job_id: "job-1",
        assignee_name: "Jordan Lane",
        approver_name: null,
        created_by: "user-1",
        started_at: null,
        completed_at: null,
        created_at: "2026-05-03T10:00:00.000Z",
      },
    ]);
  });

  test("normalizes inspection detail headers", () => {
    expect(normalizeInspectionHeader({
      id: "insp-1",
      inspection_number: "IP-260503-ABCD",
      title: "Rental return",
      template_name: null,
      inspection_type: "rental_return",
      status: "completed",
      stock_number: null,
      reference_number: null,
      customer_name: null,
      machine_summary: null,
      service_job_id: null,
      assignee_name: null,
      approver_name: "Manager",
      created_by: "user-1",
      started_at: "2026-05-03T10:00:00.000Z",
      completed_at: "2026-05-03T11:00:00.000Z",
      approval_status: "pending",
      created_at: "2026-05-03T09:00:00.000Z",
      cancellation_reason: null,
    })?.approval_status).toBe("pending");

    expect(normalizeInspectionHeader({ id: "insp-1", approval_status: "unknown" })).toBeNull();
  });

  test("normalizes inspection findings and coerces numeric sort order", () => {
    expect(normalizeInspectionFindings([
      {
        id: "finding-1",
        inspection_id: "insp-1",
        section_label: "Safety",
        finding_label: "Horn works",
        response: "fail",
        sort_order: "2",
        expected_value: "Working",
        observed_value: "No sound",
        notes: "Repair needed",
        requires_follow_up: true,
      },
      {
        id: "bad",
        inspection_id: "insp-1",
        section_label: "Safety",
        finding_label: "Bad response",
        response: "maybe",
        sort_order: 3,
      },
    ])).toEqual([
      {
        id: "finding-1",
        inspection_id: "insp-1",
        section_label: "Safety",
        finding_label: "Horn works",
        response: "fail",
        sort_order: 2,
        expected_value: "Working",
        observed_value: "No sound",
        notes: "Repair needed",
        requires_follow_up: true,
      },
    ]);
  });

  test("inspection normalizers return safe empty values for malformed payloads", () => {
    expect(normalizeInspectionRows(null)).toEqual([]);
    expect(normalizeInspectionFindings({})).toEqual([]);
    expect(normalizeInspectionHeader("bad")).toBeNull();
  });
});
