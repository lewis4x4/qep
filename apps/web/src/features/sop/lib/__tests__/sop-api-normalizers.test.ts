import { describe, expect, mock, test } from "bun:test";

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));

const {
  normalizeSopDepartment,
  normalizeSopExecutionPayload,
  normalizeSopIngestResponse,
  normalizeSopStepPayload,
  normalizeSopTemplatePayload,
  normalizeSopSuggestionsResponse,
  sopErrorMessage,
} = await import("../sop-api");

const baseTemplate = {
  id: "template-1",
  workspace_id: "workspace-1",
  title: "Delivery SOP",
  description: null,
  department: "sales",
  version: 2,
  status: "draft",
  created_by: null,
  approved_by: null,
  approved_at: null,
  document_id: null,
  tags: ["delivery", "sales"],
  created_at: "2026-05-03T12:00:00.000Z",
  updated_at: "2026-05-03T12:00:00.000Z",
};

describe("sop api normalizers", () => {
  test("normalizes generated template rows and count aggregates", () => {
    const template = normalizeSopTemplatePayload({
      ...baseTemplate,
      sop_steps: [{ count: 3 }],
    });

    expect(template.department).toBe("sales");
    expect(template.status).toBe("draft");
    expect(template.tags).toEqual(["delivery", "sales"]);
    expect(template.sop_steps?.[0]?.count).toBe(3);
  });

  test("rejects malformed domain enum values instead of casting them through", () => {
    expect(() => normalizeSopTemplatePayload({ ...baseTemplate, department: "finance" }))
      .toThrow("Invalid SOP template response");
    expect(() => normalizeSopExecutionPayload({
      id: "execution-1",
      workspace_id: "workspace-1",
      sop_template_id: "template-1",
      started_by: null,
      assigned_to: null,
      context_entity_type: null,
      context_entity_id: null,
      status: "paused",
      started_at: "2026-05-03T12:00:00.000Z",
      completed_at: null,
      notes: null,
      created_at: "2026-05-03T12:00:00.000Z",
      updated_at: "2026-05-03T12:00:00.000Z",
    })).toThrow("Invalid SOP execution response");
  });

  test("normalizes step JSON fields with safe defaults", () => {
    const step = normalizeSopStepPayload({
      id: "step-1",
      sop_template_id: "template-1",
      sort_order: 1,
      title: "Confirm delivery date",
      instructions: null,
      required_role: null,
      estimated_duration_minutes: null,
      is_decision_point: null,
      decision_options: [{ label: "Approved", next_step: 2 }],
      attachment_urls: null,
      created_at: "2026-05-03T12:00:00.000Z",
      updated_at: "2026-05-03T12:00:00.000Z",
    });

    expect(step.is_decision_point).toBe(false);
    expect(step.attachment_urls).toEqual([]);
    expect(step.decision_options).toEqual([{ label: "Approved", next_step: 2 }]);
  });

  test("normalizes edge function response wrappers", () => {
    expect(normalizeSopIngestResponse({
      ok: true,
      template_id: "template-1",
      template_title: "Delivery SOP",
      steps_extracted: 4,
      total_steps_parsed: 5,
      parse_confidence: 0.91,
      status: "draft",
    })).toEqual({
      ok: true,
      template_id: "template-1",
      template_title: "Delivery SOP",
      steps_extracted: 4,
      total_steps_parsed: 5,
      parse_confidence: 0.91,
      status: "draft",
    });

    expect(normalizeSopSuggestionsResponse({
      context: { entity_type: "deal", stage: "delivery", department: "sales" },
      suggestions: [{
        id: "template-1",
        title: "Delivery SOP",
        description: null,
        department: "sales",
        tags: null,
        version: 1,
        relevance_score: 0.88,
        nudge: "Run the delivery SOP.",
      }],
      total_active_sops: 7,
    }).suggestions[0]?.department).toBe("sales");
  });

  test("normalizes select values and unknown UI errors", () => {
    expect(normalizeSopDepartment("parts", "sales")).toBe("parts");
    expect(normalizeSopDepartment("finance", "sales")).toBe("sales");
    expect(sopErrorMessage(new Error("Publish failed"), "fallback")).toBe("Publish failed");
    expect(sopErrorMessage({ error: "Edge failed" }, "fallback")).toBe("Edge failed");
    expect(sopErrorMessage({ code: "bad" }, "fallback")).toBe("fallback");
  });
});
