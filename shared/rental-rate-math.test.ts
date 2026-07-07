import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeBillableDays,
  greedyPartition,
  optimizeCharge,
  reconcileFinalInvoice,
  type ChargeSegment,
  type RateBook,
} from "./rental-rate-math";

type VectorSegment = { unit: string; qty: number; unit_cents: number };
type OptimizeCase = {
  id: string;
  rate_book: RateBook;
  billable_days: number;
  expected: {
    total: number;
    segments: VectorSegment[];
    fired: boolean;
    beaten_alternative: { total: number; segments: VectorSegment[] } | null;
  };
};

const vectors = JSON.parse(
  readFileSync(join(import.meta.dir, "rental-rate-math.vectors.json"), "utf8"),
) as {
  optimize_cases: OptimizeCase[];
  reconcile_cases: Array<{
    id: string;
    rate_book: RateBook;
    entire_billable_days: number;
    already_invoiced: number;
    expected: { entire_optimum: number; entire_segments: VectorSegment[]; final_invoice: number };
  }>;
  exchange_cases: Array<{
    id: string;
    segments: Array<{ rate_book: RateBook; billable_days: number; expected: OptimizeCase["expected"] }>;
    expected_contract_total: number;
  }>;
};

const durationVectors = JSON.parse(
  readFileSync(join(import.meta.dir, "rental-duration.vectors.json"), "utf8"),
) as {
  cases: Array<{
    id: string;
    input: { start_at: string; clock_end_at: string; grace_hours?: number; minimum_days?: number };
    expected_billable_days: number;
  }>;
};

function normalize(segments: ChargeSegment[] | VectorSegment[]) {
  return segments.map((s) => ({ unit: s.unit, qty: s.qty, unit_cents: s.unit_cents }));
}

describe("rental-rate-math optimizer (canonical) vs shared vectors", () => {
  for (const c of vectors.optimize_cases) {
    it(c.id, () => {
      const result = optimizeCharge(c.billable_days, c.rate_book);
      expect(result.total).toBe(c.expected.total);
      expect(normalize(result.segments)).toEqual(normalize(c.expected.segments));
      expect(result.fired).toBe(c.expected.fired);
      if (c.expected.beaten_alternative == null) {
        expect(result.beaten_alternative).toBeNull();
      } else {
        expect(result.beaten_alternative?.total).toBe(c.expected.beaten_alternative.total);
        expect(normalize(result.beaten_alternative?.segments ?? [])).toEqual(
          normalize(c.expected.beaten_alternative.segments),
        );
      }
    });
  }
});

describe("cycle reconciliation vs shared vectors", () => {
  for (const c of vectors.reconcile_cases) {
    it(c.id, () => {
      const { entire, final_invoice } = reconcileFinalInvoice(
        c.entire_billable_days,
        c.rate_book,
        c.already_invoiced,
      );
      expect(entire.total).toBe(c.expected.entire_optimum);
      expect(normalize(entire.segments)).toEqual(normalize(c.expected.entire_segments));
      expect(final_invoice).toBe(c.expected.final_invoice);
    });
  }
});

describe("cross-class exchange vs shared vectors", () => {
  for (const c of vectors.exchange_cases) {
    it(c.id, () => {
      let contractTotal = 0;
      for (const segment of c.segments) {
        const result = optimizeCharge(segment.billable_days, segment.rate_book);
        expect(result.total).toBe(segment.expected.total);
        expect(normalize(result.segments)).toEqual(normalize(segment.expected.segments));
        expect(result.fired).toBe(segment.expected.fired);
        contractTotal += result.total;
      }
      expect(contractTotal).toBe(c.expected_contract_total);
    });
  }
});

describe("duration resolver vs shared vectors", () => {
  for (const c of durationVectors.cases) {
    it(c.id, () => {
      expect(computeBillableDays(c.input)).toBe(c.expected_billable_days);
    });
  }
});

describe("contract edges not expressible as vectors", () => {
  it("throws on an all-unavailable rate book", () => {
    expect(() => optimizeCharge(5, { day: null, week: 0, month: undefined })).toThrow();
  });

  it("zero billable days is a zero charge that never fires", () => {
    const result = optimizeCharge(0, { day: 10000, week: 30000, month: 90000 });
    expect(result.total).toBe(0);
    expect(result.segments).toEqual([]);
    expect(result.fired).toBe(false);
  });

  it("greedy partition is null when no exact partition exists (blocks-only book, non-multiple duration)", () => {
    expect(greedyPartition(10, { day: null, week: 30000, month: 90000 })).toBeNull();
    // ...and the optimizer still covers by overshoot without firing.
    const result = optimizeCharge(10, { day: null, week: 30000, month: 90000 });
    expect(result.total).toBe(60000);
    expect(result.fired).toBe(false);
  });
});

import { assembleCharges } from "./rental-rate-math";

describe("charge assembler contract (§2.3)", () => {
  const base = optimizeCharge(26, { day: 10000, week: 30000, month: 90000 }); // 1 month, 90000

  it("waiver percentage applies to the optimized base EXCLUDING ancillaries", () => {
    const charges = assembleCharges({
      base,
      damage_waiver_accepted: true,
      damage_waiver_rate: 0.14,
      delivery_fee_cents: 25000, // must NOT enter the waiver base
    });
    expect(charges.damage_waiver_charge_cents).toBe(12600); // 14% of 90000 only
    expect(charges.subtotal_cents).toBe(90000 + 12600 + 25000);
  });

  it("meter overage is additive and never mutates the optimized base", () => {
    const charges = assembleCharges({
      base,
      hours_used: 230.5,
      included_hours: 224,
      overage_hourly_cents: 4500,
    });
    expect(charges.rental_charge_cents).toBe(90000);
    expect(charges.overage_charge_cents).toBe(29250); // 6.5h * 4500, rounded half-up at the line
  });

  it("sub-rental bills cost plus markup with line-level rounding", () => {
    const charges = assembleCharges({
      base,
      sub_rental_cost_cents: 33333,
      sub_rental_markup_rate: 0.15,
    });
    expect(charges.sub_rental_charge_cents).toBe(38333); // 33333 * 1.15 = 38332.95 → half-up
  });
});
