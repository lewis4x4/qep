/**
 * QRM Command Center — Knowledge Gaps + Absence Engine builder.
 *
 * Pure function, no IO. Computes per-rep data absence scores and surfaces
 * top knowledge gaps. Manager-only — reps never see this data.
 */

import type {
  KnowledgeGapItem,
  KnowledgeGapsPayload,
  RepAbsenceRow,
} from "./types.ts";

// ─── Row types ─────────────────────────────────────────────────────────────

export interface KnowledgeGapRow {
  id: string;
  question: string | null;
  frequency: number | null;
  last_asked_at: string | null;
  user_id: string | null;
  profiles: { iron_role: string | null } | { iron_role: string | null }[] | null;
}

export interface DealAbsenceRow {
  id: string;
  assigned_rep_id: string | null;
  amount: number | null;
  expected_close_on: string | null;
  primary_contact_id: string | null;
  company_id: string | null;
  profiles: { full_name: string | null; iron_role: string | null } | { full_name: string | null; iron_role: string | null }[] | null;
}

export interface AssessmentRow {
  id: string;
  created_by: string | null;
  completeness_pct: number | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function unwrapJoin<T>(val: T | T[] | null): T | null {
  if (!val) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

// ─── Builders ──────────────────────────────────────────────────────────────

function buildTopGaps(gaps: KnowledgeGapRow[] | null): KnowledgeGapItem[] {
  if (!gaps) return [];
  return gaps
    .filter((g) => g.question)
    .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))
    .slice(0, 10)
    .map((g) => ({
      id: g.id,
      question: g.question!,
      frequency: g.frequency ?? 1,
      lastAskedAt: g.last_asked_at ?? "",
      askedByRole: unwrapJoin(g.profiles)?.iron_role ?? null,
    }));
}

interface FieldGap {
  field: string;
  label: string;
  missing: number;
  total: number;
}

export function buildRepAbsence(
  deals: DealAbsenceRow[] | null,
): { repAbsence: RepAbsenceRow[]; worstFields: Array<{ field: string; label: string; missingPct: number }> } {
  if (!deals || deals.length === 0) {
    return { repAbsence: [], worstFields: [] };
  }

  // Group deals by rep
  const repMap = new Map<string, {
    repName: string;
    ironRole: string | null;
    deals: DealAbsenceRow[];
  }>();

  // Global field counters
  const fields: FieldGap[] = [
    { field: "amount", label: "Deal amount", missing: 0, total: 0 },
    { field: "expected_close_on", label: "Expected close date", missing: 0, total: 0 },
    { field: "primary_contact_id", label: "Primary contact", missing: 0, total: 0 },
    { field: "company_id", label: "Company", missing: 0, total: 0 },
  ];

  // Global field tracking across ALL deals (not just rep-assigned)
  for (const deal of deals) {
    fields[0].total++; if (deal.amount == null) fields[0].missing++;
    fields[1].total++; if (deal.expected_close_on == null) fields[1].missing++;
    fields[2].total++; if (deal.primary_contact_id == null) fields[2].missing++;
    fields[3].total++; if (deal.company_id == null) fields[3].missing++;
  }

  // Per-rep grouping (only deals with assigned reps)
  for (const deal of deals) {
    const repId = deal.assigned_rep_id;
    if (!repId) continue;

    const profile = unwrapJoin(deal.profiles);
    if (!repMap.has(repId)) {
      repMap.set(repId, {
        repName: profile?.full_name ?? "Unknown",
        ironRole: profile?.iron_role ?? null,
        deals: [],
      });
    }
    repMap.get(repId)!.deals.push(deal);
  }

  // Compute per-rep scores
  const repAbsence: RepAbsenceRow[] = [];
  for (const [repId, entry] of repMap) {
    const d = entry.deals;
    const count = d.length;
    if (count === 0) continue;

    const missingAmount = d.filter((x) => x.amount == null).length;
    const missingCloseDate = d.filter((x) => x.expected_close_on == null).length;
    const missingContact = d.filter((x) => x.primary_contact_id == null).length;
    const missingCompany = d.filter((x) => x.company_id == null).length;
    const totalGaps = missingAmount + missingCloseDate + missingContact + missingCompany;
    const totalFields = count * 4; // 4 tracked fields per deal
    const absenceScore = totalFields > 0 ? Math.round((1 - totalGaps / totalFields) * 100) / 100 : 1;

    repAbsence.push({
      repId,
      repName: entry.repName,
      ironRole: entry.ironRole,
      dealCount: count,
      missingAmount,
      missingCloseDate,
      missingContact,
      missingCompany,
      absenceScore,
    });
  }

  // Sort by absence score ascending (worst data first)
  repAbsence.sort((a, b) => a.absenceScore - b.absenceScore);

  // Worst fields: top 3 by missing percentage
  const worstFields = fields
    .filter((fg) => fg.total > 0 && fg.missing > 0)
    .map((fg) => ({
      field: fg.field,
      label: fg.label,
      missingPct: Math.round((fg.missing / fg.total) * 100),
    }))
    .sort((a, b) => b.missingPct - a.missingPct)
    .slice(0, 3);

  return { repAbsence, worstFields };
}

// ─── Main builder ──────────────────────────────────────────────────────────

export function buildKnowledgeGapsPayload(
  gaps: KnowledgeGapRow[] | null,
  deals: DealAbsenceRow[] | null,
  isManagerView: boolean,
): KnowledgeGapsPayload {
  if (!isManagerView) {
    return { topGaps: [], repAbsence: [], worstFields: [], isManagerView: false };
  }

  const topGaps = buildTopGaps(gaps);
  const { repAbsence, worstFields } = buildRepAbsence(deals);

  return { topGaps, repAbsence, worstFields, isManagerView: true };
}
