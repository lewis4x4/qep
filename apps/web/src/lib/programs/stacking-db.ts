/**
 * QEP Program Engine — DB-backed Stacking Validator (Slice 03)
 *
 * Replaces the hardcoded stacking logic in apps/web/src/lib/pricing/stacking.ts.
 * Reads qb_program_stacking_rules from the database so rule changes take effect
 * without a code deploy.
 *
 * The pricing/stacking.ts module remains for Slice 02 test fixtures (hardcoded).
 * This module is what the edge functions and Slice 03 recommender use.
 *
 * Rules are bidirectional: if (A, B) is stored, we check both (A,B) and (B,A).
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types.ts";
import type { StackingResult } from "./types.ts";

interface StackingInput {
  /** All program IDs the rep has selected */
  programIds: string[];
  customerType: "standard" | "gmu";
}

interface ProgramRow {
  id: string;
  program_type: string;
  name: string;
}

interface StackingRuleRow {
  program_type_a: string;
  program_type_b: string;
  can_combine: boolean;
  notes: string | null;
}

export async function validateStackingFromDB(
  input: StackingInput,
  supabase: ReturnType<typeof createClient<Database>>,
): Promise<StackingResult> {
  const { programIds, customerType } = input;

  if (programIds.length < 2) {
    return { valid: true, validProgramIds: programIds, violations: [], warnings: [] };
  }

  // Fetch program types for the selected IDs
  const { data: programs, error: progErr } = await supabase
    .from("qb_programs")
    .select("id, program_type, name")
    .in("id", programIds);

  if (progErr || !programs) {
    return {
      valid: false,
      validProgramIds: [],
      violations: ["Couldn't load program details to check stacking rules. Try again."],
      warnings: [],
    };
  }

  // Fetch all stacking rules
  const { data: rules, error: ruleErr } = await supabase
    .from("qb_program_stacking_rules")
    .select("program_type_a, program_type_b, can_combine, notes");

  if (ruleErr || !rules) {
    return {
      valid: false,
      validProgramIds: [],
      violations: ["Couldn't load stacking rules. Try again or contact support."],
      warnings: [],
    };
  }

  const violations: string[] = [];
  const warnings: string[] = [];
  const blockedIds = new Set<string>();

  const typedPrograms = programs as ProgramRow[];
  const typedRules = rules as StackingRuleRow[];

  // GMU cannot combine with any retail incentive — enforce first
  if (customerType === "gmu") {
    for (const p of typedPrograms) {
      if (p.program_type !== "gmu_rebate") {
        violations.push(
          `GMU pricing can't be combined with "${p.name}" — GMU is its own pricing tier and doesn't stack with retail programs.`,
        );
        blockedIds.add(p.id);
      }
    }
  }

  // Check all pairs
  for (let i = 0; i < typedPrograms.length; i++) {
    for (let j = i + 1; j < typedPrograms.length; j++) {
      const a = typedPrograms[i];
      const b = typedPrograms[j];

      if (blockedIds.has(a.id) || blockedIds.has(b.id)) continue;

      const rule = typedRules.find(
        (r) =>
          (r.program_type_a === a.program_type && r.program_type_b === b.program_type) ||
          (r.program_type_a === b.program_type && r.program_type_b === a.program_type),
      );

      if (rule && !rule.can_combine) {
        const note = rule.notes ?? `"${a.name}" and "${b.name}" can't be combined.`;
        violations.push(note);
        blockedIds.add(b.id); // keep the first one, block the second
      }
    }
  }

  const validProgramIds = typedPrograms
    .filter((p) => !blockedIds.has(p.id))
    .map((p) => p.id);

  if (violations.length > 0 && validProgramIds.length < typedPrograms.length) {
    warnings.push(
      `${blockedIds.size} program(s) removed due to stacking conflicts. ` +
      `The remaining ${validProgramIds.length} program(s) are compatible.`,
    );
  }

  return {
    valid: violations.length === 0,
    validProgramIds,
    violations,
    warnings,
  };
}
