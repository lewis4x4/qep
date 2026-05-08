export type TimeBankBudgetSource = "stage_sla" | "fallback";
export type TimeBankPressureTier = "over" | "critical" | "watch" | "healthy";
export type TimeBankSignalTone = "hot" | "warm" | "active" | "cool";

export interface TimeBankRow {
  deal_id: string;
  deal_name: string;
  company_id: string | null;
  company_name: string | null;
  assigned_rep_id: string | null;
  assigned_rep_name: string | null;
  stage_id: string;
  stage_name: string;
  days_in_stage: number;
  stage_age_days: number;
  budget_days: number;
  has_explicit_budget: boolean;
  remaining_days: number;
  pct_used: number;
  is_over: boolean;
  overrun_days: number;
  budget_source: TimeBankBudgetSource;
  pressure_tier: TimeBankPressureTier;
}

export interface TimeBankAggregateRow {
  id: string;
  entityId: string | null;
  label: string;
  isMissingEntity: boolean;
  dealCount: number;
  overCount: number;
  criticalCount: number;
  watchCount: number;
  fallbackBudgetCount: number;
  avgPctUsed: number;
  totalOverrunDays: number;
  worstDealName: string | null;
  worstPctUsed: number;
}

export interface TimeBankSummary {
  totalDeals: number;
  overBudgetDeals: number;
  criticalDeals: number;
  watchDeals: number;
  pressuredAccounts: number;
  pressuredReps: number;
  unassignedDeals: number;
  noAccountDeals: number;
  fallbackBudgetDeals: number;
  totalOverrunDays: number;
}

export interface TimeBankIntervention {
  id: string;
  dealId: string;
  dealName: string;
  companyId: string | null;
  companyName: string;
  assignedRepName: string;
  stageName: string;
  tier: TimeBankPressureTier;
  priorityScore: number;
  headline: string;
  trace: string[];
  chips: Array<{ label: string; value: string; tone: TimeBankSignalTone }>;
  primaryAction: { label: string; href: string };
  secondaryActions: Array<{ label: string; href: string }>;
  askIronQuestion: string;
}

const NO_ACCOUNT_ID = "__no_account__";
const UNASSIGNED_REP_ID = "__unassigned_rep__";

function coerceNumber(value: unknown, fallback = 0): number {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function coerceNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function pressureTierFor(row: Pick<TimeBankRow, "is_over" | "pct_used">): TimeBankPressureTier {
  if (row.is_over) return "over";
  if (row.pct_used >= 0.85) return "critical";
  if (row.pct_used >= 0.65) return "watch";
  return "healthy";
}

function normalizeBudgetSource(value: unknown, hasExplicitBudget: boolean): TimeBankBudgetSource {
  return value === "stage_sla" || value === "fallback" ? value : hasExplicitBudget ? "stage_sla" : "fallback";
}

function normalizePressureTier(value: unknown, row: Pick<TimeBankRow, "is_over" | "pct_used">): TimeBankPressureTier {
  if (row.is_over) return "over";
  return value === "critical" || value === "watch" || value === "healthy"
    ? value
    : pressureTierFor(row);
}

export function normalizeTimeBankRows(raw: unknown): TimeBankRow[] {
  if (!Array.isArray(raw)) return [];

  const byDeal = new Map<string, TimeBankRow>();

  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Record<string, unknown>;
    const dealId = coerceNullableString(candidate.deal_id);
    if (!dealId) continue;

    const budgetDays = Math.max(1, Math.round(coerceNumber(candidate.budget_days, 14)));
    const daysInStage = Math.max(0, Math.round(coerceNumber(candidate.days_in_stage)));
    const pctUsed = Math.max(0, coerceNumber(candidate.pct_used, daysInStage / budgetDays));
    const explicitIsOver = typeof candidate.is_over === "boolean" ? candidate.is_over : undefined;
    const isOver = explicitIsOver ?? (daysInStage > budgetDays || pctUsed >= 1);
    const hasExplicitBudget = Boolean(candidate.has_explicit_budget);
    const remainingDays = Math.max(0, Math.round(coerceNumber(candidate.remaining_days, Math.max(budgetDays - daysInStage, 0))));
    const overrunDays = Math.max(0, Math.round(coerceNumber(candidate.overrun_days, daysInStage - budgetDays)));
    const baseRow = {
      is_over: isOver,
      pct_used: pctUsed,
    };

    const row: TimeBankRow = {
      deal_id: dealId,
      deal_name: coerceString(candidate.deal_name, "Untitled deal"),
      company_id: coerceNullableString(candidate.company_id),
      company_name: coerceNullableString(candidate.company_name),
      assigned_rep_id: coerceNullableString(candidate.assigned_rep_id),
      assigned_rep_name: coerceNullableString(candidate.assigned_rep_name),
      stage_id: coerceString(candidate.stage_id, "unknown-stage"),
      stage_name: coerceString(candidate.stage_name, "Unknown stage"),
      days_in_stage: daysInStage,
      stage_age_days: Math.max(0, Math.round(coerceNumber(candidate.stage_age_days, daysInStage))),
      budget_days: budgetDays,
      has_explicit_budget: hasExplicitBudget,
      remaining_days: remainingDays,
      pct_used: pctUsed,
      is_over: isOver,
      overrun_days: overrunDays,
      budget_source: normalizeBudgetSource(candidate.budget_source, hasExplicitBudget),
      pressure_tier: normalizePressureTier(candidate.pressure_tier, baseRow),
    };

    const existing = byDeal.get(dealId);
    if (!existing || row.pct_used > existing.pct_used || (row.pct_used === existing.pct_used && row.days_in_stage > existing.days_in_stage)) {
      byDeal.set(dealId, row);
    }
  }

  return [...byDeal.values()];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function aggregateRows(
  rows: TimeBankRow[],
  getKey: (row: TimeBankRow) => string | null,
  getLabel: (row: TimeBankRow) => string | null,
  missing: { id: string; label: string },
): TimeBankAggregateRow[] {
  const grouped = new Map<string, { entityId: string | null; label: string; isMissingEntity: boolean; rows: TimeBankRow[] }>();

  for (const row of rows) {
    const entityId = getKey(row);
    const id = entityId ?? missing.id;
    const bucket = grouped.get(id) ?? {
      entityId,
      label: entityId ? getLabel(row) ?? missing.label : missing.label,
      isMissingEntity: !entityId,
      rows: [],
    };
    bucket.rows.push(row);
    grouped.set(id, bucket);
  }

  return [...grouped.entries()]
    .map(([id, bucket]) => {
      const worst = bucket.rows
        .slice()
        .sort((a, b) => b.pct_used - a.pct_used || b.days_in_stage - a.days_in_stage)[0] ?? null;

      return {
        id,
        entityId: bucket.entityId,
        label: bucket.label,
        isMissingEntity: bucket.isMissingEntity,
        dealCount: bucket.rows.length,
        overCount: bucket.rows.filter((row) => row.is_over).length,
        criticalCount: bucket.rows.filter((row) => row.pressure_tier === "critical").length,
        watchCount: bucket.rows.filter((row) => row.pressure_tier === "watch").length,
        fallbackBudgetCount: bucket.rows.filter((row) => row.budget_source === "fallback" || !row.has_explicit_budget).length,
        avgPctUsed: average(bucket.rows.map((row) => row.pct_used)),
        totalOverrunDays: bucket.rows.reduce((sum, row) => sum + row.overrun_days, 0),
        worstDealName: worst?.deal_name ?? null,
        worstPctUsed: worst?.pct_used ?? 0,
      };
    })
    .sort((a, b) => {
      if (b.overCount !== a.overCount) return b.overCount - a.overCount;
      if (b.criticalCount !== a.criticalCount) return b.criticalCount - a.criticalCount;
      if (b.watchCount !== a.watchCount) return b.watchCount - a.watchCount;
      if (b.avgPctUsed !== a.avgPctUsed) return b.avgPctUsed - a.avgPctUsed;
      return a.label.localeCompare(b.label);
    });
}

function isPressuredAggregate(row: TimeBankAggregateRow): boolean {
  return row.overCount > 0 || row.criticalCount > 0 || row.watchCount > 0 || row.isMissingEntity;
}

export function summarizeTimeBank(rows: TimeBankRow[]): TimeBankSummary {
  const normalized = normalizeTimeBankRows(rows);
  const accounts = aggregateTimeBankByAccount(normalized);
  const reps = aggregateTimeBankByRep(normalized);

  return {
    totalDeals: normalized.length,
    overBudgetDeals: normalized.filter((row) => row.is_over).length,
    criticalDeals: normalized.filter((row) => row.pressure_tier === "critical").length,
    watchDeals: normalized.filter((row) => row.pressure_tier === "watch").length,
    pressuredAccounts: accounts.filter(isPressuredAggregate).length,
    pressuredReps: reps.filter(isPressuredAggregate).length,
    unassignedDeals: normalized.filter((row) => !row.assigned_rep_id).length,
    noAccountDeals: normalized.filter((row) => !row.company_id).length,
    fallbackBudgetDeals: normalized.filter((row) => row.budget_source === "fallback" || !row.has_explicit_budget).length,
    totalOverrunDays: normalized.reduce((sum, row) => sum + row.overrun_days, 0),
  };
}

export function aggregateTimeBankByAccount(rows: TimeBankRow[]): TimeBankAggregateRow[] {
  return aggregateRows(normalizeTimeBankRows(rows), (row) => row.company_id, (row) => row.company_name, {
    id: NO_ACCOUNT_ID,
    label: "No account",
  });
}

export function aggregateTimeBankByRep(rows: TimeBankRow[]): TimeBankAggregateRow[] {
  return aggregateRows(normalizeTimeBankRows(rows), (row) => row.assigned_rep_id, (row) => row.assigned_rep_name, {
    id: UNASSIGNED_REP_ID,
    label: "Unassigned",
  });
}

function priorityBase(tier: TimeBankPressureTier): number {
  if (tier === "over") return 80;
  if (tier === "critical") return 60;
  if (tier === "watch") return 35;
  return 20;
}

function actionHrefForAccount(companyId: string): string {
  return `/qrm/accounts/${companyId}/command`;
}

function askIronQuestionForRow(row: TimeBankRow): string {
  const company = row.company_name ?? "No account";
  if (row.is_over) {
    return `What's blocking deal ${row.deal_name} at ${company}? It has been in ${row.stage_name} for ${row.days_in_stage}d, ${row.overrun_days}d over the ${row.budget_days}d budget.`;
  }
  return `How should I move deal ${row.deal_name} at ${company} forward in ${row.stage_name}? It has used ${Math.round(row.pct_used * 100)}% of its ${row.budget_days}d budget.`;
}

export function buildTimeBankInterventions(rows: TimeBankRow[]): TimeBankIntervention[] {
  return normalizeTimeBankRows(rows)
    .filter((row) => row.is_over || row.pct_used >= 0.65 || !row.assigned_rep_id || !row.company_id)
    .map((row) => {
      const tier = row.pressure_tier;
      const priorityScore =
        priorityBase(tier) +
        Math.min(40, row.overrun_days * 4) +
        Math.min(20, Math.round(row.pct_used * 10)) +
        (!row.assigned_rep_id ? 10 : 0) +
        (!row.company_id ? 6 : 0) +
        (row.budget_source === "fallback" && row.pct_used >= 0.65 ? 4 : 0);
      const companyName = row.company_name ?? "No account";
      const assignedRepName = row.assigned_rep_name ?? "Unassigned";
      const trace = [
        `Stage ${row.stage_name} has used ${Math.round(row.pct_used * 100)}% of its ${row.budget_days}d SLA budget.`,
        row.is_over ? `Overrun: ${row.overrun_days}d beyond budget.` : `${row.remaining_days}d remain before breach.`,
        `Budget source: ${row.budget_source === "stage_sla" ? "explicit stage SLA" : "fallback SLA"}.`,
        `Owner: ${assignedRepName}.`,
      ];
      if (!row.company_id) trace.push("Account: No account linked.");

      const chips: TimeBankIntervention["chips"] = [
        { label: tier, value: `${Math.round(row.pct_used * 100)}%`, tone: tier === "over" ? "hot" : tier === "critical" ? "warm" : tier === "watch" ? "active" : "cool" },
        row.is_over
          ? { label: "Overrun", value: `${row.overrun_days}d`, tone: "hot" }
          : { label: "Left", value: `${row.remaining_days}d`, tone: tier === "critical" ? "warm" : "cool" },
      ];
      if (row.budget_source === "fallback") chips.push({ label: "Budget", value: "Fallback", tone: "warm" });
      if (!row.assigned_rep_id) chips.push({ label: "Owner", value: "Open", tone: "hot" });
      if (!row.company_id) chips.push({ label: "Account", value: "Missing", tone: "hot" });

      const secondaryActions = [
        { label: "Detail", href: `/qrm/deals/${row.deal_id}` },
        ...(row.company_id ? [{ label: "Account", href: actionHrefForAccount(row.company_id) }] : []),
        { label: "Blockers", href: "/qrm/command/blockers" },
        { label: "Quotes", href: "/qrm/command/quotes" },
      ];

      return {
        id: `time-bank-${row.deal_id}`,
        dealId: row.deal_id,
        dealName: row.deal_name,
        companyId: row.company_id,
        companyName,
        assignedRepName,
        stageName: row.stage_name,
        tier,
        priorityScore,
        headline: row.is_over
          ? `${row.deal_name} is ${row.overrun_days}d over its stage budget.`
          : `${row.deal_name} is approaching its stage ceiling.`,
        trace,
        chips,
        primaryAction: {
          label: row.is_over || row.pressure_tier === "critical" ? "Deal Room" : "Deal Detail",
          href: row.is_over || row.pressure_tier === "critical" ? `/qrm/deals/${row.deal_id}/room` : `/qrm/deals/${row.deal_id}`,
        },
        secondaryActions,
        askIronQuestion: askIronQuestionForRow(row),
      } satisfies TimeBankIntervention;
    })
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      const overrunDelta = Number(b.chips.find((chip) => chip.label === "Overrun")?.value.replace("d", "") ?? 0) - Number(a.chips.find((chip) => chip.label === "Overrun")?.value.replace("d", "") ?? 0);
      if (overrunDelta !== 0) return overrunDelta;
      return a.dealName.localeCompare(b.dealName);
    });
}
