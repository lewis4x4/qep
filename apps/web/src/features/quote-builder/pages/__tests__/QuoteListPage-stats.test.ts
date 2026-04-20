import { describe, expect, test } from "bun:test";
import { computeStats } from "../QuoteListPage";
import type { QuoteListItem } from "../../../../../../../shared/qep-moonshot-contracts";

function q(partial: Partial<QuoteListItem> & Pick<QuoteListItem, "id" | "status">): QuoteListItem {
  return {
    id:                partial.id,
    quote_number:      partial.quote_number ?? null,
    customer_name:     partial.customer_name ?? null,
    customer_company:  partial.customer_company ?? null,
    status:            partial.status,
    net_total:         partial.net_total ?? 0,
    equipment_summary: partial.equipment_summary ?? "—",
    entry_mode:        partial.entry_mode ?? null,
    created_at:        partial.created_at ?? new Date().toISOString(),
  };
}

describe("computeStats", () => {
  test("empty list returns zeros", () => {
    const s = computeStats([]);
    expect(s).toEqual({
      total: 0, open: 0, pipelineValue: 0, winsThisMonth: 0, winsValueMTD: 0,
    });
  });

  test("open statuses count toward open + pipeline value", () => {
    const s = computeStats([
      q({ id: "1", status: "draft",    net_total: 10_000 }),
      q({ id: "2", status: "ready",    net_total: 20_000 }),
      q({ id: "3", status: "sent",     net_total: 30_000 }),
      q({ id: "4", status: "viewed",   net_total: 40_000 }),
      q({ id: "5", status: "accepted", net_total: 50_000 }), // not open
      q({ id: "6", status: "rejected", net_total: 60_000 }), // not open
    ]);
    expect(s.total).toBe(6);
    expect(s.open).toBe(4);
    expect(s.pipelineValue).toBe(100_000); // 10+20+30+40
  });

  test("accepted in current month counts as wins MTD", () => {
    const now = new Date();
    const earlierThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 10, 0, 0);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10, 0, 0);
    const s = computeStats([
      q({ id: "1", status: "accepted", net_total: 100_000, created_at: earlierThisMonth.toISOString() }),
      q({ id: "2", status: "accepted", net_total: 50_000,  created_at: lastMonth.toISOString() }),
    ]);
    expect(s.winsThisMonth).toBe(1);
    expect(s.winsValueMTD).toBe(100_000);
  });

  test("null net_total contributes 0 to pipeline", () => {
    const s = computeStats([
      q({ id: "1", status: "sent", net_total: null }),
      q({ id: "2", status: "sent", net_total: 30_000 }),
    ]);
    expect(s.open).toBe(2);
    expect(s.pipelineValue).toBe(30_000);
  });

  test("terminal statuses never bump open or pipeline", () => {
    const s = computeStats([
      q({ id: "1", status: "expired",  net_total: 10_000 }),
      q({ id: "2", status: "rejected", net_total: 20_000 }),
    ]);
    expect(s.open).toBe(0);
    expect(s.pipelineValue).toBe(0);
  });
});
