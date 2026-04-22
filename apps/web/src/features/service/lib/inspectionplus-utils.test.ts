import { describe, expect, test } from "bun:test";
import {
  INSPECTIONPLUS_TEMPLATES,
  buildInspectionFindingDrafts,
  groupInspectionFindings,
  makeInspectionNumber,
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
});
