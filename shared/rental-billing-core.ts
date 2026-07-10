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
  /**
   * True once a FINAL invoice has been issued for the contract. A returned
   * contract is billed exactly once; without this flag a re-run recomputes
   * period_start from the final invoice's own period_end (last_period_end + 1),
   * which lands past the clock end and inverts the period.
   */
  has_final_invoice?: boolean;
}

export interface ReturnChargesSnapshot {
  fuel_charge_cents: number | null;
  cleaning_charge_cents: number | null;
  damage_charge_cents: number | null;
  environmental_fee_cents: number | null;
  damage_disposition: string | null;
}

/**
 * One persisted rental_returns assessment. The billing runner queries by both
 * contract and workspace, and the pure aggregator repeats those checks as a
 * defence against service-role/RLS bypass mistakes and fixture drift.
 *
 * `deleted_at` is optional because the legacy rental_returns table does not
 * currently expose a soft-delete column. Keeping the guard here makes the
 * money rule safe for production-shaped fixtures and for a future additive
 * soft-delete migration without changing aggregation semantics.
 */
export interface RentalReturnAssessmentSnapshot extends ReturnChargesSnapshot {
  id: string;
  workspace_id: string;
  rental_contract_id: string | null;
  equipment_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ReturnChargeSourceEvidence {
  return_id: string;
  equipment_id: string | null;
  legacy_null_equipment_fallback: boolean;
  damage_disposition: string | null;
  fuel_charge_cents: number;
  cleaning_charge_cents: number;
  /** Only customer-billable damage; pending/warranty/internal wear are zero. */
  damage_charge_cents: number;
  environmental_fee_cents: number;
}

export interface ReturnChargeAggregation {
  charges: ReturnChargesSnapshot | null;
  /** Canonical latest rows, including assessments that contribute $0. */
  selected_return_ids: string[];
  /** Canonical rows that contribute at least one billed ancillary cent. */
  billed_return_ids: string[];
  /** Older assessments ignored because a newer row exists for that unit. */
  superseded_return_ids: string[];
  /** Latest row in the single conservative NULL-equipment legacy bucket. */
  legacy_null_equipment_return_id: string | null;
  sources: ReturnChargeSourceEvidence[];
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

function billableCents(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function assessmentTime(row: RentalReturnAssessmentSnapshot): number {
  const updated = Date.parse(row.updated_at);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(row.created_at);
  return Number.isFinite(created) ? created : 0;
}

/**
 * Deterministically aggregate final-invoice return charges.
 *
 * Canonical rows are selected with a last-assessment-wins rule per equipment:
 * updated_at, then created_at, then id. Repeated/corrected rows therefore
 * supersede instead of stack. Legacy rows with equipment_id IS NULL cannot be
 * assigned to distinct units safely, so they intentionally share ONE legacy
 * bucket; only its latest row is eligible. Identified equipment rows still
 * aggregate alongside that bucket.
 *
 * Fuel, cleaning and environmental fees always flow from each selected row.
 * Damage flows only from rows explicitly marked customer_billable.
 */
export function aggregateReturnCharges(
  rows: RentalReturnAssessmentSnapshot[],
  scope: { contract_id: string; workspace_id: string },
): ReturnChargeAggregation {
  const eligible = rows.filter((row) =>
    row.rental_contract_id === scope.contract_id &&
    row.workspace_id === scope.workspace_id &&
    row.deleted_at == null
  );

  const byEquipment = new Map<string, RentalReturnAssessmentSnapshot[]>();
  for (const row of eligible) {
    const key = row.equipment_id == null
      ? "legacy:null-equipment"
      : `equipment:${row.equipment_id}`;
    const bucket = byEquipment.get(key);
    if (bucket) bucket.push(row);
    else byEquipment.set(key, [row]);
  }

  const selected: RentalReturnAssessmentSnapshot[] = [];
  const superseded: RentalReturnAssessmentSnapshot[] = [];
  for (const bucket of byEquipment.values()) {
    bucket.sort((a, b) => {
      const timeDelta = assessmentTime(b) - assessmentTime(a);
      if (timeDelta !== 0) return timeDelta;
      const createdDelta = Date.parse(b.created_at) - Date.parse(a.created_at);
      if (Number.isFinite(createdDelta) && createdDelta !== 0) return createdDelta;
      return b.id.localeCompare(a.id);
    });
    selected.push(bucket[0]);
    superseded.push(...bucket.slice(1));
  }

  // Stable evidence ordering is independent of query order.
  selected.sort((a, b) => {
    if (a.equipment_id == null && b.equipment_id != null) return 1;
    if (a.equipment_id != null && b.equipment_id == null) return -1;
    const equipmentDelta = (a.equipment_id ?? "").localeCompare(b.equipment_id ?? "");
    return equipmentDelta || a.id.localeCompare(b.id);
  });
  superseded.sort((a, b) => a.id.localeCompare(b.id));

  const sources = selected.map((row): ReturnChargeSourceEvidence => ({
    return_id: row.id,
    equipment_id: row.equipment_id,
    legacy_null_equipment_fallback: row.equipment_id == null,
    damage_disposition: row.damage_disposition,
    fuel_charge_cents: billableCents(row.fuel_charge_cents),
    cleaning_charge_cents: billableCents(row.cleaning_charge_cents),
    damage_charge_cents: row.damage_disposition === "customer_billable"
      ? billableCents(row.damage_charge_cents)
      : 0,
    environmental_fee_cents: billableCents(row.environmental_fee_cents),
  }));

  const billedSources = sources.filter((source) =>
    source.fuel_charge_cents > 0 ||
    source.cleaning_charge_cents > 0 ||
    source.damage_charge_cents > 0 ||
    source.environmental_fee_cents > 0
  );
  const sum = (field: keyof Pick<
    ReturnChargeSourceEvidence,
    "fuel_charge_cents" | "cleaning_charge_cents" | "damage_charge_cents" | "environmental_fee_cents"
  >) => sources.reduce((total, source) => total + source[field], 0);
  const damage = sum("damage_charge_cents");

  return {
    charges: selected.length === 0
      ? null
      : {
          fuel_charge_cents: sum("fuel_charge_cents"),
          cleaning_charge_cents: sum("cleaning_charge_cents"),
          damage_charge_cents: damage,
          environmental_fee_cents: sum("environmental_fee_cents"),
          // planNextInvoice keeps its final safety pin. Aggregation has
          // already excluded all non-customer-billable damage components.
          damage_disposition: damage > 0 ? "customer_billable" : null,
        },
    selected_return_ids: sources.map((source) => source.return_id),
    billed_return_ids: billedSources.map((source) => source.return_id),
    superseded_return_ids: superseded.map((row) => row.id),
    legacy_null_equipment_return_id:
      sources.find((source) => source.legacy_null_equipment_fallback)?.return_id ?? null,
    sources,
  };
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
  // whole duration; fold in return charges and the pickup fee. Issued once —
  // a contract that already has its final invoice has nothing further due.
  if (contract.lifecycle_state === "returned" && contract.returned_at) {
    if (prior.has_final_invoice) return null;
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

    const periodEndIso = (clockEndIso ?? contract.returned_at).slice(0, 10);
    const periodStartMs = prior.last_period_end
      ? Date.parse(prior.last_period_end) + DAY_MS
      : anchorMs;
    // Clamp the start to the period end: a mid-cycle off-rent can leave the
    // last interim's period_end at or past the clock end, and an unclamped
    // start would invert the range (period_end < period_start).
    const clampedStartMs = Math.min(periodStartMs, Date.parse(periodEndIso));
    return {
      kind: "final",
      period_start: isoDate(clampedStartMs),
      period_end: periodEndIso,
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
