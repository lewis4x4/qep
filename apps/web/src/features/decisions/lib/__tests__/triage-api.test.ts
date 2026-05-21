import { describe, expect, it } from "vitest";
import { buildOwnerDecisionActionPatch, normalizeTriageDecisionRows } from "../triage-api";

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

describe("buildOwnerDecisionActionPatch", () => {
  it("builds owner approve patches with answered fields and owner web stamp", () => {
    const patch = buildOwnerDecisionActionPatch({
      action: "approve",
      ownerRole: "owner",
      recommendedOption: "Approve the quiet operator fallback",
      existingPacket: { existing: true },
      actorName: "Dana Owner",
      nowIso: "2026-05-21T12:00:00.000Z",
    });

    expect(patch).toMatchObject({
      status: "answered",
      answered_by: "owner-web:Dana Owner",
      answered_at: "2026-05-21T12:00:00.000Z",
      answered_option: "Approve the quiet operator fallback",
    });
    expect(patch.answered_rationale).toContain("/decisions");
    expect(patch.ai_prep_packet).toMatchObject({
      existing: true,
      owner_web_last_action: {
        action: "approve",
        owner_role: "owner",
        actor: "owner-web:Dana Owner",
        at: "2026-05-21T12:00:00.000Z",
        surface: "/decisions",
      },
    });
    expect((patch.ai_prep_packet as Record<string, unknown>).brian_triage_approved_at).toBeUndefined();
  });

  it("rejects approval without a recommended option", () => {
    expect(() =>
      buildOwnerDecisionActionPatch({
        action: "approve",
        ownerRole: "owner",
        recommendedOption: "  ",
        existingPacket: null,
        nowIso: "2026-05-21T12:00:00.000Z",
      }),
    ).toThrow("Approve requires a recommended option");
  });

  it("builds block and need-info patches without answering", () => {
    const blockPatch = buildOwnerDecisionActionPatch({
      action: "block",
      ownerRole: "manager",
      recommendedOption: null,
      existingPacket: null,
      actorName: "Morgan Manager",
      nowIso: "2026-05-21T12:00:00.000Z",
    });
    const needInfoPatch = buildOwnerDecisionActionPatch({
      action: "need_info",
      ownerRole: "manager",
      recommendedOption: "Ship",
      existingPacket: { voice_memo_candidate: { action: "need_info" } },
      actorName: "Morgan Manager",
      nowIso: "2026-05-21T12:01:00.000Z",
    });

    expect(blockPatch.status).toBe("escalated");
    expect(blockPatch).not.toHaveProperty("answered_at");
    expect(blockPatch.ai_prep_packet).toMatchObject({
      owner_web_last_action: { action: "block", surface: "/decisions" },
    });

    expect(needInfoPatch.status).toBe("open");
    expect(needInfoPatch).not.toHaveProperty("answered_at");
    expect(needInfoPatch.ai_prep_packet).toMatchObject({
      voice_memo_candidate: { action: "need_info" },
      owner_web_last_action: { action: "need_info", surface: "/decisions" },
    });
  });
});
