import { beforeEach, describe, expect, mock, test } from "bun:test";

let lastUpdatePayload: Record<string, unknown> | null = null;

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: mock(() => ({
      update: mock((payload: Record<string, unknown>) => {
        lastUpdatePayload = payload;
        return {
          eq: mock(async () => ({ error: null })),
        };
      }),
    })),
  },
}));

const {
  draftRequiresVoicePass,
  normalizeEmailDraftRows,
  normalizeSendEmailDraftResult,
  updateEmailDraft,
} = await import("./email-drafts-api");

beforeEach(() => {
  lastUpdatePayload = null;
});

describe("email draft API normalizers", () => {
  test("normalizes draft rows and filters malformed records", () => {
    const rows = normalizeEmailDraftRows([
      {
        id: "draft-1",
        workspace_id: "workspace-1",
        scenario: "tariff",
        tone: "urgent",
        deal_id: "deal-1",
        contact_id: null,
        company_id: "company-1",
        equipment_id: null,
        subject: "Tariff update",
        body: "A price change is coming.",
        to_email: "buyer@example.com",
        preview: "",
        urgency_score: "0.88",
        context: {
          trigger: "tariff",
          voice_gate: {
            policy: "E2.2/QEP-125",
            required: true,
            status: "requires_human_edit",
            pass_type: null,
            reason: "llm_generated_user_facing",
            generated_by: "draft-email",
            created_at: "2026-05-03T12:00:00Z",
            passed_at: null,
            passed_by: null,
          },
        },
        status: "edited",
        sent_at: "bad-date",
        sent_via: "manual",
        created_by: "user-1",
        created_at: "2026-05-03T12:00:00Z",
        updated_at: "2026-05-03T12:30:00Z",
      },
      { id: "draft-2", workspace_id: "workspace-1", subject: "", body: "Missing subject" },
    ]);

    expect(rows).toEqual([{
      id: "draft-1",
      workspace_id: "workspace-1",
      scenario: "tariff",
      tone: "urgent",
      deal_id: "deal-1",
      contact_id: null,
      company_id: "company-1",
      equipment_id: null,
      subject: "Tariff update",
      body: "A price change is coming.",
      to_email: "buyer@example.com",
      preview: null,
      urgency_score: 0.88,
      context: {
        trigger: "tariff",
        voice_gate: {
          policy: "E2.2/QEP-125",
          required: true,
          status: "requires_human_edit",
          pass_type: null,
          reason: "llm_generated_user_facing",
          generated_by: "draft-email",
          created_at: "2026-05-03T12:00:00Z",
          passed_at: null,
          passed_by: null,
        },
      },
      voice_compliance: {
        policy: "E2.2/QEP-125",
        required: true,
        status: "requires_human_edit",
        pass_type: null,
        reason: "llm_generated_user_facing",
        generated_by: "draft-email",
        created_at: "2026-05-03T12:00:00Z",
        passed_at: null,
        passed_by: null,
      },
      status: "edited",
      sent_at: null,
      sent_via: "manual",
      created_by: "user-1",
      created_at: "2026-05-03T12:00:00Z",
      updated_at: "2026-05-03T12:30:00Z",
    }]);
  });

  test("falls back invalid enums and malformed context safely", () => {
    const [row] = normalizeEmailDraftRows([{
      id: "draft-1",
      workspace_id: "workspace-1",
      scenario: "unknown",
      tone: "bad",
      subject: "Hello",
      body: "Body",
      context: [],
      status: "bad",
      created_at: "2026-05-03T12:00:00Z",
      updated_at: "2026-05-03T12:30:00Z",
    }]);

    expect(row.scenario).toBe("custom");
    expect(row.tone).toBe("consultative");
    expect(row.status).toBe("pending");
    expect(row.context).toEqual({});
    expect(row.voice_compliance).toBeNull();
  });

  test("detects generated drafts that still require a voice pass", () => {
    const [pendingDraft, editedDraft, legacyDraft] = normalizeEmailDraftRows([
      {
        id: "pending",
        workspace_id: "workspace-1",
        subject: "Generated",
        body: "Generated body",
        status: "pending",
        context: {
          voice_gate: {
            required: true,
            status: "requires_human_edit",
            generated_by: "draft-email",
          },
        },
        created_at: "2026-05-03T12:00:00Z",
        updated_at: "2026-05-03T12:30:00Z",
      },
      {
        id: "edited",
        workspace_id: "workspace-1",
        subject: "Edited",
        body: "Edited body",
        status: "edited",
        context: {
          voice_gate: {
            required: true,
            status: "requires_human_edit",
            generated_by: "draft-email",
          },
        },
        created_at: "2026-05-03T12:00:00Z",
        updated_at: "2026-05-03T12:30:00Z",
      },
      {
        id: "legacy",
        workspace_id: "workspace-1",
        subject: "Legacy",
        body: "Legacy body",
        status: "pending",
        context: {},
        created_at: "2026-05-03T12:00:00Z",
        updated_at: "2026-05-03T12:30:00Z",
      },
    ]);

    expect(draftRequiresVoicePass(pendingDraft)).toBe(true);
    expect(draftRequiresVoicePass(editedDraft)).toBe(false);
    expect(draftRequiresVoicePass(legacyDraft)).toBe(false);
  });

  test("does not allow direct sent or edited transitions through generic update", async () => {
    await expect(
      updateEmailDraft("draft-1", { status: "sent" as never }),
    ).rejects.toThrow("Use subject/body edits or send helpers for gated status transitions");
    await expect(
      updateEmailDraft("draft-1", { status: "edited" as never }),
    ).rejects.toThrow("Use subject/body edits or send helpers for gated status transitions");
    expect(lastUpdatePayload).toBeNull();
  });

  test("real subject and body edits automatically mark the draft edited", async () => {
    await updateEmailDraft("draft-1", { subject: "Updated subject", body: "Updated body" });

    expect(lastUpdatePayload).toEqual({
      subject: "Updated subject",
      body: "Updated body",
      status: "edited",
    });
  });

  test("normalizes send edge responses", () => {
    expect(normalizeSendEmailDraftResult({ sent: true, to_email: "buyer@example.com" })).toEqual({
      sent: true,
      to_email: "buyer@example.com",
    });
  });

  test("rejects malformed send edge responses", () => {
    expect(() => normalizeSendEmailDraftResult({ sent: false, to_email: "buyer@example.com" })).toThrow(
      "Malformed send email response",
    );
    expect(() => normalizeSendEmailDraftResult({ sent: true })).toThrow("Malformed send email response");
  });
});
