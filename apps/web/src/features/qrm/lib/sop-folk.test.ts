import { describe, expect, it } from "bun:test";
import { summarizeSopFolk } from "./sop-folk";

describe("summarizeSopFolk", () => {
  it("counts weak templates, blocked runs, and folk workflow pressure", () => {
    const summary = summarizeSopFolk({
      compliance: [
        {
          templateId: "tpl-1",
          templateTitle: "Traffic SOP",
          department: "ops",
          totalExecutions: 10,
          blockedExecutions: 2,
          completionRatePct: 55,
        },
        {
          templateId: "tpl-2",
          templateTitle: "Quote SOP",
          department: "sales",
          totalExecutions: 12,
          blockedExecutions: 0,
          completionRatePct: 92,
        },
      ],
      suggestions: [
        { id: "s-1", occurrenceCount: 8, uniqueUsers: 3, status: "open" },
        { id: "s-2", occurrenceCount: 5, uniqueUsers: 2, status: "promoted" },
      ],
    });

    expect(summary.templates).toBe(2);
    expect(summary.weakTemplates).toBe(1);
    expect(summary.blockedRuns).toBe(2);
    expect(summary.folkSuggestions).toBe(1);
    expect(summary.folkUsageHits).toBe(13);
  });
});
