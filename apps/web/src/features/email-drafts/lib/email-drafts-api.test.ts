import { describe, expect, test } from "bun:test";
import {
  normalizeEmailDraftRows,
  normalizeSendEmailDraftResult,
} from "./email-drafts-api";

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
        context: { trigger: "tariff" },
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
      context: { trigger: "tariff" },
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
