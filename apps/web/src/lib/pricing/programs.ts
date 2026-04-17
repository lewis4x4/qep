/**
 * Step 9b: Apply program effects
 *
 * Handles four program types in Slice 02:
 *   low_rate_financing  — computes payment, dealer participation cost
 *   cash_in_lieu        — reduces customer price by rebate amount
 *   aged_inventory      — additional customer rebate that stacks with CIL or financing
 *   gmu_rebate          — neutral (pricing handled in equipment.ts GMU path)
 *
 * Slice 02: programs injected via QuoteContext.programs (fixtures).
 * Slice 03: switch to reading live qb_programs rows.
 *
 * No floats. All money in cents. Math.round at every division boundary.
 */

import type {
  PriceQuoteRequest,
  EquipmentResult,
  AttachmentsResult,
  ProgramsResult,
  AppliedProgram,
  FinancingScenario,
  ProgramFixture,
} from "./types.ts";

interface ApplyProgramsInput {
  request: PriceQuoteRequest;
  equipmentResult: EquipmentResult;
  attachmentsResult: AttachmentsResult;
  validatedProgramIds: string[];
  availablePrograms: ProgramFixture[];
}

export function applyPrograms(input: ApplyProgramsInput): ProgramsResult {
  const {
    request,
    equipmentResult,
    attachmentsResult,
    validatedProgramIds,
    availablePrograms,
  } = input;

  const programs: AppliedProgram[] = [];
  let financingScenario: FinancingScenario | undefined;
  let customerRebatesCents = 0;
  let dealerParticipationCostCents = 0;
  const warnings: string[] = [];
  const eligibilityNotes: string[] = [];

  // OEM attachment list total — used for financing cap check
  // Rylee: "we can put low interest financing all the way up to list [price]"
  const oemAttachmentListTotal = attachmentsResult.attachments
    .filter((a) => a.oemBranded)
    .reduce((s, a) => s + a.listPriceCents, 0);
  const maxFinancedCents =
    equipmentResult.model.listPriceCents + oemAttachmentListTotal;

  for (const programId of validatedProgramIds) {
    const prog = availablePrograms.find((p) => p.id === programId);
    if (!prog) {
      eligibilityNotes.push(
        `Program ${programId} wasn't found in available programs — skipped. Check the program ID or ask Angela to verify it's active.`,
      );
      continue;
    }
    if (!prog.isActive) {
      eligibilityNotes.push(`Program "${prog.name}" is no longer active.`);
      continue;
    }

    switch (prog.programType) {
      case "low_rate_financing": {
        const details = prog.details as {
          term_months: number;
          rate_pct: number;
          dealer_participation_pct: number;
          lender_name: string;
        };

        const termMonths = request.financing?.termMonths ?? details.term_months;
        const ratePct =
          request.financing?.ratePctOverride ?? details.rate_pct;

        // Build financed amount: machine + OEM attachment sales prices
        const oemAttachmentSales = attachmentsResult.attachments
          .filter((a) => a.oemBranded && a.attachmentId !== null)
          .reduce((s, a) => s + a.salesPriceCents, 0);

        let totalFinancedCents =
          equipmentResult.baselineSalesPriceCents + oemAttachmentSales;

        // Non-OEM custom attachments may roll in, up to the list cap
        const nonOemSales = attachmentsResult.attachments
          .filter((a) => !a.oemBranded)
          .reduce((s, a) => s + a.salesPriceCents, 0);

        if (nonOemSales > 0) {
          if (totalFinancedCents + nonOemSales > maxFinancedCents) {
            const overCap =
              totalFinancedCents + nonOemSales - maxFinancedCents;
            warnings.push(
              `Non-OEM attachments exceed the financing cap by $${(overCap / 100).toFixed(2)}. ` +
                `Financing is limited to $${(maxFinancedCents / 100).toFixed(2)} ` +
                `(machine list $${(equipmentResult.model.listPriceCents / 100).toFixed(2)} ` +
                `+ OEM attachment list $${(oemAttachmentListTotal / 100).toFixed(2)}).`,
            );
            totalFinancedCents = maxFinancedCents;
          } else {
            totalFinancedCents += nonOemSales;
          }
        }

        const paymentCents = computeMonthlyPayment(
          totalFinancedCents,
          ratePct,
          termMonths,
        );
        const dpCost = Math.round(
          totalFinancedCents * details.dealer_participation_pct,
        );
        dealerParticipationCostCents += dpCost;

        financingScenario = {
          programId: prog.id,
          lenderName: details.lender_name,
          termMonths,
          ratePct,
          paymentCents,
          totalFinancedCents,
          dealerParticipationPct: details.dealer_participation_pct,
          dealerParticipationCostCents: dpCost,
        };

        programs.push({
          programId: prog.id,
          programType: prog.programType,
          name: prog.name,
          // Dealer cost increases if there's participation; at 0% it's neutral
          effectOnPrice: dpCost > 0 ? "dealer_cost" : "neutral",
          amountCents: dpCost,
          details: prog.details,
        });
        break;
      }

      case "cash_in_lieu": {
        const details = prog.details as { rebate_amount_cents: number };
        const rebate = details.rebate_amount_cents;
        customerRebatesCents += rebate;
        programs.push({
          programId: prog.id,
          programType: prog.programType,
          name: prog.name,
          effectOnPrice: "customer_discount",
          amountCents: rebate,
          details: prog.details,
        });
        break;
      }

      case "aged_inventory": {
        const details = prog.details as {
          rebate_amount_cents?: number;
          rebate_pct?: number;
        };
        let rebate = 0;
        if (details.rebate_amount_cents != null) {
          rebate = details.rebate_amount_cents;
        } else if (details.rebate_pct != null) {
          rebate = Math.round(
            equipmentResult.model.listPriceCents * details.rebate_pct,
          );
        }
        customerRebatesCents += rebate;
        programs.push({
          programId: prog.id,
          programType: prog.programType,
          name: prog.name,
          effectOnPrice: "customer_discount",
          amountCents: rebate,
          details: prog.details,
        });
        break;
      }

      case "gmu_rebate": {
        // GMU pricing is handled in equipment.ts (8% off list cap).
        // The program record is noted for auditability only.
        programs.push({
          programId: prog.id,
          programType: prog.programType,
          name: prog.name,
          effectOnPrice: "neutral",
          amountCents: 0,
          details: prog.details,
        });
        break;
      }

      default: {
        eligibilityNotes.push(
          `Program type "${prog.programType}" for "${prog.name}" isn't handled in Slice 02 yet. ` +
            `It will be fully supported in Slice 03.`,
        );
      }
    }
  }

  return {
    programs,
    financingScenario,
    customerRebatesCents,
    dealerParticipationCostCents,
    warnings,
    eligibilityNotes,
  };
}

// ── Payment calculation ───────────────────────────────────────────────────────

/**
 * Monthly payment in cents.
 * At 0%: simple division (Math.round per Slice 02 spec "For 0%: payment = financed / term_months").
 * At non-0%: standard amortization — P × r / (1 − (1+r)^−n), where r = monthly rate.
 * Always Math.round — never a float in the output.
 */
function computeMonthlyPayment(
  financedCents: number,
  annualRatePct: number,
  termMonths: number,
): number {
  if (annualRatePct === 0) {
    return Math.round(financedCents / termMonths);
  }
  const r = annualRatePct / 12; // monthly rate
  const payment =
    (financedCents * r) / (1 - Math.pow(1 + r, -termMonths));
  return Math.round(payment);
}
