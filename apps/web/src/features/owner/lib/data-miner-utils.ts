export type ProfitabilityViewRow = {
  company_id: string | null;
  customer_name: string;
  closed_month: string;
  won_deal_count: number;
  sales_amount: number;
  gross_margin_amount: number;
  gross_margin_pct: number | null;
  last_closed_at: string | null;
};

export type CreditExposureViewRow = {
  company_id: string | null;
  customer_name: string;
  open_invoice_count: number;
  overdue_invoice_count: number;
  open_balance_due: number;
  overdue_balance_due: number;
  max_days_past_due: number;
  oldest_due_date: string | null;
  last_invoice_at: string | null;
  block_status: "active" | "overridden" | "cleared" | null;
  block_reason: string | null;
  current_max_aging_days: number | null;
  override_until: string | null;
  blocked_at: string | null;
  exposure_band: "healthy" | "warning" | "critical";
};

export type ServiceLaborViewRow = {
  labor_date: string;
  branch_id: string | null;
  shop_or_field: string;
  technician_id: string | null;
  technician_name: string;
  job_count: number;
  hours_worked: number;
  billed_value: number;
  quoted_value: number;
  closed_job_count: number;
};

export type ProfitabilityRow = {
  customerName: string;
  wonDealCount: number;
  salesAmount: number;
  grossMarginAmount: number;
  grossMarginPct: number | null;
  lastClosedAt: string | null;
};

export type CreditExposureRow = CreditExposureViewRow;

export type ServiceLaborRow = {
  label: string;
  branchId: string | null;
  shopOrField: string | null;
  technicianId: string | null;
  jobCount: number;
  hoursWorked: number;
  billedValue: number;
  quotedValue: number;
  closedJobCount: number;
};

export type ProfitabilityTimeframe = "current_ytd" | "trailing_90d" | "trailing_365d" | "all_time";
export type ProfitabilitySort = "margin_dollars" | "margin_pct" | "sales";
export type CreditBlockFilter = "all" | "active" | "overridden" | "blocked_only";
export type ServiceGrouping = "technician" | "branch" | "work_mode";

function fiscalYearStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

function cutoffForTimeframe(timeframe: ProfitabilityTimeframe, now: Date): Date | null {
  if (timeframe === "all_time") return null;
  if (timeframe === "current_ytd") return fiscalYearStart(now);
  const days = timeframe === "trailing_90d" ? 90 : 365;
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
}

function normalizeNeedle(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function buildProfitabilityRows(
  rows: ProfitabilityViewRow[],
  filters: {
    search?: string;
    timeframe?: ProfitabilityTimeframe;
    sortBy?: ProfitabilitySort;
    limit?: number;
    now?: Date;
  },
): ProfitabilityRow[] {
  const now = filters.now ?? new Date();
  const cutoff = cutoffForTimeframe(filters.timeframe ?? "current_ytd", now);
  const needle = normalizeNeedle(filters.search);
  const byCustomer = new Map<string, ProfitabilityRow>();

  for (const row of rows) {
    const rowDate = row.last_closed_at ? new Date(row.last_closed_at) : new Date(row.closed_month);
    if (cutoff && rowDate < cutoff) continue;
    if (needle && !row.customer_name.toLowerCase().includes(needle)) continue;
    const key = row.company_id ?? row.customer_name;
    const existing = byCustomer.get(key) ?? {
      customerName: row.customer_name,
      wonDealCount: 0,
      salesAmount: 0,
      grossMarginAmount: 0,
      grossMarginPct: null,
      lastClosedAt: row.last_closed_at,
    };
    existing.wonDealCount += row.won_deal_count;
    existing.salesAmount += row.sales_amount;
    existing.grossMarginAmount += row.gross_margin_amount;
    if (!existing.lastClosedAt || (row.last_closed_at && row.last_closed_at > existing.lastClosedAt)) {
      existing.lastClosedAt = row.last_closed_at;
    }
    byCustomer.set(key, existing);
  }

  const built = Array.from(byCustomer.values()).map((row) => ({
    ...row,
    grossMarginPct:
      row.salesAmount > 0 ? Number(((row.grossMarginAmount / row.salesAmount) * 100).toFixed(2)) : null,
  }));

  const sortBy = filters.sortBy ?? "margin_dollars";
  built.sort((a, b) => {
    if (sortBy === "sales") return b.salesAmount - a.salesAmount;
    if (sortBy === "margin_pct") return (b.grossMarginPct ?? -Infinity) - (a.grossMarginPct ?? -Infinity);
    return b.grossMarginAmount - a.grossMarginAmount;
  });

  return built.slice(0, filters.limit ?? 25);
}

export function buildCreditExposureRows(
  rows: CreditExposureViewRow[],
  filters: {
    search?: string;
    minDaysPastDue?: number;
    blockFilter?: CreditBlockFilter;
    limit?: number;
  },
): CreditExposureRow[] {
  const needle = normalizeNeedle(filters.search);
  const minDaysPastDue = filters.minDaysPastDue ?? 0;
  const blockFilter = filters.blockFilter ?? "all";

  const filtered = rows.filter((row) => {
    if (needle && !row.customer_name.toLowerCase().includes(needle)) return false;
    if ((row.max_days_past_due ?? 0) < minDaysPastDue) return false;
    if (blockFilter === "active" && row.block_status !== "active") return false;
    if (blockFilter === "overridden" && row.block_status !== "overridden") return false;
    if (blockFilter === "blocked_only" && !row.block_status) return false;
    return true;
  });

  const severity = { critical: 0, warning: 1, healthy: 2 } as const;
  filtered.sort((a, b) => {
    if (severity[a.exposure_band] !== severity[b.exposure_band]) {
      return severity[a.exposure_band] - severity[b.exposure_band];
    }
    return b.overdue_balance_due - a.overdue_balance_due;
  });

  return filtered.slice(0, filters.limit ?? 25);
}

export function buildServiceLaborRows(
  rows: ServiceLaborViewRow[],
  filters: {
    search?: string;
    windowDays?: number;
    groupBy?: ServiceGrouping;
    branchId?: string;
    limit?: number;
    now?: Date;
  },
): ServiceLaborRow[] {
  const needle = normalizeNeedle(filters.search);
  const now = filters.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - (filters.windowDays ?? 90));
  const groupBy = filters.groupBy ?? "technician";
  const byGroup = new Map<string, ServiceLaborRow>();

  for (const row of rows) {
    const laborDate = new Date(row.labor_date);
    if (laborDate < cutoff) continue;
    if (filters.branchId && row.branch_id !== filters.branchId) continue;
    const label =
      groupBy === "branch"
        ? row.branch_id || "No branch"
        : groupBy === "work_mode"
        ? row.shop_or_field === "field"
          ? "Field"
          : "Shop"
        : row.technician_name;
    if (needle && !label.toLowerCase().includes(needle)) continue;
    const key =
      groupBy === "branch"
        ? row.branch_id || "No branch"
        : groupBy === "work_mode"
        ? row.shop_or_field || "unknown"
        : row.technician_id || row.technician_name;
    const existing = byGroup.get(key) ?? {
      label,
      branchId: groupBy === "branch" ? row.branch_id : null,
      shopOrField: groupBy === "work_mode" ? row.shop_or_field : null,
      technicianId: groupBy === "technician" ? row.technician_id : null,
      jobCount: 0,
      hoursWorked: 0,
      billedValue: 0,
      quotedValue: 0,
      closedJobCount: 0,
    };
    existing.jobCount += row.job_count;
    existing.hoursWorked += row.hours_worked;
    existing.billedValue += row.billed_value;
    existing.quotedValue += row.quoted_value;
    existing.closedJobCount += row.closed_job_count;
    byGroup.set(key, existing);
  }

  const built = Array.from(byGroup.values()).map((row) => ({
    ...row,
    hoursWorked: Number(row.hoursWorked.toFixed(2)),
    billedValue: Number(row.billedValue.toFixed(2)),
    quotedValue: Number(row.quotedValue.toFixed(2)),
  }));

  built.sort((a, b) => b.hoursWorked - a.hoursWorked);
  return built.slice(0, filters.limit ?? 25);
}
