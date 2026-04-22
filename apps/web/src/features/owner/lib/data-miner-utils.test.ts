import { describe, expect, test } from "bun:test";
import {
  buildCreditExposureRows,
  buildProfitabilityRows,
  buildServiceLaborRows,
  type CreditExposureViewRow,
  type ProfitabilityViewRow,
  type ServiceLaborViewRow,
} from "./data-miner-utils";

const profitabilityRows: ProfitabilityViewRow[] = [
  {
    company_id: "company-1",
    customer_name: "Cooper Timber",
    closed_month: "2026-04-01",
    won_deal_count: 2,
    sales_amount: 100000,
    gross_margin_amount: 24000,
    gross_margin_pct: 24,
    last_closed_at: "2026-04-20T00:00:00.000Z",
  },
  {
    company_id: "company-1",
    customer_name: "Cooper Timber",
    closed_month: "2026-03-01",
    won_deal_count: 1,
    sales_amount: 25000,
    gross_margin_amount: 5000,
    gross_margin_pct: 20,
    last_closed_at: "2026-03-14T00:00:00.000Z",
  },
  {
    company_id: "company-2",
    customer_name: "PMC Services",
    closed_month: "2025-10-01",
    won_deal_count: 1,
    sales_amount: 120000,
    gross_margin_amount: 12000,
    gross_margin_pct: 10,
    last_closed_at: "2025-10-10T00:00:00.000Z",
  },
];

const creditRows: CreditExposureViewRow[] = [
  {
    company_id: "company-1",
    customer_name: "Cooper Timber",
    open_invoice_count: 3,
    overdue_invoice_count: 2,
    open_balance_due: 60000,
    overdue_balance_due: 52000,
    max_days_past_due: 94,
    oldest_due_date: "2026-01-02",
    last_invoice_at: "2026-04-20T00:00:00.000Z",
    block_status: "active",
    block_reason: "AR block",
    current_max_aging_days: 94,
    override_until: null,
    blocked_at: "2026-04-21T00:00:00.000Z",
    exposure_band: "critical",
  },
  {
    company_id: "company-2",
    customer_name: "PMC Services",
    open_invoice_count: 2,
    overdue_invoice_count: 1,
    open_balance_due: 12000,
    overdue_balance_due: 11000,
    max_days_past_due: 61,
    oldest_due_date: "2026-02-10",
    last_invoice_at: "2026-04-19T00:00:00.000Z",
    block_status: "overridden",
    block_reason: "Temporary override",
    current_max_aging_days: 61,
    override_until: "2026-05-01T00:00:00.000Z",
    blocked_at: "2026-04-18T00:00:00.000Z",
    exposure_band: "warning",
  },
  {
    company_id: "company-3",
    customer_name: "Healthy Earthworks",
    open_invoice_count: 1,
    overdue_invoice_count: 0,
    open_balance_due: 3000,
    overdue_balance_due: 0,
    max_days_past_due: 0,
    oldest_due_date: null,
    last_invoice_at: "2026-04-21T00:00:00.000Z",
    block_status: null,
    block_reason: null,
    current_max_aging_days: null,
    override_until: null,
    blocked_at: null,
    exposure_band: "healthy",
  },
];

const laborRows: ServiceLaborViewRow[] = [
  {
    labor_date: "2026-04-20",
    branch_id: "01",
    shop_or_field: "field",
    technician_id: "tech-1",
    technician_name: "Colton Noerring",
    job_count: 2,
    hours_worked: 12.5,
    billed_value: 5000,
    quoted_value: 6200,
    closed_job_count: 1,
  },
  {
    labor_date: "2026-04-18",
    branch_id: "01",
    shop_or_field: "shop",
    technician_id: "tech-2",
    technician_name: "Donald McAllister",
    job_count: 3,
    hours_worked: 18.25,
    billed_value: 7200,
    quoted_value: 7500,
    closed_job_count: 2,
  },
  {
    labor_date: "2026-01-01",
    branch_id: "02",
    shop_or_field: "field",
    technician_id: "tech-3",
    technician_name: "Archived Tech",
    job_count: 1,
    hours_worked: 8,
    billed_value: 1200,
    quoted_value: 1500,
    closed_job_count: 1,
  },
];

describe("data-miner-utils", () => {
  test("buildProfitabilityRows aggregates by customer within the selected window", () => {
    const built = buildProfitabilityRows(profitabilityRows, {
      timeframe: "trailing_365d",
      sortBy: "margin_dollars",
      now: new Date("2026-04-22T00:00:00.000Z"),
    });
    expect(built[0]?.customerName).toBe("Cooper Timber");
    expect(built[0]?.wonDealCount).toBe(3);
    expect(built[0]?.grossMarginAmount).toBe(29000);
    expect(built[0]?.grossMarginPct).toBe(23.2);
  });

  test("buildCreditExposureRows prioritizes severe accounts and filters on block status", () => {
    const built = buildCreditExposureRows(creditRows, {
      blockFilter: "blocked_only",
      minDaysPastDue: 60,
    });
    expect(built.map((row) => row.customer_name)).toEqual(["Cooper Timber", "PMC Services"]);
  });

  test("buildServiceLaborRows groups rows by work mode over the configured window", () => {
    const built = buildServiceLaborRows(laborRows, {
      groupBy: "work_mode",
      windowDays: 120,
      now: new Date("2026-04-22T00:00:00.000Z"),
    });
    expect(built[0]?.label).toBe("Field");
    expect(built[0]?.hoursWorked).toBe(20.5);
    expect(built[1]?.label).toBe("Shop");
    expect(built[1]?.hoursWorked).toBe(18.25);
  });
});
