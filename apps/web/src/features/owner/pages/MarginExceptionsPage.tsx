import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleDollarSign, ShieldAlert, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  fetchOwnerMarginExceptions,
  type OwnerMarginApprovalStatus,
  type OwnerMarginExceptionRow,
} from "@/features/owner/lib/owner-api";

type StatusFilter = "all" | OwnerMarginApprovalStatus | "no_approval";

const STATUS_LABELS: Record<OwnerMarginApprovalStatus | "no_approval", string> = {
  pending: "Pending",
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  escalated: "Escalated",
  cancelled: "Cancelled",
  superseded: "Superseded",
  expired: "Expired",
  no_approval: "No approval case",
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "escalated", label: "Escalated" },
  { value: "approved", label: "Approved" },
  { value: "approved_with_conditions", label: "Approved with conditions" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "rejected", label: "Rejected" },
  { value: "no_approval", label: "No approval case" },
];

function trailingDate(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatGapCents(value: number | null | undefined): string {
  return value == null ? "—" : formatCurrency(value / 100);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDelta(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function label(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function statusLabel(row: OwnerMarginExceptionRow): string {
  return row.approval_status ? STATUS_LABELS[row.approval_status] : STATUS_LABELS.no_approval;
}

function matchesSearch(row: OwnerMarginExceptionRow, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    row.rep_name,
    row.customer_name,
    row.customer_company,
    row.quote_number,
    row.reason,
    row.brand_name,
    row.brand_code,
    row.branch_name,
  ].some((value) => value?.toLowerCase().includes(query));
}

function MetricCard({
  label: cardLabel,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        <Icon className="h-4 w-4 text-qep-orange" />
        {cardLabel}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

export function MarginExceptionsPage() {
  const [search, setSearch] = useState("");
  const [repId, setRepId] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [startDate, setStartDate] = useState(() => trailingDate(90));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [limit, setLimit] = useState(100);

  const apiFilters = useMemo(() => ({
    startDate: startDate ? `${startDate}T00:00:00.000Z` : null,
    endDate: endDate ? `${endDate}T23:59:59.999Z` : null,
    repId: repId === "all" ? null : repId,
    approvalStatus: status === "all" ? null : status,
    limit,
  }), [endDate, limit, repId, startDate, status]);

  const reportQuery = useQuery({
    queryKey: ["owner", "margin-exceptions", apiFilters],
    queryFn: () => fetchOwnerMarginExceptions(apiFilters),
    refetchInterval: 120_000,
  });

  const allRows = reportQuery.data ?? [];
  const filteredRows = useMemo(
    () => allRows.filter((row) => matchesSearch(row, search)),
    [allRows, search],
  );

  const repOptions = useMemo(() => {
    const reps = new Map<string, string>();
    for (const row of allRows) {
      if (row.rep_id) reps.set(row.rep_id, label(row.rep_name, "Unknown rep"));
    }
    return Array.from(reps.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allRows]);

  const totalGap = filteredRows.reduce((sum, row) => sum + (row.estimated_gap_cents ?? 0), 0) / 100;
  const averageDelta = filteredRows.length > 0
    ? filteredRows.reduce((sum, row) => sum + row.delta_pts, 0) / filteredRows.length
    : 0;
  const pendingOrEscalated = filteredRows.filter(
    (row) => row.approval_status === "pending" || row.approval_status === "escalated",
  ).length;

  return (
    <div className="min-h-screen bg-[radial-gradient(1100px_540px_at_50%_-10%,rgba(249,115,22,0.16),transparent_48%),linear-gradient(180deg,#05060a_0%,#0a0d14_100%)] text-slate-100">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-qep-orange/90">
              QB-11 · Margin Exceptions
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Owner margin exception report
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Read-only owner view that combines quote-builder margin exceptions with the latest approval-loop context so margin leakage stays visible without changing rep draft behavior.
            </p>
          </div>
          <div className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
            <ShieldAlert className="h-4 w-4" />
            Owner-only workspace report
          </div>
        </header>

        <section className="mt-6 grid gap-4 lg:grid-cols-4">
          <MetricCard
            icon={ShieldAlert}
            label="Exceptions"
            value={filteredRows.length.toLocaleString("en-US")}
            detail="Margin floor exceptions in the current report window."
          />
          <MetricCard
            icon={CircleDollarSign}
            label="Estimated gap"
            value={formatCurrency(totalGap)}
            detail="Approximate margin dollars required to hit configured floors."
          />
          <MetricCard
            icon={AlertTriangle}
            label="Average delta"
            value={formatDelta(averageDelta)}
            detail="Average quoted margin versus configured threshold."
          />
          <MetricCard
            icon={UserRound}
            label="Pending / escalated"
            value={pendingOrEscalated.toLocaleString("en-US")}
            detail="Approval cases still requiring management attention."
          />
        </section>

        <section className="mt-6">
          <Card className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_24px_60px_rgba(2,6,23,0.24)]">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-5">
              <div>
                <h2 className="text-lg font-semibold text-white">Margin exception ledger</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Rows remain visible even when no approval case exists; the database view also enforces owner + workspace gating.
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-[1.25fr_repeat(5,minmax(0,1fr))]">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search rep, customer, quote, reason"
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
                <select
                  value={repId}
                  onChange={(event) => setRepId(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                >
                  <option value="all">All reps</option>
                  {repOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as StatusFilter)}
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  aria-label="Start date"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                  aria-label="End date"
                />
                <select
                  value={String(limit)}
                  onChange={(event) => setLimit(Number(event.target.value))}
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                >
                  <option value="50">50 rows</option>
                  <option value="100">100 rows</option>
                  <option value="250">250 rows</option>
                  <option value="500">500 rows</option>
                </select>
              </div>
            </div>

            {reportQuery.isLoading ? (
              <div className="flex justify-center py-16" role="status" aria-label="Loading margin exceptions">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-qep-orange border-t-transparent" />
              </div>
            ) : reportQuery.isError ? (
              <div className="py-12 text-center">
                <p className="text-lg font-medium text-rose-300">Failed to load margin exceptions.</p>
                <p className="mt-2 text-sm text-slate-400">{(reportQuery.error as Error).message}</p>
              </div>
            ) : (
              <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-white/[0.04] text-slate-300">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Rep</th>
                      <th className="px-4 py-3 text-left font-semibold">Customer</th>
                      <th className="px-4 py-3 text-left font-semibold">Quote</th>
                      <th className="px-4 py-3 text-left font-semibold">Margin</th>
                      <th className="px-4 py-3 text-right font-semibold">Estimated gap</th>
                      <th className="px-4 py-3 text-left font-semibold">Reason</th>
                      <th className="px-4 py-3 text-left font-semibold">Approval status</th>
                      <th className="px-4 py-3 text-left font-semibold">Approver / assignee</th>
                      <th className="px-4 py-3 text-left font-semibold">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const decisionOwner = row.decided_by_name ?? row.assigned_to_name ?? row.assigned_role ?? "—";
                      const decision = row.decided_at || row.decision_note
                        ? `${formatDate(row.decided_at)}${row.decision_note ? ` · ${row.decision_note}` : ""}`
                        : "—";
                      return (
                        <tr key={row.exception_id} className="border-t border-white/5 text-slate-100">
                          <td className="px-4 py-3 whitespace-nowrap text-slate-300">{formatDate(row.exception_created_at)}</td>
                          <td className="px-4 py-3 font-medium">{label(row.rep_name, "Unknown rep")}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{label(row.customer_company ?? row.customer_name, "Unknown customer")}</div>
                            <div className="text-xs text-slate-500">{row.branch_name ?? row.brand_name ?? "—"}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-cyan-200">{row.quote_number ?? "—"}</td>
                          <td className="px-4 py-3">
                            <div>{formatPercent(row.quoted_margin_pct)} vs floor {formatPercent(row.threshold_margin_pct)}</div>
                            <div className="text-xs text-rose-300">{formatDelta(row.delta_pts)}</div>
                          </td>
                          <td className="px-4 py-3 text-right text-amber-200">{formatGapCents(row.estimated_gap_cents)}</td>
                          <td className="max-w-[18rem] px-4 py-3 text-slate-300">{row.reason}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                              row.approval_status === "pending" || row.approval_status === "escalated"
                                ? "bg-amber-500/15 text-amber-300"
                                : row.approval_status === "rejected" || row.approval_status === "changes_requested"
                                ? "bg-rose-500/15 text-rose-300"
                                : row.approval_status
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-slate-500/15 text-slate-300"
                            }`}>{statusLabel(row)}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-300">{decisionOwner}</td>
                          <td className="max-w-[20rem] px-4 py-3 text-slate-400">{decision}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRows.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">
                    No margin exceptions matched these filters.
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
