import { describe, expect, test } from "bun:test";
import {
  AUDIT_TABLES,
  auditTableLabel,
  normalizeAuditActorProfiles,
  normalizeAuditEvents,
  summarizeRecord,
  type AuditEvent,
} from "../audit-api";

describe("audit-api pure helpers", () => {
  test("normalizes audit rows and filters malformed actions or change payloads", () => {
    expect(normalizeAuditEvents("qb_quotes_audit", [
      {
        id: "event-1",
        record_id: "quote-1",
        action: "update",
        actor_id: "user-1",
        source_table_name: null,
        changed_fields: { status: { old: "draft", new: "sent" } },
        snapshot: { quote_number: "Q-1" },
        created_at: "2026-04-19T00:00:00Z",
      },
      {
        id: "event-2",
        record_id: "quote-2",
        action: "bad",
        changed_fields: null,
        snapshot: {},
        created_at: "2026-04-19T00:00:00Z",
      },
      {
        id: "event-3",
        record_id: "quote-3",
        action: "update",
        changed_fields: { status: { old: "draft" } },
        snapshot: {},
        created_at: "2026-04-19T00:00:00Z",
      },
    ])).toEqual([
      {
        id: "event-1",
        table: "qb_quotes_audit",
        record_id: "quote-1",
        action: "update",
        actor_id: "user-1",
        source_table_name: null,
        actor_email: null,
        changed_fields: { status: { old: "draft", new: "sent" } },
        snapshot: { quote_number: "Q-1" },
        created_at: "2026-04-19T00:00:00Z",
      },
    ]);
  });

  test("normalizes actor profiles and drops missing emails", () => {
    expect(normalizeAuditActorProfiles([
      { id: "user-1", email: "admin@example.com" },
      { id: "user-2", email: null },
      { id: "", email: "bad@example.com" },
    ])).toEqual([
      { id: "user-1", email: "admin@example.com" },
    ]);
  });

  test("AUDIT_TABLES covers central view plus all 7 qb_*_audit tables from migration 288", () => {
    expect(AUDIT_TABLES).toHaveLength(8);
    expect(AUDIT_TABLES).toContain("v_audit_record_changes");
    expect(AUDIT_TABLES).toEqual(expect.arrayContaining([
      "qb_quotes_audit",
      "qb_deals_audit",
      "qb_brands_audit",
      "qb_equipment_models_audit",
      "qb_attachments_audit",
      "qb_programs_audit",
      "qb_price_sheets_audit",
    ]));
  });

  test("auditTableLabel strips qb_ prefix and _audit suffix", () => {
    expect(auditTableLabel("qb_brands_audit")).toBe("brands");
    expect(auditTableLabel("qb_price_sheets_audit")).toBe("price sheets");
    expect(auditTableLabel("qb_equipment_models_audit")).toBe("equipment models");
  });

  function buildEvent(snapshot: Record<string, unknown>): AuditEvent {
    return {
      id: "evt-1",
      table: "qb_brands_audit",
      record_id: "abcdef01-2345-6789-abcd-ef0123456789",
      action: "update",
      actor_id: null,
      actor_email: null,
      changed_fields: null,
      snapshot,
      created_at: "2026-04-19T00:00:00Z",
    };
  }

  test("summarizeRecord: prefers `name` when present", () => {
    expect(summarizeRecord(buildEvent({ name: "ASV", code: "ASV" }))).toBe("ASV");
  });

  test("summarizeRecord: zone_name wins over code for freight zones", () => {
    expect(summarizeRecord(buildEvent({ zone_name: "Southeast", code: "X" }))).toBe("Southeast");
  });

  test("summarizeRecord: falls back through candidate list", () => {
    expect(summarizeRecord(buildEvent({ filename: "ASV-Q2-2026.pdf" }))).toBe("ASV-Q2-2026.pdf");
    expect(summarizeRecord(buildEvent({ quote_number: "Q-2026-0042" }))).toBe("Q-2026-0042");
    expect(summarizeRecord(buildEvent({ model_code: "RT-135" }))).toBe("RT-135");
    expect(summarizeRecord(buildEvent({ part_number: "AT-PALLET-FRK" }))).toBe("AT-PALLET-FRK");
    expect(summarizeRecord(buildEvent({ program_code: "ASV-LF-Q2" }))).toBe("ASV-LF-Q2");
  });

  test("summarizeRecord: uses record_id prefix when no display field matches", () => {
    const r = summarizeRecord(buildEvent({ irrelevant_field: "whatever" }));
    expect(r).toBe("abcdef01…");
  });

  test("summarizeRecord: ignores empty strings and uses next candidate", () => {
    expect(summarizeRecord(buildEvent({ name: "   ", code: "ASV" }))).toBe("ASV");
  });

  test("summarizeRecord: handles null snapshot defensively", () => {
    const e: AuditEvent = { ...buildEvent({}), snapshot: null };
    expect(summarizeRecord(e)).toBe("abcdef01…");
  });
});
