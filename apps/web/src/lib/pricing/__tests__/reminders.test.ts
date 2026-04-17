/**
 * Unit tests: price sheet reminder cadence engine
 *
 * Tests currentQuarterStart, quarterLabel, computeUrgency, getPendingUpdates.
 * DB I/O is replaced with stubs — no real Supabase calls.
 */

import { describe, it, expect } from "bun:test";
import {
  currentQuarterStart,
  quarterLabel,
  annualLabel,
  computeUrgency,
  getPendingUpdates,
} from "../price-sheet-reminders.ts";

// ── Quarter helpers ───────────────────────────────────────────────────────────

describe("currentQuarterStart", () => {
  it("Q1: Jan 15 → Jan 1", () => {
    const d = new Date("2026-01-15");
    expect(currentQuarterStart(d).toISOString().slice(0, 10)).toBe("2026-01-01");
  });
  it("Q1: Mar 31 → Jan 1", () => {
    expect(currentQuarterStart(new Date("2026-03-31")).toISOString().slice(0, 10)).toBe("2026-01-01");
  });
  it("Q2: Apr 1 → Apr 1", () => {
    expect(currentQuarterStart(new Date("2026-04-01")).toISOString().slice(0, 10)).toBe("2026-04-01");
  });
  it("Q2: Jun 30 → Apr 1", () => {
    expect(currentQuarterStart(new Date("2026-06-30")).toISOString().slice(0, 10)).toBe("2026-04-01");
  });
  it("Q3: Jul 1 → Jul 1", () => {
    expect(currentQuarterStart(new Date("2026-07-01")).toISOString().slice(0, 10)).toBe("2026-07-01");
  });
  it("Q4: Oct 15 → Oct 1", () => {
    expect(currentQuarterStart(new Date("2026-10-15")).toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("quarterLabel", () => {
  it("Q1 2026", () => expect(quarterLabel(new Date("2026-01-01"))).toBe("Q1 2026"));
  it("Q2 2026", () => expect(quarterLabel(new Date("2026-04-01"))).toBe("Q2 2026"));
  it("Q3 2026", () => expect(quarterLabel(new Date("2026-07-01"))).toBe("Q3 2026"));
  it("Q4 2026", () => expect(quarterLabel(new Date("2026-10-01"))).toBe("Q4 2026"));
});

describe("annualLabel", () => {
  it("Annual 2026", () => expect(annualLabel(new Date("2026-06-01"))).toBe("Annual 2026"));
});

// ── computeUrgency ────────────────────────────────────────────────────────────

describe("computeUrgency — quarterly", () => {
  const today = new Date("2026-04-17"); // Q2 2026

  it("overdue when no last publish", () => {
    expect(computeUrgency("quarterly", null, today)).toBe("overdue");
  });

  it("overdue when last publish is in Q1 (before Q2 start)", () => {
    expect(computeUrgency("quarterly", new Date("2026-03-15"), today)).toBe("overdue");
  });

  it("current when last publish is in Q2", () => {
    expect(computeUrgency("quarterly", new Date("2026-04-05"), today)).toBe("current");
  });

  it("overdue when last publish is from last year", () => {
    expect(computeUrgency("quarterly", new Date("2025-12-01"), today)).toBe("overdue");
  });
});

describe("computeUrgency — annual", () => {
  const today = new Date("2026-04-17");

  it("overdue when no last publish", () => {
    expect(computeUrgency("annual", null, today)).toBe("overdue");
  });

  it("overdue when last publish is from 2025", () => {
    expect(computeUrgency("annual", new Date("2025-06-01"), today)).toBe("overdue");
  });

  it("current when last publish is in 2026", () => {
    expect(computeUrgency("annual", new Date("2026-01-15"), today)).toBe("current");
  });
});

describe("computeUrgency — 6mo", () => {
  const today = new Date("2026-04-17");

  it("overdue when no last publish", () => {
    expect(computeUrgency("6mo", null, today)).toBe("overdue");
  });

  it("overdue when last publish > 180 days ago", () => {
    const old = new Date(today.getTime() - 200 * 24 * 60 * 60 * 1000);
    expect(computeUrgency("6mo", old, today)).toBe("overdue");
  });

  it("upcoming when last publish 155 days ago", () => {
    const recent = new Date(today.getTime() - 155 * 24 * 60 * 60 * 1000);
    expect(computeUrgency("6mo", recent, today)).toBe("upcoming");
  });

  it("current when last publish 90 days ago", () => {
    const recent = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(computeUrgency("6mo", recent, today)).toBe("current");
  });
});

// ── getPendingUpdates ─────────────────────────────────────────────────────────

const FAKE_BRANDS = [
  { id: "asv-id",     code: "ASV",     name: "ASV" },
  { id: "yan-id",     code: "YANMAR",  name: "Yanmar Compact Equipment" },
  { id: "dev-id",     code: "DEVELON", name: "Develon (formerly Doosan)" },
];

/** Stub returning no published sheets — all brands are overdue */
function stubNoSheets() {
  return {
    from: (table: string) => ({
      select: () => {
        if (table === "qb_brands") {
          return { in: () => Promise.resolve({ data: FAKE_BRANDS, error: null }) };
        }
        // qb_price_sheets
        return {
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      },
    }),
  };
}

/** Stub with ASV programs published this quarter, everything else overdue */
function stubASVCurrent(today: Date) {
  const asvSheet = {
    brand_id: "asv-id",
    sheet_type: "retail_programs",
    published_at: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  };
  return {
    from: (table: string) => ({
      select: () => {
        if (table === "qb_brands") {
          return { in: () => Promise.resolve({ data: FAKE_BRANDS, error: null }) };
        }
        return {
          eq: () => ({
            order: () => Promise.resolve({ data: [asvSheet], error: null }),
          }),
        };
      },
    }),
  };
}

describe("getPendingUpdates", () => {
  const today = new Date("2026-04-17"); // Q2 2026

  it("returns 4 overdue items when nothing has been uploaded", async () => {
    const results = await getPendingUpdates(stubNoSheets() as any, today);
    // ASV programs, ASV price book, Yanmar programs, Develon programs — all overdue
    expect(results.length).toBe(4);
    expect(results.every((r) => r.urgency === "overdue")).toBe(true);
  });

  it("filters out current items", async () => {
    const results = await getPendingUpdates(stubASVCurrent(today) as any, today);
    // ASV programs is current → filtered; remaining 3 are overdue
    const asv = results.find((r) => r.brandCode === "ASV" && r.sheetType === "retail_programs");
    expect(asv).toBeUndefined();
    expect(results.length).toBe(3);
  });

  it("ASV programs overdue shows Q2 2026 label", async () => {
    const results = await getPendingUpdates(stubNoSheets() as any, today);
    const asvPrograms = results.find((r) => r.brandCode === "ASV" && r.sheetType === "retail_programs");
    expect(asvPrograms?.expectedPeriod).toBe("Q2 2026");
    expect(asvPrograms?.message).toMatch(/Q2 2026/);
    expect(asvPrograms?.message).toMatch(/never uploaded/i);
  });

  it("ASV price book overdue shows Annual 2026 label", async () => {
    const results = await getPendingUpdates(stubNoSheets() as any, today);
    const asvBook = results.find((r) => r.brandCode === "ASV" && r.sheetType === "price_book");
    expect(asvBook?.expectedPeriod).toBe("Annual 2026");
  });

  it("returns empty array when brands table errors", async () => {
    const stub = {
      from: () => ({
        select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "DB down" } }) }),
      }),
    };
    const results = await getPendingUpdates(stub as any, today);
    expect(results).toHaveLength(0);
  });
});
