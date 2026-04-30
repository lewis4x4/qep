import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  BarChart3,
  CircleDollarSign,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import {
  buildCreditExposureRows,
  buildProfitabilityRows,
  buildServiceLaborRows,
  type CreditExposureViewRow,
  type CreditBlockFilter,
  type ProfitabilitySort,
  type ProfitabilityTimeframe,
  type ProfitabilityViewRow,
  type ServiceGrouping,
  type ServiceLaborViewRow,
} from "../lib/data-miner-utils";

type DataMinerTab = "profitability" | "credit" | "service";

type OwnerProfitabilityRow = Database["public"]["Views"]["owner_data_miner_profitability"]["Row"];
type OwnerCreditExposureRow = Database["public"]["Views"]["owner_data_miner_credit_exposure"]["Row"];
type OwnerServiceLaborRow = Database["public"]["Views"]["owner_data_miner_service_labor"]["Row"];
type OwnerProfitabilityPayload = Pick<
  OwnerProfitabilityRow,
  | "company_id"
  | "customer_name"
  | "closed_month"
  | "won_deal_count"
  | "sales_amount"
  | "gross_margin_amount"
  | "gross_margin_pct"
  | "last_closed_at"
>;
type OwnerCreditExposurePayload = Pick<
  OwnerCreditExposureRow,
  | "company_id"
  | "customer_name"
  | "open_invoice_count"
  | "overdue_invoice_count"
  | "open_balance_due"
  | "overdue_balance_due"
  | "max_days_past_due"
  | "oldest_due_date"
  | "last_invoice_at"
  | "block_status"
  | "block_reason"
  | "current_max_aging_days"
  | "override_until"
  | "blocked_at"
  | "exposure_band"
>;
type OwnerServiceLaborPayload = Pick<
  OwnerServiceLaborRow,
  | "labor_date"
  | "branch_id"
  | "shop_or_field"
  | "technician_id"
  | "technician_name"
  | "job_count"
  | "hours_worked"
  | "billed_value"
  | "quoted_value"
  | "closed_job_count"
>;

type DataMinerPayload = {
  profitability: ProfitabilityViewRow[];
  credit: CreditExposureViewRow[];
  service: ServiceLaborViewRow[];
};

async function fetchDataMinerPayload(): Promise<DataMinerPayload> {
  const [profitabilityRes, creditRes, serviceRes] = await Promise.all([
    supabase
      .from("owner_data_miner_profitability")
      .select(
        "company_id, customer_name, closed_month, won_deal_count, sales_amount, gross_margin_amount, gross_margin_pct, last_closed_at",
      )
      .order("sales_amount", { ascending: false }),
    supabase
      .from("owner_data_miner_credit_exposure")
      .select(
        "company_id, customer_name, open_invoice_count, overdue_invoice_count, open_balance_due, overdue_balance_due, max_days_past_due, oldest_due_date, last_invoice_at, block_status, block_reason, current_max_aging_days, override_until, blocked_at, exposure_band",
      )
      .order("overdue_balance_due", { ascending: false }),
    supabase
      .from("owner_data_miner_service_labor")
      .select(
        "labor_date, branch_id, shop_or_field, technician_id, technician_name, job_count, hours_worked, billed_value, quoted_value, closed_job_count",
      )
      .order("labor_date", { ascending: false }),
  ]);

  if (profitabilityRes.error) {
    throw new Error(profitabilityRes.error.message ?? "Failed to load profitability equivalents.");
  }
  if (creditRes.error) {
    throw new Error(creditRes.error.message ?? "Failed to load credit exposure equivalents.");
  }
  if (serviceRes.error) {
    throw new Error(serviceRes.error.message ?? "Failed to load service labor equivalents.");
  }

  return {
    profitability: (profitabilityRes.data ?? []).map(mapProfitabilityRow),
    credit: (creditRes.data ?? []).map(mapCreditExposureRow),
    service: (serviceRes.data ?? []).map(mapServiceLaborRow),
  };
}

function numeric(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function label(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function normalizeCreditBlockStatus(
  value: OwnerCreditExposurePayload["block_status"],
): CreditExposureViewRow["block_status"] {
  return value === "active" || value === "overridden" || value === "cleared" ? value : null;
}

function normalizeExposureBand(
  value: OwnerCreditExposurePayload["exposure_band"],
  maxDaysPastDue: number,
): CreditExposureViewRow["exposure_band"] {
  if (value === "critical" || value === "warning" || value === "healthy") return value;
  if (maxDaysPastDue >= 90) return "critical";
  if (maxDaysPastDue >= 30) return "warning";
  return "healthy";
}

function mapProfitabilityRow(row: OwnerProfitabilityPayload): ProfitabilityViewRow {
  return {
    company_id: row.company_id,
    customer_name: label(row.customer_name, "Unknown customer"),
    closed_month: label(row.closed_month ?? row.last_closed_at, "1970-01-01"),
    won_deal_count: numeric(row.won_deal_count),
    sales_amount: numeric(row.sales_amount),
    gross_margin_amount: numeric(row.gross_margin_amount),
    gross_margin_pct: row.gross_margin_pct,
    last_closed_at: row.last_closed_at,
  };
}

function mapCreditExposureRow(row: OwnerCreditExposurePayload): CreditExposureViewRow {
  const maxDaysPastDue = numeric(row.max_days_past_due);
  return {
    company_id: row.company_id,
    customer_name: label(row.customer_name, "Unknown customer"),
    open_invoice_count: numeric(row.open_invoice_count),
    overdue_invoice_count: numeric(row.overdue_invoice_count),
    open_balance_due: numeric(row.open_balance_due),
    overdue_balance_due: numeric(row.overdue_balance_due),
    max_days_past_due: maxDaysPastDue,
    oldest_due_date: row.oldest_due_date,
    last_invoice_at: row.last_invoice_at,
    block_status: normalizeCreditBlockStatus(row.block_status),
    block_reason: row.block_reason,
    current_max_aging_days: row.current_max_aging_days,
    override_until: row.override_until,
    blocked_at: row.blocked_at,
    exposure_band: normalizeExposureBand(row.exposure_band, maxDaysPastDue),
  };
}

function mapServiceLaborRow(row: OwnerServiceLaborPayload): ServiceLaborViewRow {
  return {
    labor_date: label(row.labor_date, "1970-01-01"),
    branch_id: row.branch_id,
    shop_or_field: label(row.shop_or_field, "unknown"),
    technician_id: row.technician_id,
    technician_name: label(row.technician_name, "Unassigned technician"),
    job_count: numeric(row.job_count),
    hours_worked: numeric(row.hours_worked),
    billed_value: numeric(row.billed_value),
    quoted_value: numeric(row.quoted_value),
    closed_job_count: numeric(row.closed_job_count),
  };
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition ${
        active
          ? "border-qep-orange/50 bg-qep-orange/15 text-qep-orange"
          : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20"
      }`}
    >
      {label}
    </button>
  );
}

export function DataMinerEquivalentsPage() {
  const [tab, setTab] = useState<DataMinerTab>("profitability");

  const [profitSearch, setProfitSearch] = useState("");
  const [profitTimeframe, setProfitTimeframe] = useState<ProfitabilityTimeframe>("current_ytd");
  const [profitSort, setProfitSort] = useState<ProfitabilitySort>("margin_dollars");
  const [profitLimit, setProfitLimit] = useState(10);

  const [creditSearch, setCreditSearch] = useState("");
  const [creditMinDays, setCreditMinDays] = useState(60);
  const [creditBlockFilter, setCreditBlockFilter] = useState<CreditBlockFilter>("all");
  const [creditLimit, setCreditLimit] = useState(10);

  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceWindowDays, setServiceWindowDays] = useState(90);
  const [serviceGroupBy, setServiceGroupBy] = useState<ServiceGrouping>("technician");
  const [serviceBranchId, setServiceBranchId] = useState("all");
  const [serviceLimit, setServiceLimit] = useState(10);

  const reportQuery = useQuery({
    queryKey: ["owner", "data-miner-equivalents"],
    queryFn: fetchDataMinerPayload,
    refetchInterval: 120_000,
  });

  const profitabilityRows = buildProfitabilityRows(reportQuery.data?.profitability ?? [], {
    search: profitSearch,
    timeframe: profitTimeframe,
    sortBy: profitSort,
    limit: profitLimit,
  });
  const creditRows = buildCreditExposureRows(reportQuery.data?.credit ?? [], {
    search: creditSearch,
    minDaysPastDue: creditMinDays,
    blockFilter: creditBlockFilter,
    limit: creditLimit,
  });
  const serviceRows = buildServiceLaborRows(reportQuery.data?.service ?? [], {
    search: serviceSearch,
    windowDays: serviceWindowDays,
    groupBy: serviceGroupBy,
    branchId: serviceBranchId === "all" ? undefined : serviceBranchId,
    limit: serviceLimit,
  });

  const criticalAccounts = (reportQuery.data?.credit ?? []).filter((row) => row.exposure_band === "critical").length;
  const serviceHours90d = buildServiceLaborRows(reportQuery.data?.service ?? [], {
    groupBy: "technician",
    windowDays: 90,
    limit: 500,
  }).reduce((sum, row) => sum + row.hoursWorked, 0);
  const marginTracked = buildProfitabilityRows(reportQuery.data?.profitability ?? [], {
    timeframe: "trailing_365d",
    limit: 500,
  }).reduce((sum, row) => sum + row.grossMarginAmount, 0);
  const serviceBranches = Array.from(
    new Set(
      (reportQuery.data?.service ?? [])
        .map((row) => row.branch_id)
        .filter((branchId): branchId is string => typeof branchId === "string" && branchId.length > 0),
    ),
  ).sort();

  return (
    <div className="min-h-screen bg-[radial-gradient(1100px_540px_at_50%_-10%,rgba(56,189,248,0.14),transparent_48%),linear-gradient(180deg,#05060a_0%,#090d17_100%)] text-slate-100">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300/90">
              Phase 9 · Data Miner Equivalents
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Curated management intelligence, without the legacy query builder
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              IntelliDealer&apos;s Data Miner drives management decisions through curated report families. QEP&apos;s equivalent
              is not a raw query screen. It is a live, role-safe report center over closed-won profitability, A/R exposure,
              and service labor throughput using current workspace data.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
              <BarChart3 className="h-4 w-4" />
              Live equivalents only
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          <MetricCard
            label="Gross Margin Tracked"
            value={formatCurrency(marginTracked)}
            detail="Trailing 365-day gross margin rollup over closed-won customer deals."
          />
          <MetricCard
            label="Critical AR Accounts"
            value={formatCompactNumber(criticalAccounts)}
            detail="Accounts with active AR blocks, 90+ day aging, or heavy overdue exposure."
          />
          <MetricCard
            label="Service Hours (90d)"
            value={formatCompactNumber(serviceHours90d)}
            detail="Clocked labor captured through service timecards and linked work orders."
          />
        </section>

        <section className="mt-6">
          <Card className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_24px_60px_rgba(2,6,23,0.24)]">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Equivalent report packs</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Built from QEP-native signals that replace the legacy management reporting flows shown in IntelliDealer evidence.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <TabButton active={tab === "profitability"} label="Profitability" onClick={() => setTab("profitability")} />
                <TabButton active={tab === "credit"} label="AR Exposure" onClick={() => setTab("credit")} />
                <TabButton active={tab === "service"} label="Service Labor" onClick={() => setTab("service")} />
              </div>
            </div>

            {reportQuery.isLoading ? (
              <div className="flex justify-center py-16">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
              </div>
            ) : reportQuery.isError ? (
              <div className="py-12 text-center">
                <p className="text-lg font-medium text-rose-300">Failed to load Data Miner equivalents.</p>
                <p className="mt-2 text-sm text-slate-400">{(reportQuery.error as Error).message}</p>
              </div>
            ) : (
              <div className="mt-5">
                {tab === "profitability" ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 lg:grid-cols-[1.3fr_repeat(3,minmax(0,1fr))]">
                      <input
                        value={profitSearch}
                        onChange={(event) => setProfitSearch(event.target.value)}
                        placeholder="Search customer"
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      />
                      <select
                        value={profitTimeframe}
                        onChange={(event) => setProfitTimeframe(event.target.value as ProfitabilityTimeframe)}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="current_ytd">Current YTD</option>
                        <option value="trailing_90d">Trailing 90 days</option>
                        <option value="trailing_365d">Trailing 365 days</option>
                        <option value="all_time">All time</option>
                      </select>
                      <select
                        value={profitSort}
                        onChange={(event) => setProfitSort(event.target.value as ProfitabilitySort)}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="margin_dollars">Sort by gross margin $</option>
                        <option value="margin_pct">Sort by margin %</option>
                        <option value="sales">Sort by sales</option>
                      </select>
                      <select
                        value={String(profitLimit)}
                        onChange={(event) => setProfitLimit(Number(event.target.value))}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="10">10 rows</option>
                        <option value="25">25 rows</option>
                        <option value="50">50 rows</option>
                      </select>
                    </div>
                    <div className="overflow-x-auto rounded-2xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-white/[0.04] text-slate-300">
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold">Customer</th>
                            <th className="px-4 py-3 text-right font-semibold">Won deals</th>
                            <th className="px-4 py-3 text-right font-semibold">Sales</th>
                            <th className="px-4 py-3 text-right font-semibold">Gross margin $</th>
                            <th className="px-4 py-3 text-right font-semibold">Margin %</th>
                            <th className="px-4 py-3 text-right font-semibold">Last won</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profitabilityRows.map((row) => (
                            <tr key={row.customerName} className="border-t border-white/5 text-slate-100">
                              <td className="px-4 py-3 font-medium">{row.customerName}</td>
                              <td className="px-4 py-3 text-right">{formatCompactNumber(row.wonDealCount)}</td>
                              <td className="px-4 py-3 text-right">{formatCurrency(row.salesAmount)}</td>
                              <td className="px-4 py-3 text-right text-emerald-300">{formatCurrency(row.grossMarginAmount)}</td>
                              <td className="px-4 py-3 text-right">{formatPercent(row.grossMarginPct)}</td>
                              <td className="px-4 py-3 text-right text-slate-400">{formatDate(row.lastClosedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {profitabilityRows.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-400">No profitability rows matched this window.</div>
                      ) : null}
                    </div>
                    <SourceNote
                      icon={CircleDollarSign}
                      text="Equivalent to IntelliDealer's customer profitability analysis, but built from QRM closed-won deal economics instead of a legacy CRM report screen."
                    />
                  </div>
                ) : null}

                {tab === "credit" ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 lg:grid-cols-[1.3fr_repeat(3,minmax(0,1fr))]">
                      <input
                        value={creditSearch}
                        onChange={(event) => setCreditSearch(event.target.value)}
                        placeholder="Search customer"
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      />
                      <select
                        value={String(creditMinDays)}
                        onChange={(event) => setCreditMinDays(Number(event.target.value))}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="0">All aging</option>
                        <option value="30">30+ days past due</option>
                        <option value="60">60+ days past due</option>
                        <option value="90">90+ days past due</option>
                      </select>
                      <select
                        value={creditBlockFilter}
                        onChange={(event) => setCreditBlockFilter(event.target.value as CreditBlockFilter)}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="all">All accounts</option>
                        <option value="blocked_only">Any blocked / overridden</option>
                        <option value="active">Active AR blocks</option>
                        <option value="overridden">Overrides only</option>
                      </select>
                      <select
                        value={String(creditLimit)}
                        onChange={(event) => setCreditLimit(Number(event.target.value))}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="10">10 rows</option>
                        <option value="25">25 rows</option>
                        <option value="50">50 rows</option>
                      </select>
                    </div>
                    <div className="overflow-x-auto rounded-2xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-white/[0.04] text-slate-300">
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold">Customer</th>
                            <th className="px-4 py-3 text-right font-semibold">Open AR</th>
                            <th className="px-4 py-3 text-right font-semibold">Overdue</th>
                            <th className="px-4 py-3 text-right font-semibold">Max days</th>
                            <th className="px-4 py-3 text-right font-semibold">Invoices</th>
                            <th className="px-4 py-3 text-left font-semibold">Block status</th>
                            <th className="px-4 py-3 text-left font-semibold">Band</th>
                          </tr>
                        </thead>
                        <tbody>
                          {creditRows.map((row) => (
                            <tr key={row.customer_name} className="border-t border-white/5 text-slate-100">
                              <td className="px-4 py-3 font-medium">{row.customer_name}</td>
                              <td className="px-4 py-3 text-right">{formatCurrency(row.open_balance_due)}</td>
                              <td className="px-4 py-3 text-right text-amber-300">{formatCurrency(row.overdue_balance_due)}</td>
                              <td className="px-4 py-3 text-right">{formatCompactNumber(row.max_days_past_due)}</td>
                              <td className="px-4 py-3 text-right">{formatCompactNumber(row.open_invoice_count)}</td>
                              <td className="px-4 py-3">{row.block_status ?? "clear"}</td>
                              <td className="px-4 py-3">
                                <span
                                  className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                                    row.exposure_band === "critical"
                                      ? "bg-rose-500/15 text-rose-300"
                                      : row.exposure_band === "warning"
                                      ? "bg-amber-500/15 text-amber-300"
                                      : "bg-emerald-500/15 text-emerald-300"
                                  }`}
                                >
                                  {row.exposure_band}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {creditRows.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-400">No credit exposure rows matched this filter.</div>
                      ) : null}
                    </div>
                    <SourceNote
                      icon={ShieldAlert}
                      text="Equivalent to IntelliDealer's credit-limit analysis, but built from open invoices and AR block workflow because QEP's finance truth sits in receivables exposure rather than a legacy credit-limit table."
                    />
                  </div>
                ) : null}

                {tab === "service" ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 lg:grid-cols-[1.1fr_repeat(4,minmax(0,1fr))]">
                      <input
                        value={serviceSearch}
                        onChange={(event) => setServiceSearch(event.target.value)}
                        placeholder={serviceGroupBy === "technician" ? "Search technician" : "Search current grouping"}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      />
                      <select
                        value={String(serviceWindowDays)}
                        onChange={(event) => setServiceWindowDays(Number(event.target.value))}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="30">Last 30 days</option>
                        <option value="90">Last 90 days</option>
                        <option value="365">Last 365 days</option>
                      </select>
                      <select
                        value={serviceGroupBy}
                        onChange={(event) => setServiceGroupBy(event.target.value as ServiceGrouping)}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="technician">Group by technician</option>
                        <option value="branch">Group by branch</option>
                        <option value="work_mode">Group by work mode</option>
                      </select>
                      <select
                        value={serviceBranchId}
                        onChange={(event) => setServiceBranchId(event.target.value)}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="all">All branches</option>
                        {serviceBranches.map((branchId) => (
                          <option key={branchId} value={branchId}>
                            Branch {branchId}
                          </option>
                        ))}
                      </select>
                      <select
                        value={String(serviceLimit)}
                        onChange={(event) => setServiceLimit(Number(event.target.value))}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                      >
                        <option value="10">10 rows</option>
                        <option value="25">25 rows</option>
                        <option value="50">50 rows</option>
                      </select>
                    </div>
                    <div className="overflow-x-auto rounded-2xl border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-white/[0.04] text-slate-300">
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold">
                              {serviceGroupBy === "technician" ? "Technician" : serviceGroupBy === "branch" ? "Branch" : "Work mode"}
                            </th>
                            <th className="px-4 py-3 text-right font-semibold">Jobs</th>
                            <th className="px-4 py-3 text-right font-semibold">Hours</th>
                            <th className="px-4 py-3 text-right font-semibold">Quoted</th>
                            <th className="px-4 py-3 text-right font-semibold">Billed</th>
                            <th className="px-4 py-3 text-right font-semibold">Closed jobs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {serviceRows.map((row) => (
                            <tr key={`${serviceGroupBy}-${row.label}`} className="border-t border-white/5 text-slate-100">
                              <td className="px-4 py-3 font-medium">{row.label}</td>
                              <td className="px-4 py-3 text-right">{formatCompactNumber(row.jobCount)}</td>
                              <td className="px-4 py-3 text-right">{row.hoursWorked.toFixed(2)}</td>
                              <td className="px-4 py-3 text-right">{formatCurrency(row.quotedValue)}</td>
                              <td className="px-4 py-3 text-right text-cyan-300">{formatCurrency(row.billedValue)}</td>
                              <td className="px-4 py-3 text-right">{formatCompactNumber(row.closedJobCount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {serviceRows.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-400">No service labor rows matched this filter.</div>
                      ) : null}
                    </div>
                    <SourceNote
                      icon={Wrench}
                      text="Equivalent to IntelliDealer's service-side analysis reports, but grounded in service timecards and linked jobs rather than a fixed premium-code report family."
                    />
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

function SourceNote({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.06] p-4">
      <span className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-2 text-cyan-200">
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-sm leading-6 text-slate-200">{text}</p>
    </div>
  );
}
