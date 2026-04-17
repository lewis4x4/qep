/**
 * Step 9a: Program stacking validation
 *
 * Rules (from 10 seeded rows in qb_program_stacking_rules):
 *   CIL × financing        = false (mutually exclusive — pick one)
 *   CIL × aged_inventory   = true  (can stack)
 *   financing × aged       = true  (can stack)
 *   GMU × everything else  = false (GMU is its own pricing tier)
 *   bridge × everything    = false (bridge cannot combine with anything)
 *
 * Slice 02: rules are encoded here directly.
 * Slice 03: switch to reading qb_program_stacking_rules from the DB.
 */

import type { StackingResult, ProgramFixture } from "./types.ts";

interface ValidateStackingInput {
  financingProgramId?: string;
  cilProgramId?: string;
  additionalProgramIds: string[];
  customerType: "standard" | "gmu";
  availablePrograms: ProgramFixture[];
}

export function validateStacking(input: ValidateStackingInput): StackingResult {
  const {
    financingProgramId,
    cilProgramId,
    additionalProgramIds,
    customerType,
    availablePrograms,
  } = input;

  const warnings: string[] = [];
  const eligibilityNotes: string[] = [];
  const validPrograms: string[] = [];

  const lookup = (id: string) => availablePrograms.find((p) => p.id === id);

  // CIL and financing are mutually exclusive
  if (financingProgramId && cilProgramId) {
    warnings.push(
      "CIL and financing can't be combined — using CIL as selected. If you want financing instead, remove the CIL program.",
    );
    // Drop financing; keep CIL
    validPrograms.push(cilProgramId);
  } else {
    if (financingProgramId) validPrograms.push(financingProgramId);
    if (cilProgramId) validPrograms.push(cilProgramId);
  }

  // GMU cannot combine with other retail incentives
  if (customerType === "gmu") {
    if (financingProgramId || cilProgramId) {
      warnings.push(
        "GMU pricing can't be combined with retail incentive programs (CIL or financing). The GMU 8% off-list price applies instead.",
      );
      // Clear both
      validPrograms.length = 0;
    }
    eligibilityNotes.push(
      "Customer is GMU — price is 8% off list price rather than the normal dealer-discount path.",
    );
  }

  // Process additional programs (aged inventory, etc.)
  for (const id of additionalProgramIds) {
    const prog = lookup(id);
    if (!prog) {
      eligibilityNotes.push(
        `Program ${id} wasn't found in the available programs list. It may have expired or the wrong ID was passed.`,
      );
      continue;
    }

    // Bridge cannot combine with anything
    if (prog.programType === "bridge_rent_to_sales") {
      if (validPrograms.length > 0 || additionalProgramIds.length > 1) {
        warnings.push(
          `Bridge Rent-to-Sales (${prog.name}) can't be combined with other programs. It's being excluded.`,
        );
        continue;
      }
    }

    // GMU blocks additional programs
    if (customerType === "gmu") {
      eligibilityNotes.push(
        `Program "${prog.name}" is not applicable to GMU customers.`,
      );
      continue;
    }

    validPrograms.push(id);
  }

  return { validPrograms, warnings, eligibilityNotes };
}
