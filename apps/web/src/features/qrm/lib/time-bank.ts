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
}

export interface TimeBankAggregateRow {
  id: string;
  label: string;
  dealCount: number;
  overCount: number;
  avgPctUsed: number;
  worstDealName: string | null;
  worstPctUsed: number;
}

export interface TimeBankSummary {
  totalDeals: number;
  overBudgetDeals: number;
  pressuredAccounts: number;
  pressuredReps: number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function aggregateRows(
  rows: TimeBankRow[],
  getKey: (row: TimeBankRow) => string | null,
  getLabel: (row: TimeBankRow) => string | null,
): TimeBankAggregateRow[] {
  const grouped = new Map<string, TimeBankRow[]>();

  for (const row of rows) {
    const key = getKey(row);
    if (!key) continue;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .map(([id, bucket]) => {
      const worst = bucket
        .slice()
        .sort((a, b) => b.pct_used - a.pct_used || b.days_in_stage - a.days_in_stage)[0] ?? null;

      return {
        id,
        label: getLabel(bucket[0]) ?? "Unassigned",
        dealCount: bucket.length,
        overCount: bucket.filter((row) => row.is_over).length,
        avgPctUsed: average(bucket.map((row) => row.pct_used)),
        worstDealName: worst?.deal_name ?? null,
        worstPctUsed: worst?.pct_used ?? 0,
      };
    })
    .sort((a, b) => {
      if (b.overCount !== a.overCount) return b.overCount - a.overCount;
      if (b.avgPctUsed !== a.avgPctUsed) return b.avgPctUsed - a.avgPctUsed;
      return a.label.localeCompare(b.label);
    });
}

export function summarizeTimeBank(rows: TimeBankRow[]): TimeBankSummary {
  const accounts = aggregateRows(rows, (row) => row.company_id, (row) => row.company_name);
  const reps = aggregateRows(rows, (row) => row.assigned_rep_id, (row) => row.assigned_rep_name);

  return {
    totalDeals: rows.length,
    overBudgetDeals: rows.filter((row) => row.is_over).length,
    pressuredAccounts: accounts.filter((row) => row.overCount > 0 || row.avgPctUsed >= 1).length,
    pressuredReps: reps.filter((row) => row.overCount > 0 || row.avgPctUsed >= 1).length,
  };
}

export function aggregateTimeBankByAccount(rows: TimeBankRow[]): TimeBankAggregateRow[] {
  return aggregateRows(rows, (row) => row.company_id, (row) => row.company_name);
}

export function aggregateTimeBankByRep(rows: TimeBankRow[]): TimeBankAggregateRow[] {
  return aggregateRows(rows, (row) => row.assigned_rep_id, (row) => row.assigned_rep_name);
}
