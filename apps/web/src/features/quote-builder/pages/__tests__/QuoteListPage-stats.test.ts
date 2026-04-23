import { describe, expect, test } from "bun:test";
import {
  applyStatFilters,
  computeStats,
  getDefaultQuoteSort,
  getQuoteStatusLabel,
  isMissingContact,
  renderContactName,
  sortQuoteItems,
} from "../QuoteListPage";
import type { QuoteListItem } from "../../../../../../../shared/qep-moonshot-contracts";

function q(partial: Partial<QuoteListItem> & Pick<QuoteListItem, "id" | "status">): QuoteListItem {
  return {
    id: partial.id,
    quote_number: partial.quote_number ?? null,
    customer_name: partial.customer_name ?? null,
    customer_company: partial.customer_company ?? null,
    contact_name: partial.contact_name ?? null,
    status: partial.status,
    net_total: partial.net_total ?? 0,
    equipment_summary: partial.equipment_summary ?? "Case SR175",
    entry_mode: partial.entry_mode ?? null,
    created_at: partial.created_at ?? "2026-04-01T10:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-04-02T10:00:00.000Z",
    accepted_at: partial.accepted_at ?? null,
    win_probability_score: partial.win_probability_score ?? null,
  };
}

describe("computeStats", () => {
  test("empty list returns zeros", () => {
    expect(computeStats([], new Date("2026-04-23T12:00:00Z"))).toEqual({
      total: 0,
      open: 0,
      pipelineValue: 0,
      winsThisMonth: 0,
      winsValueMTD: 0,
    });
  });

  test("pipeline uses only draft, ready, sent, and pending approval", () => {
    const s = computeStats([
      q({ id: "1", status: "draft", net_total: 10_000 }),
      q({ id: "2", status: "ready", net_total: 20_000 }),
      q({ id: "3", status: "sent", net_total: 30_000 }),
      q({ id: "4", status: "pending_approval", net_total: 40_000 }),
      q({ id: "5", status: "viewed", net_total: 50_000 }),
      q({ id: "6", status: "accepted", net_total: 60_000, accepted_at: "2026-04-05T10:00:00Z" }),
    ], new Date("2026-04-23T12:00:00Z"));

    expect(s.total).toBe(6);
    expect(s.open).toBe(5);
    expect(s.pipelineValue).toBe(100_000);
  });

  test("wins MTD uses accepted_at, not created_at", () => {
    const s = computeStats([
      q({ id: "1", status: "accepted", net_total: 100_000, created_at: "2026-03-01T10:00:00Z", accepted_at: "2026-04-01T10:00:00Z" }),
      q({ id: "2", status: "accepted", net_total: 50_000, created_at: "2026-04-01T10:00:00Z", accepted_at: "2026-03-31T10:00:00Z" }),
      q({ id: "3", status: "accepted", net_total: 75_000, created_at: "2026-04-01T10:00:00Z", accepted_at: null }),
    ], new Date("2026-04-23T12:00:00Z"));

    expect(s.winsThisMonth).toBe(1);
    expect(s.winsValueMTD).toBe(100_000);
  });

  test("terminal statuses do not count as open", () => {
    const s = computeStats([
      q({ id: "1", status: "accepted" }),
      q({ id: "2", status: "declined" }),
      q({ id: "3", status: "rejected" }),
      q({ id: "4", status: "expired" }),
      q({ id: "5", status: "archived" }),
      q({ id: "6", status: "draft" }),
    ], new Date("2026-04-23T12:00:00Z"));

    expect(s.open).toBe(1);
  });
});

describe("stat filters", () => {
  test("multiple stat card filters intersect", () => {
    const rows = [
      q({ id: "draft", status: "draft" }),
      q({ id: "won", status: "accepted", accepted_at: "2026-04-10T10:00:00Z" }),
      q({ id: "expired", status: "expired" }),
    ];
    const filtered = applyStatFilters(rows, new Set(["open", "pipeline"]), new Date("2026-04-23T12:00:00Z"));
    expect(filtered.map((row) => row.id)).toEqual(["draft"]);
  });
});

describe("quote list rendering helpers", () => {
  test("status labels are title case and never raw enum values", () => {
    expect(getQuoteStatusLabel("pending_approval")).toBe("Pending Approval");
    expect(getQuoteStatusLabel("draft")).toBe("Draft");
    expect(getQuoteStatusLabel("accepted")).toBe("Accepted");
  });

  test("missing contact renders No contact", () => {
    const item = q({ id: "1", status: "sent", customer_name: null, contact_name: null });
    expect(renderContactName(item)).toBe("No contact");
    expect(isMissingContact(item)).toBe(true);
  });

  test("default sort is updated descending", () => {
    expect(getDefaultQuoteSort()).toEqual({ key: "updated", direction: "desc" });
    const sorted = sortQuoteItems([
      q({ id: "old", status: "draft", updated_at: "2026-04-01T10:00:00Z" }),
      q({ id: "new", status: "draft", updated_at: "2026-04-03T10:00:00Z" }),
    ], getDefaultQuoteSort());
    expect(sorted.map((row) => row.id)).toEqual(["new", "old"]);
  });
});
