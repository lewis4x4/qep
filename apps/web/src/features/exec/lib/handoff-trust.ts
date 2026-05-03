export type IronRole = "iron_manager" | "iron_advisor" | "iron_woman" | "iron_man";

export interface HandoffEventEvidence {
  sender_activity_count?: number;
  first_action_at?: string | null;
  first_action_type?: string | null;
  hours_to_first_action?: number | null;
}

export interface HandoffEventRow {
  id: string;
  subject_id: string;
  subject_label: string | null;
  handoff_reason: string | null;
  handoff_at: string;
  from_iron_role: IronRole;
  to_iron_role: IronRole;
  composite_score: number | null;
  info_completeness: number | null;
  recipient_readiness: number | null;
  outcome_alignment: number | null;
  outcome: "improved" | "unchanged" | "degraded" | "unknown" | null;
  evidence: Record<string, unknown> | null;
}

export interface HandoffSeamScoreRow {
  id: string;
  from_iron_role: IronRole;
  to_iron_role: IronRole;
  handoff_count: number;
  scored_count: number;
  avg_composite: number | null;
  avg_info_completeness: number | null;
  avg_recipient_readiness: number | null;
  avg_outcome_alignment: number | null;
  improved_pct: number | null;
  degraded_pct: number | null;
  period_start: string;
  period_end: string;
}

export interface HandoffSeamSummary {
  key: string;
  from_iron_role: IronRole;
  to_iron_role: IronRole;
  handoff_count: number;
  scored_count: number;
  avg_composite: number | null;
  avg_info_completeness: number | null;
  avg_recipient_readiness: number | null;
  avg_outcome_alignment: number | null;
  improved_pct: number;
  degraded_pct: number;
}

export interface HandoffFilterState {
  windowDays: 7 | 30 | 90;
  fromRole: IronRole | "all";
  toRole: IronRole | "all";
  reason: string | "all";
  lowScoreOnly: boolean;
}

export const HANDOFF_ROLE_LABELS: Record<IronRole, string> = {
  iron_manager: "MGR",
  iron_advisor: "ADV",
  iron_woman: "WMN",
  iron_man: "MAN",
};

export const HANDOFF_ROLE_TITLES: Record<IronRole, string> = {
  iron_manager: "Iron Manager",
  iron_advisor: "Iron Advisor",
  iron_woman: "Iron Woman",
  iron_man: "Iron Man",
};

const IRON_ROLES = new Set<IronRole>(["iron_manager", "iron_advisor", "iron_woman", "iron_man"]);
const HANDOFF_OUTCOMES = new Set<NonNullable<HandoffEventRow["outcome"]>>(["improved", "unchanged", "degraded", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerOrDefault(value: unknown, fallback = 0): number {
  const parsed = numberOrNull(value);
  return parsed == null ? fallback : Math.trunc(parsed);
}

function dateStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function roleOrNull(value: unknown): IronRole | null {
  return typeof value === "string" && IRON_ROLES.has(value as IronRole) ? value as IronRole : null;
}

function outcomeOrNull(value: unknown): HandoffEventRow["outcome"] {
  return typeof value === "string" && HANDOFF_OUTCOMES.has(value as NonNullable<HandoffEventRow["outcome"]>)
    ? value as NonNullable<HandoffEventRow["outcome"]>
    : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function normalizeHandoffEventRows(rows: unknown): HandoffEventRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const subjectId = stringOrNull(row.subject_id);
    const handoffAt = dateStringOrNull(row.handoff_at);
    const fromRole = roleOrNull(row.from_iron_role);
    const toRole = roleOrNull(row.to_iron_role);
    if (!id || !subjectId || !handoffAt || !fromRole || !toRole) return [];

    return [{
      id,
      subject_id: subjectId,
      subject_label: stringOrNull(row.subject_label),
      handoff_reason: stringOrNull(row.handoff_reason),
      handoff_at: handoffAt,
      from_iron_role: fromRole,
      to_iron_role: toRole,
      composite_score: numberOrNull(row.composite_score),
      info_completeness: numberOrNull(row.info_completeness),
      recipient_readiness: numberOrNull(row.recipient_readiness),
      outcome_alignment: numberOrNull(row.outcome_alignment),
      outcome: outcomeOrNull(row.outcome),
      evidence: recordOrNull(row.evidence),
    }];
  });
}

export function normalizeHandoffSeamScoreRows(rows: unknown): HandoffSeamScoreRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const fromRole = roleOrNull(row.from_iron_role);
    const toRole = roleOrNull(row.to_iron_role);
    const periodStart = dateStringOrNull(row.period_start);
    const periodEnd = dateStringOrNull(row.period_end);
    if (!id || !fromRole || !toRole || !periodStart || !periodEnd) return [];

    return [{
      id,
      from_iron_role: fromRole,
      to_iron_role: toRole,
      handoff_count: integerOrDefault(row.handoff_count),
      scored_count: integerOrDefault(row.scored_count),
      avg_composite: numberOrNull(row.avg_composite),
      avg_info_completeness: numberOrNull(row.avg_info_completeness),
      avg_recipient_readiness: numberOrNull(row.avg_recipient_readiness),
      avg_outcome_alignment: numberOrNull(row.avg_outcome_alignment),
      improved_pct: numberOrNull(row.improved_pct),
      degraded_pct: numberOrNull(row.degraded_pct),
      period_start: periodStart,
      period_end: periodEnd,
    }];
  });
}

export function scoreTone(score: number | null): string {
  if (score === null) return "bg-white/5 text-slate-600";
  if (score >= 0.8) return "bg-emerald-500/20 text-emerald-400";
  if (score >= 0.6) return "bg-yellow-500/20 text-yellow-400";
  if (score >= 0.4) return "bg-orange-500/20 text-orange-400";
  return "bg-red-500/20 text-red-400";
}

export function formatScore(score: number | null): string {
  if (score === null) return "—";
  return `${Math.round(score * 100)}`;
}

export function parseHandoffEvidence(value: Record<string, unknown> | null): HandoffEventEvidence {
  if (!value || typeof value !== "object") return {};
  return {
    sender_activity_count:
      typeof value.sender_activity_count === "number" ? value.sender_activity_count : undefined,
    first_action_at:
      typeof value.first_action_at === "string" ? value.first_action_at : null,
    first_action_type:
      typeof value.first_action_type === "string" ? value.first_action_type : null,
    hours_to_first_action:
      typeof value.hours_to_first_action === "number" ? value.hours_to_first_action : null,
  };
}

export function latestSeamScores(rows: HandoffSeamScoreRow[]): HandoffSeamScoreRow[] {
  const latest = new Map<string, HandoffSeamScoreRow>();
  for (const row of rows) {
    const key = `${row.from_iron_role}:${row.to_iron_role}`;
    const existing = latest.get(key);
    if (!existing || Date.parse(row.period_end) > Date.parse(existing.period_end)) {
      latest.set(key, row);
    }
  }
  return [...latest.values()].sort((a, b) => {
    const aScore = a.avg_composite ?? 999;
    const bScore = b.avg_composite ?? 999;
    if (aScore !== bScore) return aScore - bScore;
    return b.handoff_count - a.handoff_count;
  });
}

export function filterHandoffEvents(
  events: HandoffEventRow[],
  filters: HandoffFilterState,
  now = new Date(),
): HandoffEventRow[] {
  const windowStart = now.getTime() - filters.windowDays * 86_400_000;

  return events.filter((event) => {
    if (Date.parse(event.handoff_at) < windowStart) return false;
    if (filters.fromRole !== "all" && event.from_iron_role !== filters.fromRole) return false;
    if (filters.toRole !== "all" && event.to_iron_role !== filters.toRole) return false;
    if (filters.reason !== "all" && (event.handoff_reason ?? "unknown") !== filters.reason) return false;
    if (filters.lowScoreOnly && (event.composite_score ?? 1) >= 0.6) return false;
    return true;
  });
}

function average(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => typeof value === "number");
  if (numeric.length === 0) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

export function buildSeamSummaries(events: HandoffEventRow[]): HandoffSeamSummary[] {
  const grouped = new Map<string, HandoffEventRow[]>();
  for (const event of events) {
    const key = `${event.from_iron_role}:${event.to_iron_role}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(event);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .map(([key, rows]) => {
      const scored = rows.filter((row) => row.composite_score !== null);
      const outcomeRows = rows.filter((row) => row.outcome !== null);
      const improvedCount = outcomeRows.filter((row) => row.outcome === "improved").length;
      const degradedCount = outcomeRows.filter((row) => row.outcome === "degraded").length;

      return {
        key,
        from_iron_role: rows[0].from_iron_role,
        to_iron_role: rows[0].to_iron_role,
        handoff_count: rows.length,
        scored_count: scored.length,
        avg_composite: average(rows.map((row) => row.composite_score)),
        avg_info_completeness: average(rows.map((row) => row.info_completeness)),
        avg_recipient_readiness: average(rows.map((row) => row.recipient_readiness)),
        avg_outcome_alignment: average(rows.map((row) => row.outcome_alignment)),
        improved_pct: outcomeRows.length === 0 ? 0 : improvedCount / outcomeRows.length,
        degraded_pct: outcomeRows.length === 0 ? 0 : degradedCount / outcomeRows.length,
      };
    })
    .sort((a, b) => {
      const aScore = a.avg_composite ?? 999;
      const bScore = b.avg_composite ?? 999;
      if (aScore !== bScore) return aScore - bScore;
      return b.handoff_count - a.handoff_count;
    });
}

export function summarizeHandoffs(events: HandoffEventRow[], seams: HandoffSeamSummary[]) {
  const degradedCount = events.filter((event) => event.outcome === "degraded").length;

  return {
    totalHandoffs: events.length,
    degradedPct: events.length === 0 ? 0 : degradedCount / events.length,
    worstSeam: seams[0] ?? null,
    bestSeam: seams[seams.length - 1] ?? null,
  };
}
