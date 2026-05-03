import { describe, expect, test } from "bun:test";
import {
  detectHashChange,
  formatLastChecked,
  isOverdue,
  normalizeSheetSourceRows,
  normalizeSheetSourceWithBrandRows,
  normalizeSheetWatchEventRows,
  summarizeSourceHealth,
  type SheetSourceRow,
  type SheetWatchEventRow,
} from "../sheet-watchdog-api";

// ── Fixtures ─────────────────────────────────────────────────────────────

function src(partial: Partial<SheetSourceRow> = {}): SheetSourceRow {
  return {
    id:                   partial.id ?? "s-1",
    workspace_id:         "default",
    brand_id:             partial.brand_id ?? "b-1",
    label:                partial.label ?? "Test source",
    url:                  partial.url ?? "https://example.com/prices.pdf",
    check_freq_hours:     partial.check_freq_hours ?? 24,
    last_checked_at:      partial.last_checked_at ?? null,
    last_hash:            partial.last_hash ?? null,
    last_etag:            partial.last_etag ?? null,
    last_http_status:     partial.last_http_status ?? null,
    last_error:           partial.last_error ?? null,
    consecutive_failures: partial.consecutive_failures ?? 0,
    notes:                partial.notes ?? null,
    active:               partial.active ?? true,
    created_by:           partial.created_by ?? null,
    created_at:           partial.created_at ?? "2026-04-01T00:00:00Z",
    updated_at:           partial.updated_at ?? "2026-04-01T00:00:00Z",
  };
}

function evt(
  partial: Partial<SheetWatchEventRow> & Pick<SheetWatchEventRow, "event_type">,
): SheetWatchEventRow {
  return {
    id:            partial.id ?? crypto.randomUUID(),
    workspace_id:  "default",
    source_id:     partial.source_id ?? "s-1",
    event_type:    partial.event_type,
    detail:        partial.detail ?? null,
    price_sheet_id: partial.price_sheet_id ?? null,
    created_at:    partial.created_at ?? "2026-04-19T00:00:00Z",
  };
}

describe("sheet watchdog row normalizers", () => {
  test("normalizes sources with numeric strings and safe nullable fields", () => {
    expect(normalizeSheetSourceRows([
      {
        id: "source-1",
        workspace_id: "default",
        brand_id: "brand-1",
        label: "ASV book",
        url: "https://example.com/asv.pdf",
        check_freq_hours: "24",
        last_checked_at: "2026-04-20T00:00:00Z",
        last_hash: "abc",
        last_etag: 42,
        last_http_status: "200",
        last_error: null,
        consecutive_failures: "2",
        notes: "watch weekly",
        active: true,
        created_by: "user-1",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-02T00:00:00Z",
      },
    ])).toEqual([
      {
        id: "source-1",
        workspace_id: "default",
        brand_id: "brand-1",
        label: "ASV book",
        url: "https://example.com/asv.pdf",
        check_freq_hours: 24,
        last_checked_at: "2026-04-20T00:00:00Z",
        last_hash: "abc",
        last_etag: null,
        last_http_status: 200,
        last_error: null,
        consecutive_failures: 2,
        notes: "watch weekly",
        active: true,
        created_by: "user-1",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-02T00:00:00Z",
      },
    ]);
  });

  test("normalizes joined brand rows and filters malformed sources", () => {
    expect(normalizeSheetSourceWithBrandRows([
      {
        ...src({ id: "source-2", brand_id: "brand-2" }),
        qb_brands: [{ id: "brand-2", name: "Barko", code: "BARKO" }],
      },
      { id: "missing-required-fields", qb_brands: { name: "Bad", code: "BAD" } },
    ])).toEqual([
      {
        ...src({ id: "source-2", brand_id: "brand-2" }),
        brand_name: "Barko",
        brand_code: "BARKO",
      },
    ]);
  });

  test("normalizes event rows and rejects unknown event types", () => {
    expect(normalizeSheetWatchEventRows([
      {
        id: "event-1",
        workspace_id: "default",
        source_id: "source-1",
        event_type: "change_detected",
        detail: { hash: "abc", nested: [1, "ok", null] },
        price_sheet_id: "sheet-1",
        created_at: "2026-04-20T00:00:00Z",
      },
      {
        id: "event-2",
        workspace_id: "default",
        source_id: "source-1",
        event_type: "not_real",
        created_at: "2026-04-20T00:00:00Z",
      },
    ])).toEqual([
      {
        id: "event-1",
        workspace_id: "default",
        source_id: "source-1",
        event_type: "change_detected",
        detail: { hash: "abc", nested: [1, "ok", null] },
        price_sheet_id: "sheet-1",
        created_at: "2026-04-20T00:00:00Z",
      },
    ]);
  });
});

// ── detectHashChange ─────────────────────────────────────────────────────

describe("detectHashChange", () => {
  test("first_seen when no prior hash", () => {
    expect(detectHashChange(null, "abc")).toBe("first_seen");
    expect(detectHashChange(undefined, "abc")).toBe("first_seen");
    expect(detectHashChange("", "abc")).toBe("first_seen");
  });

  test("unchanged when hashes match", () => {
    expect(detectHashChange("abc", "abc")).toBe("unchanged");
  });

  test("changed when hashes differ", () => {
    expect(detectHashChange("abc", "def")).toBe("changed");
  });
});

// ── formatLastChecked ────────────────────────────────────────────────────

describe("formatLastChecked", () => {
  const now = new Date("2026-04-20T12:00:00Z");

  test("null → Never checked", () => {
    expect(formatLastChecked(null, now)).toBe("Never checked");
    expect(formatLastChecked(undefined, now)).toBe("Never checked");
  });

  test("under 60s → just now", () => {
    expect(formatLastChecked("2026-04-20T11:59:45Z", now)).toBe("Checked just now");
  });

  test("minutes ago", () => {
    expect(formatLastChecked("2026-04-20T11:45:00Z", now)).toBe("Checked 15m ago");
  });

  test("hours ago", () => {
    expect(formatLastChecked("2026-04-20T09:00:00Z", now)).toBe("Checked 3h ago");
  });

  test("days ago", () => {
    expect(formatLastChecked("2026-04-17T12:00:00Z", now)).toBe("Checked 3d ago");
  });

  test("future-dated is treated as just now", () => {
    expect(formatLastChecked("2026-05-01T00:00:00Z", now)).toBe("Checked just now");
  });
});

// ── isOverdue ────────────────────────────────────────────────────────────

describe("isOverdue", () => {
  const now = new Date("2026-04-20T12:00:00Z");

  test("inactive sources never overdue", () => {
    const s = src({ active: false, last_checked_at: null });
    expect(isOverdue(s, now)).toBe(false);
  });

  test("never-checked active source is overdue", () => {
    const s = src({ active: true, last_checked_at: null });
    expect(isOverdue(s, now)).toBe(true);
  });

  test("within cadence → not overdue", () => {
    const s = src({
      active: true,
      check_freq_hours: 24,
      last_checked_at: "2026-04-20T06:00:00Z", // 6h ago
    });
    expect(isOverdue(s, now)).toBe(false);
  });

  test("past cadence → overdue", () => {
    const s = src({
      active: true,
      check_freq_hours: 24,
      last_checked_at: "2026-04-19T06:00:00Z", // 30h ago
    });
    expect(isOverdue(s, now)).toBe(true);
  });

  test("exactly at cadence boundary → overdue", () => {
    const s = src({
      active: true,
      check_freq_hours: 24,
      last_checked_at: "2026-04-19T12:00:00Z", // exactly 24h ago
    });
    expect(isOverdue(s, now)).toBe(true);
  });
});

// ── summarizeSourceHealth ────────────────────────────────────────────────

describe("summarizeSourceHealth", () => {
  test("empty events → healthy, null timestamps", () => {
    const health = summarizeSourceHealth(
      { id: "s-1", consecutive_failures: 0 },
      [],
    );
    expect(health.isUnhealthy).toBe(false);
    expect(health.lastEventAt).toBeNull();
    expect(health.lastSuccessAt).toBeNull();
    expect(health.counts.checked_unchanged).toBe(0);
    expect(health.counts.error).toBe(0);
  });

  test("counts each event type", () => {
    const events = [
      evt({ event_type: "checked_unchanged", created_at: "2026-04-20T10:00:00Z" }),
      evt({ event_type: "checked_unchanged", created_at: "2026-04-19T10:00:00Z" }),
      evt({ event_type: "change_detected",   created_at: "2026-04-18T10:00:00Z" }),
      evt({ event_type: "sheet_extracted",   created_at: "2026-04-18T10:05:00Z" }),
      evt({ event_type: "error",             created_at: "2026-04-17T10:00:00Z" }),
      evt({ event_type: "manual_trigger",    created_at: "2026-04-16T10:00:00Z" }),
    ];
    const health = summarizeSourceHealth({ id: "s-1", consecutive_failures: 0 }, events);
    expect(health.counts.checked_unchanged).toBe(2);
    expect(health.counts.change_detected).toBe(1);
    expect(health.counts.sheet_extracted).toBe(1);
    expect(health.counts.error).toBe(1);
    expect(health.counts.manual_trigger).toBe(1);
  });

  test("isUnhealthy when consecutive_failures ≥ 3", () => {
    const health = summarizeSourceHealth(
      { id: "s-1", consecutive_failures: 3 },
      [evt({ event_type: "checked_unchanged" })],
    );
    expect(health.isUnhealthy).toBe(true);
  });

  test("isUnhealthy when most recent event is error", () => {
    const events = [
      evt({ event_type: "error",             created_at: "2026-04-20T10:00:00Z" }),
      evt({ event_type: "checked_unchanged", created_at: "2026-04-19T10:00:00Z" }),
    ];
    const health = summarizeSourceHealth({ id: "s-1", consecutive_failures: 1 }, events);
    expect(health.isUnhealthy).toBe(true);
  });

  test("lastEventAt + lastSuccessAt track correctly", () => {
    // Feed in desc order (caller convention)
    const events = [
      evt({ event_type: "error",             created_at: "2026-04-20T10:00:00Z" }),
      evt({ event_type: "checked_unchanged", created_at: "2026-04-19T10:00:00Z" }),
      evt({ event_type: "sheet_extracted",   created_at: "2026-04-18T10:00:00Z" }),
    ];
    const health = summarizeSourceHealth({ id: "s-1", consecutive_failures: 0 }, events);
    expect(health.lastEventAt).toBe("2026-04-20T10:00:00Z");
    expect(health.lastSuccessAt).toBe("2026-04-19T10:00:00Z");
  });
});
