/**
 * Step 10: Tax calculation
 *
 * Slice 02 stub: accepts a pre-fetched rate and the taxable base amount.
 * The Edge Function (qb-calculate) resolves the rate — currently hardcoded
 * at 7% FL generic. The existing `tax-calculator` Edge Function does real
 * FL county-level lookups; Slice 03+ should call that and put the result
 * in QuoteContext.taxRatePct.
 *
 * Tax is applied to customerPriceAfterRebates (machine + attachments after
 * any CIL/rebate deductions). Doc fee and trade-in are NOT taxable.
 *
 * No floats. Math.round at the multiplication boundary.
 */

import type { TaxResult } from "./types.ts";

/**
 * @param ratePct  Decimal tax rate (e.g. 0.07 for 7%)
 * @param baseCents  The taxable amount in cents
 */
export function lookupTax(ratePct: number, baseCents: number): TaxResult {
  const cents = Math.round(baseCents * ratePct);
  return { ratePct, cents };
}
