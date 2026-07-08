/**
 * Rental billing core (Stream L / L5, blueprint §3) — PURE planning logic.
 *
 * The rental-billing-runner edge function is a thin I/O wrapper around
 * planNextInvoice(): deterministic money stays unit-testable in Bun, and the
 * TS rate math (shared/rental-rate-math.ts) remains the single canon.
 *
 * Rules encoded here:
 *   * 28-day cycles bill in arrears: interim invoice N covers
 *     [anchor + 28N, anchor + 28N + 27] and is due once that period has
 *     fully elapsed while the clock is still running.
 *   * The FINAL invoice reconciles to the GLOBAL optimum for the entire
 *     billable duration (off-rent stops the clock) minus everything already
 *     invoiced, floored at zero — never a stub-period optimization.
 *   * Ancillaries per the assembler contract: delivery fee rides the FIRST
 *     invoice, pickup fee rides the final; meter overage is additive per
 *     line; damage waiver is % of the rental base only; return fuel/cleaning
 *     always bill, damage bills ONLY when disposition = customer_billable
 *     (mig 772 pin: nothing invoices while pending).
 *   * demo/loaner contracts bill $0 base (no usable book) but still carry
 *     return charges on the final invoice.
 */
import {
  assembleCharges,
  computeBillableDays,
  optimizeCharge,
  reconcileFinalInvoice,
  type AssembledCharges,
  type OptimizedCharge,
  type RateBook,
} from "./rental-rate-math.ts";

const DAY_MS = 86_400_000;
const CYCLE_DAYS = 28;

export interface BillingContractSnapshot {
  id: string;
  contract_number: string | null;
  contract_type: string;
  lifecycle_state: string;
  on_rent_at: string | null;
  off_rent_at: string | null;
  returned_at: string | null;
  /** Dollars, as stored on rental_contracts.agreed_* */
  agreed_daily_rate: number | null;
  agreed_weekly_rate: number | null;
  agreed_monthly_rate: number | null;
  delivery_fee_cents: number | null;
  pickup_fee_cents: number | null;
  damage_waiver_accepted: boolean | null;
  damage_waiver_rate_pct: number | null;
}

export interface BillingLineSnapshot {
  included_hours: number | null;
  outbound_meter_hours: number | null;
  return_meter_hours: number | null;
  overage_hourly_rate_cents: number | null;
}

export interface PriorInvoicesSummary {
  count: number;
  /** ISO date of the latest period_end already invoiced, if any. */
  last_period_end: string | null;
  /** Σ rental_charge_cents already invoiced (reconciliation base). */
  rental_charge_cents_total: number;
}

export interface ReturnChargesSnapshot {
  fuel_charge_cents: number | null;
  cleaning_charge_cents: number | null;
  damage_charge_cents: number | null;
  environmental_fee_cents: number | null;
  damage_disposition: string | null;
}

export interface InvoicePlan {
  kind: "interim" | "final";
  period_start: string; // ISO date
  period_end: string;   // ISO date
  billable_days: number;
  base: OptimizedCharge;
  charges: AssembledCharges;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function bookFromContract(c: BillingContractSnapshot): RateBook {
  const toCents = (dollars: number | null) =>
    dollars != null && dollars > 0 ? Math.round(dollars * 100) : null;
  return {
    day: toCents(c.agreed_daily_rate),
    week: toCents(c.agreed_weekly_rate),
    month: toCents(c.agreed_monthly_rate),
  };
}

function hasUsableTier(book: RateBook): boolean {
  return [book.day, book.week, book.month].some(
    (tier) => typeof tier === "number" && tier > 0,
  );
}

function lineOverageCents(lines: BillingLineSnapshot[]): number {
  let total = 0;
  for (const line of lines) {
    if (
      line.return_meter_hours == null || line.outbound_meter_hours == null ||
      !line.overage_hourly_rate_cents || line.overage_hourly_rate_cents <= 0
    ) continue;
    const used = line.return_meter_hours - line.outbound_meter_hours;
    const over = Math.max(0, used - (line.included_hours ?? 0));
    total += Math.round(over * line.overage_hourly_rate_cents);
  }
  return total;
}

/**
 * Decide the next invoice for a contract, or null when nothing is due.
 * `todayIso` is injected — the planner never reads the clock.
 */
export function planNextInvoice(
  contract: BillingContractSnapshot,
  lines: BillingLineSnapshot[],
  prior: PriorInvoicesSummary,
  returnCharges: ReturnChargesSnapshot | null,
  todayIso: string,
): InvoicePlan | null {
  if (!contract.on_rent_at) return null;
  if (!["on_rent", "off_rent", "returned"].includes(contract.lifecycle_state)) return null;

  const anchorMs = Date.parse(contract.on_rent_at.slice(0, 10));
  const todayMs = Date.parse(todayIso);
  const clockEndIso = contract.off_rent_at ?? contract.returned_at;
  const book = bookFromContract(contract);
  const zeroBase: OptimizedCharge = { total: 0, segments: [], fired: false, beaten_alternative: null };

  // FINAL invoice: the unit is back (physically returned). Reconcile the
  // whole duration; fold in return charges and the pickup fee.
  if (contract.lifecycle_state === "returned" && contract.returned_at) {
    const entireDays = computeBillableDays({
      start_at: contract.on_rent_at,
      clock_end_at: clockEndIso ?? contract.returned_at,
    });
    const finalBase = hasUsableTier(book)
      ? (() => {
          const { entire, final_invoice } = reconcileFinalInvoice(
            entireDays, book, prior.rental_charge_cents_total,
          );
          return { ...entire, total: final_invoice };
        })()
      : zeroBase;

    const damageBillable = returnCharges?.damage_disposition === "customer_billable";
    const charges = assembleCharges({
      base: finalBase,
      damage_waiver_accepted: contract.damage_waiver_accepted === true,
      damage_waiver_rate: contract.damage_waiver_rate_pct ?? null,
      pickup_fee_cents: contract.pickup_fee_cents,
      delivery_fee_cents: prior.count === 0 ? contract.delivery_fee_cents : null,
      fuel_cents: returnCharges?.fuel_charge_cents ?? null,
      cleaning_cents: returnCharges?.cleaning_charge_cents ?? null,
      damage_cents: damageBillable ? returnCharges?.damage_charge_cents ?? null : null,
      environmental_fee_cents: returnCharges?.environmental_fee_cents ?? null,
    });
    charges.overage_charge_cents = lineOverageCents(lines);
    charges.subtotal_cents += charges.overage_charge_cents;

    const periodStartMs = prior.last_period_end
      ? Date.parse(prior.last_period_end) + DAY_MS
      : anchorMs;
    return {
      kind: "final",
      period_start: isoDate(Math.min(periodStartMs, Date.parse(contract.returned_at.slice(0, 10)))),
      period_end: (clockEndIso ?? contract.returned_at).slice(0, 10),
      billable_days: entireDays,
      base: finalBase,
      charges,
    };
  }

  // INTERIM cycle invoice: clock still running, a full 28-day period elapsed.
  if (clockEndIso != null) return null;          // off-rent waits for the final
  if (!hasUsableTier(book)) return null;         // demo/loaner never bills interim

  const periodStartMs = anchorMs + prior.count * CYCLE_DAYS * DAY_MS;
  const periodEndMs = periodStartMs + (CYCLE_DAYS - 1) * DAY_MS;
  if (todayMs <= periodEndMs) return null;       // period not fully elapsed

  const base = optimizeCharge(CYCLE_DAYS, book);
  const charges = assembleCharges({
    base,
    damage_waiver_accepted: contract.damage_waiver_accepted === true,
    damage_waiver_rate: contract.damage_waiver_rate_pct ?? null,
    delivery_fee_cents: prior.count === 0 ? contract.delivery_fee_cents : null,
  });

  return {
    kind: "interim",
    period_start: isoDate(periodStartMs),
    period_end: isoDate(periodEndMs),
    billable_days: CYCLE_DAYS,
    base,
    charges,
  };
}
