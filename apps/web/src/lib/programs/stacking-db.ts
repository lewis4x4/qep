/**
 * QEP Program Engine — DB-backed Stacking Validator (Slice 03)
 *
 * Replaces the hardcoded stacking logic in apps/web/src/lib/pricing/stacking.ts.
 * Reads exact, worksheet-backed qb_program_pair_policies from the database so
 * OEM- and effective-date-specific rules take effect without a code deploy.
 *
 * The pricing/stacking.ts module remains for Slice 02 test fixtures (hardcoded).
 * This module is what the edge functions and Slice 03 recommender use.
 *
 * Rules are stored in canonical UUID order, but callers may select programs in
 * any order. Missing/unverified policy is a hard, fail-closed violation.
 */

import type { StackingResult } from "./types.ts";

/** Minimal duck-type for a Supabase client — avoids a bare npm import in Deno. */
interface SupabaseLike {
  from: (table: string) => any;
}

interface StackingInput {
  /** All program IDs the rep has selected */
  programIds: string[];
  customerType: "standard" | "gmu";
  /** OEM selected for the quote. */
  brandId: string;
  /** Quote/deal date used to resolve the effective policy window. */
  dealDate: Date | string;
}

interface ProgramRow {
  id: string;
  workspace_id: string;
  brand_id: string;
  program_type: string;
  name: string;
  effective_from: string;
  effective_to: string;
  active: boolean;
  stack_policy_provenance: string;
  stack_policy_verified_at: string | null;
}

interface StackingRuleRow {
  program_a_id: string;
  program_b_id: string;
  can_combine: boolean;
  effective_from: string;
  effective_to: string;
  source_price_sheet_id: string;
  reviewed_at: string;
  status: "published" | "superseded";
  notes: string | null;
}

function asDateOnly(value: Date | string): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function canonicalPairKey(firstId: string, secondId: string): string {
  return firstId < secondId
    ? `${firstId}:${secondId}`
    : `${secondId}:${firstId}`;
}

export async function validateStackingFromDB(
  input: StackingInput,
  supabase: SupabaseLike,
): Promise<StackingResult> {
  const programIds = [...new Set(input.programIds)];

  if (programIds.length === 0) {
    return { valid: true, validProgramIds: programIds, violations: [], warnings: [] };
  }

  const dealDate = asDateOnly(input.dealDate);
  if (!dealDate || !input.brandId) {
    return {
      valid: false,
      validProgramIds: [],
      violations: ["Program stacking policy needs a valid OEM and quote date before customer send."],
      warnings: [],
    };
  }

  // RLS scopes the workspace; brand/date filters prevent cross-OEM or stale
  // selections from being interpreted as a valid combination.
  const { data: programs, error: progErr } = await supabase
    .from("qb_programs")
    .select("id, workspace_id, brand_id, program_type, name, effective_from, effective_to, active, stack_policy_provenance, stack_policy_verified_at")
    .in("id", programIds)
    .eq("brand_id", input.brandId);

  if (progErr || !programs || programs.length !== programIds.length) {
    return {
      valid: false,
      validProgramIds: [],
      violations: ["One or more selected programs are missing, outside this workspace, or belong to a different OEM."],
      warnings: [],
    };
  }

  const typedPrograms = programs as ProgramRow[];
  const unverifiedPrograms = typedPrograms.filter((program) =>
    !program.active
    || program.effective_from > dealDate
    || program.effective_to < dealDate
    || program.stack_policy_provenance !== "manufacturer_worksheet"
    || !program.stack_policy_verified_at
  );
  if (unverifiedPrograms.length > 0) {
    return {
      valid: false,
      validProgramIds: [],
      violations: unverifiedPrograms.map((program) =>
        `Program policy pending manufacturer worksheet review for "${program.name}" on ${dealDate}. Customer send is blocked.`
      ),
      warnings: [],
    };
  }

  if (programIds.length === 1) {
    return { valid: true, validProgramIds: programIds, violations: [], warnings: [] };
  }

  // Fetch only policies whose canonical endpoints are both selected. This
  // bounds the result to the selected pair set instead of loading every active
  // policy for an OEM. RLS supplies the caller's workspace boundary.
  const { data: rules, error: ruleErr } = await supabase
    .from("qb_program_pair_policies")
    .select("program_a_id, program_b_id, can_combine, effective_from, effective_to, source_price_sheet_id, reviewed_at, status, notes")
    .eq("brand_id", input.brandId)
    .eq("status", "published")
    .in("program_a_id", programIds)
    .in("program_b_id", programIds)
    .lte("effective_from", dealDate)
    .gte("effective_to", dealDate);

  if (ruleErr || !rules) {
    return {
      valid: false,
      validProgramIds: [],
      violations: ["Couldn't load reviewed OEM stacking rules. Customer send is blocked until policy can be verified."],
      warnings: [],
    };
  }

  const violations: string[] = [];
  const warnings: string[] = [];
  const blockedIds = new Set<string>();

  const rulesByPair = new Map<string, StackingRuleRow>();
  for (const rule of rules as StackingRuleRow[]) {
    rulesByPair.set(canonicalPairKey(rule.program_a_id, rule.program_b_id), rule);
  }

  // Check all pairs
  for (let i = 0; i < typedPrograms.length; i++) {
    for (let j = i + 1; j < typedPrograms.length; j++) {
      const a = typedPrograms[i];
      const b = typedPrograms[j];

      if (blockedIds.has(a.id) || blockedIds.has(b.id)) continue;

      const rule = rulesByPair.get(canonicalPairKey(a.id, b.id));

      if (!rule) {
        violations.push(
          `Program stacking policy pending manufacturer worksheet review for "${a.name}" + "${b.name}" on ${dealDate}. Customer send is blocked.`,
        );
        blockedIds.add(b.id);
      } else if (!rule.can_combine) {
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
