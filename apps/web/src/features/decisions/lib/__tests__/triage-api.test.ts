import { describe, expect, it } from "vitest";
import { normalizeTriageDecisionRows } from "../triage-api";

describe("normalizeTriageDecisionRows", () => {
  it("normalizes rows and filters invalid statuses", () => {
    const rows = normalizeTriageDecisionRows([
      {
        id: "d-1",
        code: "QEP-1",
        question_plain: "Ship it?",
        lane: "ratify",
        owner_role: "owner",
        recommended_option: "yes",
        recommended_rationale: "Strong evidence",
        options: [{ label: "yes" }],
        citations: [{ source: "spec", ref: "doc-1", excerpt: "excerpt" }],
        reversal_cost: "medium",
        status: "open",
        created_at: "2026-05-20T00:00:00.000Z",
        updated_at: "2026-05-21T00:00:00.000Z",
        age_days: "1.5",
        gated_task_count: 3,
        gated_streams: ["crm", "ops"],
        ai_prep_packet: { existing: true },
      },
      {
        id: "d-2",
        code: "QEP-2",
        question_plain: "Ignore me",
        lane: "ratify",
        owner_role: "owner",
        status: "answered",
        created_at: "2026-05-20T00:00:00.000Z",
        updated_at: "2026-05-21T00:00:00.000Z",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "d-1",
      code: "QEP-1",
      status: "open",
      gatedTaskCount: 3,
      gatedStreams: ["crm", "ops"],
      ageDays: 1.5,
      aiPrepPacket: { existing: true },
    });
    expect(rows[0].citations).toEqual([{ source: "spec", ref: "doc-1", excerpt: "excerpt" }]);
  });

  it("defaults ai_prep_packet to empty object when missing", () => {
    const rows = normalizeTriageDecisionRows([
      {
        id: "d-3",
        code: "QEP-3",
        question_plain: "Another",
        lane: "authorize",
        owner_role: "owner",
        status: "escalated",
        created_at: "2026-05-20T00:00:00.000Z",
        updated_at: "2026-05-21T00:00:00.000Z",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].aiPrepPacket).toEqual({});
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeTriageDecisionRows(null)).toEqual([]);
  });
});
