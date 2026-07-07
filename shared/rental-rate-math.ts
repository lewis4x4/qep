/**
 * Rental rate math — CANONICAL implementation (Stream L / L1, blueprint §2.2).
 *
 * When production disputes an amount, THIS module is truth; the SQL
 * `rental_optimize_charge` function is a verified mirror for in-DB reporting
 * and backfill. Both consume `shared/rental-rate-math.vectors.json`
 * (append-only, stable ids); divergence fails the build gate.
 *
 * Formulation: COVERAGE, not partition. Minimize
 *   28m·R_month + 7w·R_week + d·R_day  subject to  28m + 7w + d ≥ D.
 * Overshoot is legal (26 days bills as one month when cheaper). The search
 * enumerates m ∈ [0, ⌈D/28⌉], w ∈ [0, ⌈D/7⌉] with d determined as
 * max(0, D − 28m − 7w) — exhaustive and correct for ARBITRARY positive rate
 * books (inverted ladders included); no dominance shortcuts.
 *
 * Absent tiers (null/undefined/≤0 rate) are UNAVAILABLE — never enumerated,
 * never treated as infinitely priced placeholders.
 *
 * Tie-break: fewest segment lines, then largest blocks first (months, weeks,
 * days). `fired` is STRICT: the optimum beat the greedy largest-block exact
 * partition by > 0 cents — ties never fire, so a savings line never prints
 * "$0". All money is integer cents; this module performs integer arithmetic
 * only. Rounding (half-up, per charge line) is the assembler's job at its one
 * defined point — nothing here rounds.
 *
 * Duration is an INPUT: `computeBillableDays` (the L1 duration resolver) owns
 * the off-rent clock, grace, and minimum-period rules and has its own vector
 * set (`shared/rental-duration.vectors.json`). Calendar policy must never
 * leak into the optimizer.
 */

export interface RateBook {
  /** Cents per day; null/undefined/≤0 means the tier is unavailable. */
  day?: number | null;
  /** Cents per 7-day week. */
  week?: number | null;
  /** Cents per 28-day month. */
  month?: number | null;
}

export type RateUnit = "month" | "week" | "day";

export interface ChargeSegment {
  unit: RateUnit;
  qty: number;
  unit_cents: number;
}

export interface OptimizedCharge {
  total: number;
  segments: ChargeSegment[];
  /** True only when the optimum STRICTLY beat the greedy exact partition. */
  fired: boolean;
  /** The greedy partition a meter-style biller would have charged; only
   * present when `fired` — the sole legal basis for a printed savings line. */
  beaten_alternative: { total: number; segments: ChargeSegment[] } | null;
}

const DAYS_PER_MONTH = 28;
const DAYS_PER_WEEK = 7;

function tierRate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : null;
}

function buildSegments(
  m: number,
  w: number,
  d: number,
  month: number | null,
  week: number | null,
  day: number | null,
): ChargeSegment[] {
  const segments: ChargeSegment[] = [];
  if (m > 0 && month != null) segments.push({ unit: "month", qty: m, unit_cents: month });
  if (w > 0 && week != null) segments.push({ unit: "week", qty: w, unit_cents: week });
  if (d > 0 && day != null) segments.push({ unit: "day", qty: d, unit_cents: day });
  return segments;
}

/**
 * Greedy largest-AVAILABLE-block exact partition (months, then weeks, then
 * days). Returns null when the book cannot exactly partition the duration
 * (e.g., no day tier and a remainder) — in that case `fired` has no meter
 * alternative to compare against.
 */
export function greedyPartition(billableDays: number, book: RateBook):
  { total: number; segments: ChargeSegment[] } | null {
  const month = tierRate(book.month);
  const week = tierRate(book.week);
  const day = tierRate(book.day);

  let remaining = billableDays;
  const m = month != null ? Math.floor(remaining / DAYS_PER_MONTH) : 0;
  remaining -= m * DAYS_PER_MONTH;
  const w = week != null ? Math.floor(remaining / DAYS_PER_WEEK) : 0;
  remaining -= w * DAYS_PER_WEEK;
  const d = remaining;
  if (d > 0 && day == null) return null;

  const total = m * (month ?? 0) + w * (week ?? 0) + d * (day ?? 0);
  return { total, segments: buildSegments(m, w, d, month, week, day) };
}

/**
 * The optimizer. Throws when the book has no usable tier.
 */
export function optimizeCharge(billableDays: number, book: RateBook): OptimizedCharge {
  if (!Number.isInteger(billableDays) || billableDays < 0) {
    throw new Error(`billableDays must be a non-negative integer, got ${billableDays}`);
  }
  const month = tierRate(book.month);
  const week = tierRate(book.week);
  const day = tierRate(book.day);
  if (month == null && week == null && day == null) {
    throw new Error("rate book has no usable tier (day/week/month all unavailable)");
  }
  if (billableDays === 0) {
    return { total: 0, segments: [], fired: false, beaten_alternative: null };
  }

  const mMax = month != null ? Math.ceil(billableDays / DAYS_PER_MONTH) : 0;
  const wMax = week != null ? Math.ceil(billableDays / DAYS_PER_WEEK) : 0;

  let best: { total: number; m: number; w: number; d: number; lines: number } | null = null;

  for (let m = 0; m <= mMax; m++) {
    for (let w = 0; w <= wMax; w++) {
      const covered = m * DAYS_PER_MONTH + w * DAYS_PER_WEEK;
      const dNeeded = Math.max(0, billableDays - covered);
      // Days fill the remainder exactly; when the day tier is unavailable the
      // blocks alone must cover.
      if (dNeeded > 0 && day == null) continue;
      const d = dNeeded;
      const total = m * (month ?? 0) + w * (week ?? 0) + d * (day ?? 0);
      const lines = (m > 0 ? 1 : 0) + (w > 0 ? 1 : 0) + (d > 0 ? 1 : 0);

      if (
        best == null ||
        total < best.total ||
        (total === best.total &&
          (lines < best.lines ||
            (lines === best.lines &&
              (m > best.m || (m === best.m && (w > best.w || (w === best.w && d > best.d)))))))
      ) {
        best = { total, m, w, d, lines };
      }
    }
  }

  if (best == null) {
    throw new Error("no covering combination exists for the given rate book");
  }

  const segments = buildSegments(best.m, best.w, best.d, month, week, day);
  const partition = greedyPartition(billableDays, book);
  const fired = partition != null && best.total < partition.total;

  return {
    total: best.total,
    segments,
    fired,
    beaten_alternative: fired && partition != null
      ? { total: partition.total, segments: partition.segments }
      : null,
  };
}

/**
 * Cycle-billing reconciliation (blueprint §2.2): the final invoice reconciles
 * to the GLOBAL optimum for the entire billable duration, never to a stub
 * fragment. Floored at zero — credit memos are a human decision, never an
 * automatic negative invoice. Invariant: total billed always equals the
 * optimum for the elapsed duration.
 */
export function reconcileFinalInvoice(
  entireBillableDays: number,
  book: RateBook,
  alreadyInvoicedCents: number,
): { entire: OptimizedCharge; final_invoice: number } {
  if (!Number.isInteger(alreadyInvoicedCents) || alreadyInvoicedCents < 0) {
    throw new Error("alreadyInvoicedCents must be a non-negative integer");
  }
  const entire = optimizeCharge(entireBillableDays, book);
  return { entire, final_invoice: Math.max(0, entire.total - alreadyInvoicedCents) };
}

// ─── Duration resolver (own stage, own vectors) ─────────────────────────────

export interface DurationInput {
  /** Contract clock start (check-out). ISO timestamp. */
  start_at: string;
  /** Clock end: off_rent_at when the clock was stopped, else return/now. */
  clock_end_at: string;
  /** Hours forgiven before the day ceiling applies (workspace policy). */
  grace_hours?: number;
  /** Contract/rate-rule minimum rental period in days. */
  minimum_days?: number;
}

/**
 * Billable days v1: elapsed hours minus grace, ceiling to whole days,
 * same-day minimum of 1, then the contractual minimum. Future calendar rules
 * (5-day billing weeks, holidays) land HERE — never in the optimizer.
 */
export function computeBillableDays(input: DurationInput): number {
  const start = Date.parse(input.start_at);
  const end = Date.parse(input.clock_end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("invalid start_at/clock_end_at timestamp");
  }
  if (end < start) throw new Error("clock_end_at precedes start_at");

  const graceMs = Math.max(0, input.grace_hours ?? 0) * 3_600_000;
  const effectiveMs = Math.max(0, end - start - graceMs);
  const days = Math.max(1, Math.ceil(effectiveMs / 86_400_000));
  return Math.max(days, Math.max(0, input.minimum_days ?? 0));
}

// ─── Charge assembler (blueprint §2.3) ──────────────────────────────────────

export interface AssemblerInput {
  /** Optimized base charge for the (segment) duration. */
  base: OptimizedCharge;
  /** Meter overage — ADDITIVE on top of the optimized base, never an optimizer input. */
  hours_used?: number | null;
  included_hours?: number | null;
  overage_hourly_cents?: number | null;
  /** Damage waiver / RPP: percentage AS A FRACTION (0.14 = 14%) of the
   * optimized base rental charge, EXCLUDING ancillaries — the named base. */
  damage_waiver_accepted?: boolean;
  damage_waiver_rate?: number | null;
  environmental_fee_cents?: number | null;
  delivery_fee_cents?: number | null;
  pickup_fee_cents?: number | null;
  fuel_cents?: number | null;
  cleaning_cents?: number | null;
  damage_cents?: number | null;
  sub_rental_cost_cents?: number | null;
  sub_rental_markup_rate?: number | null;
  discount_cents?: number | null;
}

/** Mirrors the rental_invoices charge decomposition columns. */
export interface AssembledCharges {
  rental_charge_cents: number;
  overage_charge_cents: number;
  damage_waiver_charge_cents: number;
  delivery_charge_cents: number;
  pickup_charge_cents: number;
  fuel_charge_cents: number;
  cleaning_charge_cents: number;
  damage_charge_cents: number;
  sub_rental_charge_cents: number;
  other_charge_cents: number;
  discount_cents: number;
  subtotal_cents: number;
}

/** THE one rounding point in the pipeline: per charge line, half-up. */
function roundLine(value: number): number {
  return Math.round(value);
}

function centsOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

export function assembleCharges(input: AssemblerInput): AssembledCharges {
  const rental = input.base.total;

  const overageHours = Math.max(0, (input.hours_used ?? 0) - (input.included_hours ?? 0));
  const overage = input.overage_hourly_cents
    ? roundLine(overageHours * centsOrZero(input.overage_hourly_cents))
    : 0;

  const waiver = input.damage_waiver_accepted && input.damage_waiver_rate
    ? roundLine(rental * input.damage_waiver_rate) // % of optimized base, excl. ancillaries
    : 0;

  const subRentalCost = centsOrZero(input.sub_rental_cost_cents);
  const subRental = subRentalCost > 0
    ? roundLine(subRentalCost * (1 + Math.max(0, input.sub_rental_markup_rate ?? 0)))
    : 0;

  const lines: AssembledCharges = {
    rental_charge_cents: rental,
    overage_charge_cents: overage,
    damage_waiver_charge_cents: waiver,
    delivery_charge_cents: centsOrZero(input.delivery_fee_cents),
    pickup_charge_cents: centsOrZero(input.pickup_fee_cents),
    fuel_charge_cents: centsOrZero(input.fuel_cents),
    cleaning_charge_cents: centsOrZero(input.cleaning_cents),
    damage_charge_cents: centsOrZero(input.damage_cents),
    sub_rental_charge_cents: subRental,
    other_charge_cents: centsOrZero(input.environmental_fee_cents),
    discount_cents: centsOrZero(input.discount_cents),
    subtotal_cents: 0,
  };
  lines.subtotal_cents =
    lines.rental_charge_cents + lines.overage_charge_cents + lines.damage_waiver_charge_cents +
    lines.delivery_charge_cents + lines.pickup_charge_cents + lines.fuel_charge_cents +
    lines.cleaning_charge_cents + lines.damage_charge_cents + lines.sub_rental_charge_cents +
    lines.other_charge_cents - lines.discount_cents;
  return lines;
}
