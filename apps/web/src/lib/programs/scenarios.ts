/**
 * QEP Program Engine — Scenario Builder (Slice 03)
 *
 * buildScenarios() takes the eligible program recommendations and constructs
 * 2–4 comparable deal scenarios the rep can present side-by-side.
 *
 * Scenarios generated (when programs are available):
 *   A — Cash + rebate (best for buyer who wants the lowest out-of-pocket today)
 *   B — Low-rate financing (best for keeping monthly payment down)
 *   C — Cash + rebate + aged inventory stack (if model qualifies for both)
 *   D — GMU only (if customer is GMU)
 *
 * No DB calls — works off the pre-fetched ProgramRecommendation list.
 * Calls into the Slice 02 pricing calculator for each scenario via the
 * shared calculateQuote() function so math is always consistent.
 *
 * Human-sounding copy is mandatory. See rules in 00_MASTER_INDEX.md §6.
 */

import type { ProgramRecommendation, QuoteContext, QuoteScenario } from "./types.ts";

interface FinancingTerm {
  months: number;
  rate_pct: number;
  dealer_participation_pct: number;
}

interface ScenarioInput {
  context: QuoteContext;
  recommendations: ProgramRecommendation[];
  /** Equipment cost (Steps 1–6) — pre-computed by pricing engine */
  equipmentCostCents: number;
  /** Baseline sales price (equipment cost × markup) */
  baselineSalesPriceCents: number;
  /** Markup % achieved */
  markupPct: number;
}

export function buildScenarios(input: ScenarioInput): QuoteScenario[] {
  const { context, recommendations, equipmentCostCents, baselineSalesPriceCents, markupPct } = input;
  const scenarios: QuoteScenario[] = [];

  const eligible = recommendations.filter((r) => r.eligibility.eligible);

  const cilRec       = eligible.find((r) => r.programType === "cash_in_lieu");
  const financingRec = eligible.find((r) => r.programType === "low_rate_financing");
  const agedRec      = eligible.find((r) => r.programType === "aged_inventory");
  const gmuRec       = eligible.find((r) => r.programType === "gmu_rebate");
  const bridgeRec    = eligible.find((r) => r.programType === "bridge_rent_to_sales");

  // ── Helper: gross margin + commission ─────────────────────────────────────
  function margin(customerPriceCents: number) {
    const grossMarginCents = customerPriceCents - equipmentCostCents;
    const grossMarginPct = equipmentCostCents > 0
      ? grossMarginCents / customerPriceCents
      : 0;
    const commissionCents = Math.floor(grossMarginCents * 0.15);
    return { grossMarginCents, grossMarginPct, commissionCents };
  }

  // ── Helper: 0% financing monthly payment ─────────────────────────────────
  function monthlyPayment(financedCents: number, termMonths: number, ratePct: number): number {
    if (ratePct === 0) return Math.round(financedCents / termMonths);
    // Amortized payment factor
    const monthlyRate = ratePct / 12;
    const factor = monthlyRate / (1 - Math.pow(1 + monthlyRate, -termMonths));
    return Math.round(financedCents * factor);
  }

  function isFinancingTerm(value: unknown): value is FinancingTerm {
    if (typeof value !== "object" || value === null) return false;
    const term = value as Record<string, unknown>;
    return (
      typeof term.months === "number" &&
      typeof term.rate_pct === "number" &&
      typeof term.dealer_participation_pct === "number"
    );
  }

  function financingTerms(metadata: Record<string, unknown> | undefined): FinancingTerm[] {
    const terms = metadata?.terms;
    return Array.isArray(terms) ? terms.filter(isFinancingTerm) : [];
  }

  function chooseBestFinancingTerm(terms: FinancingTerm[]): FinancingTerm | undefined {
    return terms.find((t) => t.rate_pct === 0 && t.dealer_participation_pct === 0)
      ?? terms.reduce<FinancingTerm | undefined>(
        (best, term) => best === undefined || term.rate_pct < best.rate_pct ? term : best,
        undefined,
      );
  }

  // ── Scenario A: Cash + CIL rebate ────────────────────────────────────────
  if (cilRec && context.customerType === "standard") {
    const rebateCents = cilRec.estimatedCustomerBenefitCents ?? 0;
    const customerPriceCents = baselineSalesPriceCents - rebateCents;
    const { grossMarginCents, grossMarginPct, commissionCents } = margin(customerPriceCents);
    const dollarRebate = `$${(rebateCents / 100).toLocaleString()}`;
    const dollarMonthly = `$${Math.round(baselineSalesPriceCents / (100 * 48)).toLocaleString()}`;

    scenarios.push({
      label: "Cash + rebate",
      description: `Customer gets ${dollarRebate} back — best option for the buyer who's paying cash or has their own financing.`,
      programIds: [cilRec.programId],
      customerOutOfPocketCents: customerPriceCents,
      totalPaidByCustomerCents: customerPriceCents,
      dealerMarginCents: grossMarginCents,
      dealerMarginPct: grossMarginPct,
      commissionCents,
      pros: [
        `Customer walks out with ${dollarRebate} back in their pocket.`,
        "QEP collects the full amount up front — no financing admin.",
        "Rebate comes from the manufacturer, not your margin.",
      ],
      cons: [
        "Not useful if the customer wants low monthly payments.",
        `Cash equivalent is roughly ${dollarMonthly}/month over 48 months — some buyers need financing regardless.`,
      ],
    });
  }

  // ── Scenario B: 0% financing ──────────────────────────────────────────────
  if (financingRec && context.customerType === "standard") {
    // Pick the best 0% term with no dealer cost first; fall back to lowest rate
    const bestTerm = chooseBestFinancingTerm(financingTerms(financingRec.eligibility.metadata));

    if (bestTerm) {
      const financedCents = baselineSalesPriceCents;
      const dealerPartCents = Math.round(financedCents * bestTerm.dealer_participation_pct);
      const adjustedRevenue = baselineSalesPriceCents - dealerPartCents;
      const { grossMarginCents, grossMarginPct, commissionCents } = margin(adjustedRevenue);
      const monthly = monthlyPayment(financedCents, bestTerm.months, bestTerm.rate_pct);
      const dollarMonthly = `$${(monthly / 100).toLocaleString()}`;
      const termLabel = bestTerm.rate_pct === 0
        ? `0% for ${bestTerm.months} months`
        : `${(bestTerm.rate_pct * 100).toFixed(2)}% for ${bestTerm.months} months`;

      scenarios.push({
        label: termLabel,
        description: `${dollarMonthly}/month — ideal for the customer who wants the machine without a big check today.`,
        programIds: [financingRec.programId],
        customerOutOfPocketCents: 0,
        monthlyPaymentCents: monthly,
        termMonths: bestTerm.months,
        totalPaidByCustomerCents: monthly * bestTerm.months,
        dealerMarginCents: grossMarginCents,
        dealerMarginPct: grossMarginPct,
        commissionCents,
        pros: [
          `Monthly payment stays at ${dollarMonthly} for ${bestTerm.months} months.`,
          bestTerm.rate_pct === 0
            ? "Zero interest — manufacturer absorbs the cost, not QEP."
            : `${(bestTerm.rate_pct * 100).toFixed(2)}% is well below market rate for equipment financing.`,
          "Customer keeps their cash working for them.",
        ],
        cons: [
          "Total paid over the term is higher than the cash price.",
          dealerPartCents > 0
            ? `QEP absorbs $${(dealerPartCents / 100).toLocaleString()} in dealer participation — that comes off margin.`
            : "",
        ].filter(Boolean),
      });
    }
  }

  // ── Scenario C: CIL + Aged Inventory stack ────────────────────────────────
  if (cilRec && agedRec && context.customerType === "standard") {
    const stackedRebateCents =
      (cilRec.estimatedCustomerBenefitCents ?? 0) +
      (agedRec.estimatedCustomerBenefitCents ?? 0);
    const customerPriceCents = baselineSalesPriceCents - stackedRebateCents;
    const { grossMarginCents, grossMarginPct, commissionCents } = margin(customerPriceCents);
    const totalRebate = `$${(stackedRebateCents / 100).toLocaleString()}`;
    const cilAmount = `$${((cilRec.estimatedCustomerBenefitCents ?? 0) / 100).toLocaleString()}`;
    const agedAmount = `$${((agedRec.estimatedCustomerBenefitCents ?? 0) / 100).toLocaleString()}`;

    scenarios.push({
      label: `Cash + ${totalRebate} stacked rebate`,
      description: `CIL (${cilAmount}) and Aged Inventory (${agedAmount}) stack together — maximum cash back for the customer.`,
      programIds: [cilRec.programId, agedRec.programId],
      customerOutOfPocketCents: customerPriceCents,
      totalPaidByCustomerCents: customerPriceCents,
      dealerMarginCents: grossMarginCents,
      dealerMarginPct: grossMarginPct,
      commissionCents,
      pros: [
        `${totalRebate} back — the best cash rebate this machine qualifies for.`,
        "Both rebates come from the manufacturer. QEP margin stays intact.",
        "Great closing argument for a price-sensitive buyer.",
      ],
      cons: [
        "Requires the unit to be aged inventory (prior model year). Confirm the VIN/serial number.",
        "Can't combine with financing — cash or customer-arranged financing only.",
      ],
    });
  }

  // ── Scenario D: Bridge Rent-to-Sales ─────────────────────────────────────
  if (bridgeRec) {
    const rebateCents = bridgeRec.estimatedCustomerBenefitCents ?? 0;
    const customerPriceCents = baselineSalesPriceCents - rebateCents;
    const { grossMarginCents, grossMarginPct, commissionCents } = margin(customerPriceCents);
    const dollarRebate = `$${(rebateCents / 100).toLocaleString()}`;

    scenarios.push({
      label: "Rental fleet placement",
      description: `Bridge Rent-to-Sales: ${dollarRebate} rebate for placing this unit into the rental fleet. Standalone — nothing else stacks.`,
      programIds: [bridgeRec.programId],
      customerOutOfPocketCents: customerPriceCents,
      totalPaidByCustomerCents: customerPriceCents,
      dealerMarginCents: grossMarginCents,
      dealerMarginPct: grossMarginPct,
      commissionCents,
      pros: [
        `${dollarRebate} manufacturer rebate for getting the unit into rental.`,
        "Generates ongoing rental revenue without a retail sale.",
      ],
      cons: [
        "Cannot combine with CIL, financing, or any other program.",
        "Unit goes into rental fleet — not a customer retail deal.",
      ],
    });
  }

  // ── Scenario E: GMU ───────────────────────────────────────────────────────
  if (gmuRec && context.customerType === "gmu") {
    const discountCents = gmuRec.estimatedCustomerBenefitCents ?? 0;
    const gmuPrice = context.listPriceCents - discountCents;
    // GMU margin is measured vs equipment cost, not baseline sales price
    const { grossMarginCents, grossMarginPct, commissionCents } = margin(gmuPrice);
    const listStr = `$${(context.listPriceCents / 100).toLocaleString()}`;
    const discountStr = `$${(discountCents / 100).toLocaleString()}`;
    const priceStr = `$${(gmuPrice / 100).toLocaleString()}`;

    scenarios.push({
      label: "GMU pricing",
      description: `8% off list for this government buyer — ${listStr} list price drops to ${priceStr} after the ${discountStr} GMU discount.`,
      programIds: [gmuRec.programId],
      customerOutOfPocketCents: gmuPrice,
      totalPaidByCustomerCents: gmuPrice,
      dealerMarginCents: grossMarginCents,
      dealerMarginPct: grossMarginPct,
      commissionCents,
      pros: [
        `${discountStr} off list price — a straightforward government pricing tier.`,
        "No retail incentives to manage. Clean deal.",
      ],
      cons: [
        "GMU can't stack with CIL or financing.",
        "Requires pre-approval number from the YCENA Machine Order App before closing.",
        grossMarginPct < 0.10
          ? "Margin is below 10% — this deal needs manager approval."
          : "",
      ].filter(Boolean),
    });
  }

  // If no eligible programs at all, return a baseline cash scenario
  if (scenarios.length === 0) {
    const { grossMarginCents, grossMarginPct, commissionCents } = margin(baselineSalesPriceCents);
    scenarios.push({
      label: "Standard cash deal",
      description: "No manufacturer programs apply to this machine right now — straight list-price-minus-discount deal.",
      programIds: [],
      customerOutOfPocketCents: baselineSalesPriceCents,
      totalPaidByCustomerCents: baselineSalesPriceCents,
      dealerMarginCents: grossMarginCents,
      dealerMarginPct: grossMarginPct,
      commissionCents,
      pros: [
        "Clean deal — no program paperwork.",
        "QEP keeps full margin.",
      ],
      cons: [
        "No manufacturer incentive to help close.",
        "Ask Angela about current programs — the Q1 2026 programs may have expired.",
      ],
    });
  }

  return scenarios;
}
