/**
 * Deterministic RN9/RN10 money-contract tests.
 *
 * Run with:
 *   deno test --allow-read supabase/migrations/830_rental_conversion_commission_and_refund_clawback.deno.test.ts
 */

function assertEquals<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

// PostgreSQL round(numeric) rounds a half away from zero. Keep these helpers
// integer-only so cents behavior never depends on binary floating point.
function roundRatioAwayFromZero(
  numerator: bigint,
  denominator: bigint,
): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return sign * rounded;
}

function rentalCommissionCents(rentBasisCents: bigint): bigint {
  return roundRatioAwayFromZero(rentBasisCents * 5n, 100n);
}

function rentRefundClawbackCents(refundedRentCents: bigint): bigint {
  return -rentalCommissionCents(refundedRentCents);
}

function conversionCommissionCents(
  grossMarginCents: bigint,
  priorNetRentalCommissionCents: bigint,
): bigint {
  return roundRatioAwayFromZero(grossMarginCents * 15n, 100n) -
    priorNetRentalCommissionCents;
}

Deno.test("RN10 records an exact negative five-percent rent-refund clawback", () => {
  assertEquals(rentRefundClawbackCents(12_345n), -617n, "ordinary cents");
  assertEquals(rentRefundClawbackCents(10n), -1n, "half-cent rounds away");
  assertEquals(rentRefundClawbackCents(1n), 0n, "sub-half cent rounds zero");
});

Deno.test("RN9 subtracts net unit rental commission after clawbacks", () => {
  assertEquals(
    conversionCommissionCents(2_000_000n, 75_000n),
    225_000n,
    "positive conversion",
  );
  assertEquals(
    conversionCommissionCents(100_000n, 175_000n),
    -160_000n,
    "negative exact result remains visible",
  );
  const paid = rentalCommissionCents(1_000_000n);
  const fullyClawedBack = paid + rentRefundClawbackCents(1_000_000n);
  assertEquals(fullyClawedBack, 0n, "full clawback nets paid rent commission to zero");
  assertEquals(
    conversionCommissionCents(2_000_000n, fullyClawedBack),
    300_000n,
    "conversion does not double-deduct commission already clawed back",
  );
});

Deno.test("migration pins generated formulas and preserves the asset-cost boundary", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "./830_rental_conversion_commission_and_refund_clawback.sql",
      import.meta.url,
    ),
  );
  const compact = sql.replace(/\s+/g, " ").toLowerCase();
  assert(
    compact.includes(
      "v_total_commission := round(p_rent_basis_cents::numeric * 0.050000)::bigint",
    ),
    "missing exact paid source-event formula",
  );
  assert(
    compact.includes(
      "round(gross_margin_cents::numeric * conversion_rate_pct)::bigint - prior_net_rental_commission_cents",
    ),
    "missing net conversion formula",
  );
  assert(
    compact.includes("refund clawback exceeds attributable prior paid commission"),
    "refunds must not create employee debt without attributable paid commission",
  );
  assert(
    compact.includes("origin_paid_entry_id"),
    "clawback must retain original paid-entry provenance",
  );
  assert(
    !/update public\.qrm_equipment/.test(compact),
    "migration must never rewrite canonical equipment cost",
  );
  assert(
    !/insert into public\.gl_/.test(compact),
    "commission truth must not masquerade as a GL posting",
  );
});
