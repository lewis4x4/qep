/**
 * Deal Coach service layer — Slice 13.
 *
 * Builds the DealCoachContext from live DB queries (margin baseline,
 * active programs) and records show/apply/dismiss actions into
 * qb_deal_coach_actions.
 */

import { supabase } from "@/lib/supabase";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import type { DealCoachContext, RuleResult, RuleSeverity } from "./coach-rules";

// ── Margin baseline ────────────────────────────────────────────────────────

export interface MarginBaseline {
  medianPct: number | null;
  sampleSize: number;
  usingTeamFallback: boolean;
}

const MIN_PERSONAL_SAMPLES = 5;
const MIN_TEAM_SAMPLES     = 3;

export async function getMarginBaseline(userId: string): Promise<MarginBaseline> {
  // 90-day window of won deals. We read quote_packages.margin_pct (numeric).
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // First try: rep's own wins
  const { data: personalRows } = await supabase
    .from("quote_packages")
    .select("margin_pct")
    .eq("created_by", userId)
    .eq("status", "accepted")
    .gte("created_at", cutoff.toISOString())
    .not("margin_pct", "is", null);

  const personalValues = (personalRows ?? [])
    .map((r) => r.margin_pct as number | null)
    .filter((v): v is number => typeof v === "number");

  if (personalValues.length >= MIN_PERSONAL_SAMPLES) {
    return {
      medianPct: median(personalValues),
      sampleSize: personalValues.length,
      usingTeamFallback: false,
    };
  }

  // Fallback: team-wide wins
  const { data: teamRows } = await supabase
    .from("quote_packages")
    .select("margin_pct")
    .eq("status", "accepted")
    .gte("created_at", cutoff.toISOString())
    .not("margin_pct", "is", null);

  const teamValues = (teamRows ?? [])
    .map((r) => r.margin_pct as number | null)
    .filter((v): v is number => typeof v === "number");

  if (teamValues.length >= MIN_TEAM_SAMPLES) {
    return {
      medianPct: median(teamValues),
      sampleSize: teamValues.length,
      usingTeamFallback: true,
    };
  }

  return { medianPct: null, sampleSize: 0, usingTeamFallback: false };
}

/** Exported for tests. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  if (Number.isInteger(mid)) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[Math.floor(mid)];
}

// ── Active programs for a draft ────────────────────────────────────────────

export async function getActiveProgramsForDraft(
  draft: QuoteWorkspaceDraft,
): Promise<DealCoachContext["activePrograms"]> {
  const brandNames = [
    ...new Set(
      draft.equipment
        .map((e) => (e.make ?? "").trim())
        .filter((m) => m.length > 0),
    ),
  ];
  if (brandNames.length === 0) return [];

  // Resolve names → brand_ids (case-insensitive). qb_brands doesn't have a
  // case-insensitive index today so we do a simple in-clause on exact match
  // plus a fallback ilike per-brand if nothing found. For small brand list
  // (<20) this is fine.
  const { data: brands } = await supabase
    .from("qb_brands")
    .select("id, name, code")
    .in("name", brandNames);
  let resolvedBrands = (brands ?? []) as Array<{ id: string; name: string; code: string | null }>;

  if (resolvedBrands.length === 0) {
    // Try case-insensitive on the first brand name as a fallback (most drafts
    // have one machine).
    const first = brandNames[0];
    const { data: ilikeRows } = await supabase
      .from("qb_brands")
      .select("id, name, code")
      .ilike("name", first);
    resolvedBrands = (ilikeRows ?? []) as typeof resolvedBrands;
  }

  if (resolvedBrands.length === 0) return [];

  const brandIds = resolvedBrands.map((b) => b.id);
  const brandNameById = new Map(resolvedBrands.map((b) => [b.id, b.name]));
  const today = new Date().toISOString().slice(0, 10);

  const { data: programs } = await supabase
    .from("qb_programs")
    .select("id, program_code, program_type, name, brand_id, effective_from, effective_to")
    .in("brand_id", brandIds)
    .eq("active", true)
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`);

  return ((programs ?? []) as Array<{
    id: string;
    program_code: string;
    program_type: string;
    name: string;
    brand_id: string;
  }>).map((p) => ({
    programId:   p.id,
    programCode: p.program_code,
    programType: p.program_type,
    programName: p.name,
    brandName:   brandNameById.get(p.brand_id) ?? "Unknown",
  }));
}

// ── Action persistence ─────────────────────────────────────────────────────

export type CoachActionKind = "shown" | "applied" | "dismissed";

export interface RecordActionInput {
  workspaceId: string;
  quotePackageId: string;
  rule: RuleResult;
  action: CoachActionKind;
  showingUserId: string;
}

export async function recordCoachAction(
  input: RecordActionInput,
): Promise<{ ok: true } | { error: string }> {
  const row = {
    workspace_id:        input.workspaceId,
    quote_package_id:    input.quotePackageId,
    rule_id:             input.rule.ruleId,
    severity:            input.rule.severity,
    action:              input.action === "shown" ? null : input.action,
    suggestion_snapshot: {
      title: input.rule.title,
      body:  input.rule.body,
      why:   input.rule.why,
      action_label: input.rule.action?.label ?? null,
      metrics: input.rule.metrics ?? null,
    },
    shown_by:            input.showingUserId,
    shown_at:            new Date().toISOString(),
    acted_at:            input.action === "shown" ? null : new Date().toISOString(),
  };

  const { error } = await supabase
    .from("qb_deal_coach_actions")
    .upsert(row, { onConflict: "quote_package_id,rule_id" });

  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Returns the set of rule ids already dismissed on this quote — so the
 * sidebar doesn't re-show them after a navigation away and back.
 */
export async function getDismissedRuleIds(
  quotePackageId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("qb_deal_coach_actions")
    .select("rule_id")
    .eq("quote_package_id", quotePackageId)
    .eq("action", "dismissed");
  return new Set((data ?? []).map((r) => (r as { rule_id: string }).rule_id));
}

// ── Severity palette (exported for UI) ─────────────────────────────────────

export const SEVERITY_TONE: Record<RuleSeverity, {
  border: string; bg: string; badge: "destructive" | "warning" | "info";
}> = {
  critical: { border: "border-destructive/40", bg: "bg-destructive/5", badge: "destructive" },
  warning:  { border: "border-warning/40",     bg: "bg-warning/5",     badge: "warning" },
  info:     { border: "border-primary/30",     bg: "bg-primary/5",     badge: "info" },
};
