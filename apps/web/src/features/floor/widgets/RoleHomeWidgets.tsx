import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Check,
  ClipboardList,
  Clock,
  FileText,
  Gauge,
  PackageSearch,
  ShieldAlert,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { transitionServiceJob } from "@/features/service/lib/api";
import type { ServiceStage } from "@/features/service/lib/constants";
import { STAGE_LABELS } from "@/features/service/lib/constants";
import {
  EmptyState,
  ErrorLine,
  FloorWidgetShell,
  LoadingLine,
} from "./DirectWrapWidgets";
import {
  getPrepHomeTransitionPlan,
  isUnquotedCounterInquiry,
  orderCounterInquiriesForHome,
} from "./role-home-utils";
import {
  normalizeApprovalDecisionRows,
  normalizeCounterInquiryRows,
  normalizeJoinedDealRows,
  normalizeMarginRows,
  normalizeQuoteRows,
  normalizeServiceJobRows,
  normalizeSlaApprovalRows,
  type DealRow,
  type QuoteRow,
  type ServiceJobRow,
} from "./role-home-widget-normalizers";

type BlockerType =
  | "parts_shortage"
  | "waiting_customer"
  | "waiting_vendor"
  | "waiting_transfer"
  | "waiting_haul"
  | "other";

const BLOCKER_OPTIONS: Array<{ value: BlockerType; label: string }> = [
  { value: "parts_shortage", label: "Parts shortage" },
  { value: "waiting_customer", label: "Waiting customer" },
  { value: "waiting_vendor", label: "Waiting vendor" },
  { value: "waiting_transfer", label: "Waiting transfer" },
  { value: "waiting_haul", label: "Waiting haul" },
  { value: "other", label: "Other" },
];

const QUOTE_SELECT = `
  id, deal_id, quote_number, customer_company, customer_name, equipment,
  net_total, status, sent_at, viewed_at, updated_at, created_by,
  deal:qrm_deals ( id, name, assigned_rep_id )
`;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function currency(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function percent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const n = Number(value);
  return `${Math.round((Math.abs(n) <= 1 ? n * 100 : n) * 10) / 10}%`;
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function dateShort(iso: string | null | undefined): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function equipmentSummary(equipment: unknown): string {
  if (!Array.isArray(equipment) || equipment.length === 0) return "No equipment lines";
  const first = equipment[0] as { make?: string; model?: string; name?: string };
  const label = first.name || [first.make, first.model].filter(Boolean).join(" ") || "Equipment";
  return equipment.length > 1 ? `${label} +${equipment.length - 1}` : label;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function MiniMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/60 px-3 py-2">
      <p className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-kpi text-2xl font-extrabold leading-none text-foreground">
        {value}
      </p>
      {detail ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function CompactRow({
  title,
  detail,
  value,
  to,
}: {
  title: string;
  detail?: string;
  value?: string;
  to?: string;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-foreground">{title}</p>
        {detail ? <p className="truncate text-[11px] text-muted-foreground">{detail}</p> : null}
      </div>
      {value ? (
        <span className="shrink-0 font-kpi text-xs font-extrabold uppercase tracking-[0.08em] text-[hsl(var(--qep-orange))]">
          {value}
        </span>
      ) : null}
    </>
  );

  const className =
    "flex min-w-0 items-center justify-between gap-3 border-b border-[hsl(var(--qep-deck-rule))]/60 py-2 last:border-0";

  return to ? (
    <Link to={to} className={`${className} hover:text-[hsl(var(--qep-orange))]`}>
      {body}
    </Link>
  ) : (
    <li className={className}>{body}</li>
  );
}

const QUOTE_STATUS_ORDER = [
  "viewed",
  "sent",
  "approved",
  "approved_with_conditions",
  "ready",
  "pending_approval",
  "changes_requested",
  "draft",
  "rejected",
  "expired",
] as const;

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  changes_requested: "Changes requested",
  ready: "Ready to send",
  approved: "Approved",
  approved_with_conditions: "Approved (conditions)",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  rejected: "Declined",
  expired: "Expired",
};

const QUOTE_STATUS_TONE: Record<string, string> = {
  viewed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  sent: "border-[hsl(var(--qep-orange))]/45 bg-[hsl(var(--qep-orange))]/10 text-[hsl(var(--qep-orange))]",
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  approved_with_conditions: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  ready: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  pending_approval: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  changes_requested: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  draft: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  rejected: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  expired: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

const QUOTE_STATUS_DEFAULT_TONE =
  "border-slate-500/30 bg-slate-500/10 text-slate-300";

function sortQuoteGroup(status: string, rows: QuoteRow[]): QuoteRow[] {
  if (status === "sent" || status === "viewed") {
    return [...rows].sort((a, b) => {
      const aT = a.sent_at ? new Date(a.sent_at).getTime() : Number.POSITIVE_INFINITY;
      const bT = b.sent_at ? new Date(b.sent_at).getTime() : Number.POSITIVE_INFINITY;
      return aT - bT;
    });
  }
  return [...rows].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

export function MyQuotesByStatusWidget() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const query = useQuery({
    queryKey: ["floor", "sales", "my-quotes-by-status", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [createdResult, dealResult] = await Promise.all([
        supabase
          .from("quote_packages")
          .select(QUOTE_SELECT)
          .eq("created_by", userId)
          .not("status", "in", '("archived","converted_to_deal")')
          .order("updated_at", { ascending: false })
          .limit(40),
        supabase
          .from("qrm_deals")
          .select("id")
          .eq("assigned_rep_id", userId)
          .is("deleted_at", null)
          .limit(80),
      ]);

      if (createdResult.error) throw new Error(createdResult.error.message);
      if (dealResult.error) throw new Error(dealResult.error.message);

      const dealIds = (dealResult.data ?? []).map((deal) => deal.id).filter(Boolean);
      const assignedResult =
        dealIds.length > 0
          ? await supabase
              .from("quote_packages")
              .select(QUOTE_SELECT)
              .in("deal_id", dealIds)
              .not("status", "in", '("archived","converted_to_deal")')
              .order("updated_at", { ascending: false })
              .limit(40)
          : { data: [], error: null };

      if (assignedResult.error) throw new Error(assignedResult.error.message);

      const byId = new Map<string, QuoteRow>();
      for (const row of [
        ...normalizeQuoteRows(createdResult.data ?? []),
        ...normalizeQuoteRows(assignedResult.data ?? []),
      ]) {
        byId.set(row.id, row);
      }
      return [...byId.values()].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];
  const activeCount = rows.length;
  const totalValue = rows.reduce((sum, row) => sum + Number(row.net_total ?? 0), 0);

  const groupedRows = useMemo(() => {
    const byStatus = new Map<string, QuoteRow[]>();
    for (const row of rows) {
      const status = String(row.status ?? "draft");
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status)!.push(row);
    }
    const ordered: Array<{ status: string; rows: QuoteRow[] }> = [];
    const seen = new Set<string>();
    for (const status of QUOTE_STATUS_ORDER) {
      const bucket = byStatus.get(status);
      if (bucket && bucket.length > 0) {
        ordered.push({ status, rows: sortQuoteGroup(status, bucket) });
        seen.add(status);
      }
    }
    for (const [status, bucket] of byStatus) {
      if (seen.has(status)) continue;
      if (bucket.length === 0) continue;
      ordered.push({ status, rows: sortQuoteGroup(status, bucket) });
    }
    return ordered;
  }, [rows]);

  const viewedCount = groupedRows.find((g) => g.status === "viewed")?.rows.length ?? 0;

  return (
    <FloorWidgetShell
      title="My quotes by status"
      icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/quote"
      linkLabel="Quotes"
      minHeight="min-h-[420px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load quotes.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        activeCount > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <MiniMetric
                label="Open quotes"
                value={String(activeCount)}
                detail="Across all statuses"
              />
              <MiniMetric
                label="Quoted value"
                value={currency(totalValue)}
                detail="Total open pipeline"
              />
              <MiniMetric
                label="Viewed by customer"
                value={String(viewedCount)}
                detail={viewedCount > 0 ? "Buying signal — follow up" : "No quote opens yet"}
              />
            </div>
            <div className="space-y-3">
              {groupedRows.map((group) => {
                const tone = QUOTE_STATUS_TONE[group.status] ?? QUOTE_STATUS_DEFAULT_TONE;
                const label = QUOTE_STATUS_LABEL[group.status] ?? statusLabel(group.status);
                const visible = group.rows.slice(0, 3);
                const overflow = Math.max(0, group.rows.length - visible.length);
                return (
                  <section
                    key={group.status}
                    className="overflow-hidden rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/30"
                  >
                    <header className="flex items-center justify-between gap-2 border-b border-[hsl(var(--qep-deck-rule))]/70 bg-[hsl(var(--qep-deck))]/70 px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${tone}`}
                        >
                          {label}
                        </span>
                        <span className="font-kpi text-[11px] font-extrabold text-foreground">
                          {group.rows.length}
                        </span>
                      </div>
                      <Link
                        to={`/quote?status=${encodeURIComponent(group.status)}`}
                        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-[hsl(var(--qep-orange))]"
                      >
                        View all →
                      </Link>
                    </header>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-xs">
                        <tbody className="divide-y divide-[hsl(var(--qep-deck-rule))]/60">
                          {visible.map((row) => {
                            const quoteHref = `/quote-v2?package_id=${encodeURIComponent(row.id)}${row.deal_id ? `&crm_deal_id=${encodeURIComponent(row.deal_id)}` : ""}`;
                            const action = quoteActionLabel(row.status);
                            return (
                              <tr key={row.id} className="bg-[hsl(var(--qep-deck))]/20">
                                <td className="px-3 py-2 font-kpi font-extrabold text-foreground">
                                  {row.quote_number ?? row.id.slice(0, 8)}
                                </td>
                                <td className="px-3 py-2">
                                  <p className="max-w-[180px] truncate font-semibold text-foreground">
                                    {row.customer_company ?? row.customer_name ?? "Unassigned"}
                                  </p>
                                  {one(row.deal)?.name ? (
                                    <p className="max-w-[180px] truncate text-[11px] text-muted-foreground">
                                      {one(row.deal)?.name}
                                    </p>
                                  ) : null}
                                </td>
                                <td className="max-w-[170px] truncate px-3 py-2 text-muted-foreground">
                                  {equipmentSummary(row.equipment)}
                                </td>
                                <td className="px-3 py-2 text-right font-kpi font-extrabold text-[hsl(var(--qep-orange))]">
                                  {currency(row.net_total)}
                                </td>
                                <td className="px-3 py-2 text-right font-kpi text-muted-foreground">
                                  {row.sent_at ? `${daysSince(row.sent_at)}d` : "--"}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <Link
                                    to={quoteHref}
                                    className="inline-flex items-center rounded-md border border-[hsl(var(--qep-orange))]/40 px-2 py-1 font-semibold text-[hsl(var(--qep-orange))] transition hover:bg-[hsl(var(--qep-orange))]/10"
                                  >
                                    {action}
                                  </Link>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {overflow > 0 ? (
                      <Link
                        to={`/quote?status=${encodeURIComponent(group.status)}`}
                        className="flex items-center justify-between bg-[hsl(var(--qep-deck))]/45 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:text-[hsl(var(--qep-orange))]"
                      >
                        <span>
                          +{overflow} more {label.toLowerCase()}
                        </span>
                        <span className="font-semibold uppercase tracking-[0.14em]">Open →</span>
                      </Link>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<BadgeCheck className="h-6 w-6" aria-hidden="true" />}
            title="No quote pressure"
            body="Drafts, sent quotes, viewed quotes, and expired quotes will group here."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

function quoteActionLabel(status: string): string {
  if (status === "draft" || status === "changes_requested") return "Continue";
  if (status === "approved" || status === "approved_with_conditions") return "Send";
  if (status === "sent" || status === "viewed") return "Follow up";
  if (status === "expired" || status === "rejected") return "Requote";
  return "Open";
}

export function CounterInquiriesWidget() {
  const query = useQuery({
    queryKey: ["floor", "parts", "counter-inquiries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("counter_inquiries")
        .select("id, inquiry_type, query_text, outcome, result_parts, match_type, machine_description, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return normalizeCounterInquiryRows(data ?? []);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];
  const unquoted = rows.filter(isUnquotedCounterInquiry);

  return (
    <FloorWidgetShell
      title="Counter inquiries"
      icon={<PackageSearch className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/parts/orders/new"
      linkLabel="Quote"
      minHeight="min-h-[240px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load counter inquiries.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        rows.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniMetric label="Awaiting quote" value={String(unquoted.length)} detail="Recent unresolved inquiries" />
              <MiniMetric label="Recent" value={String(rows.length)} detail="Last counter searches" />
            </div>
            <ul>
              {orderCounterInquiriesForHome(rows).slice(0, 5).map((row) => (
                <CompactRow
                  key={row.id}
                  title={row.query_text}
                  detail={`${statusLabel(row.outcome)} · ${row.machine_description ?? row.inquiry_type}`}
                  value="Quote now"
                  to={`/parts/orders/new?inquiry=${row.id}`}
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={<PackageSearch className="h-6 w-6" aria-hidden="true" />}
            title="No counter inquiries"
            body="AI parts lookups and counter searches will queue here when they need a quote."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function MarginTrendWidget() {
  const query = useQuery({
    queryKey: ["floor", "iron", "margin-trend"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("margin_analytics_view")
        .select("month_bucket, avg_margin_pct, flagged_deal_count, deal_count, total_pipeline, equipment_category")
        .order("month_bucket", { ascending: false })
        .limit(12);
      if (error) throw new Error(error.message);
      return normalizeMarginRows(data ?? []);
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];
  const latest = rows[0];
  const previous = rows[1];
  const delta =
    latest?.avg_margin_pct != null && previous?.avg_margin_pct != null
      ? Number(latest.avg_margin_pct) - Number(previous.avg_margin_pct)
      : null;

  return (
    <FloorWidgetShell
      title="Margin trend"
      icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/admin/deal-economics"
      linkLabel="Economics"
      minHeight="min-h-[220px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load margin trend.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        latest ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniMetric
                label="Avg margin"
                value={percent(latest.avg_margin_pct)}
                detail={delta == null ? "MTD" : `${delta >= 0 ? "+" : ""}${percent(delta)} vs prior`}
              />
              <MiniMetric
                label="Flagged"
                value={String(latest.flagged_deal_count ?? 0)}
                detail={`${latest.deal_count ?? 0} deals scanned`}
              />
            </div>
            <ul>
              {rows.slice(0, 4).map((row, index) => (
                <CompactRow
                  key={`${row.month_bucket ?? "month"}-${index}`}
                  title={row.equipment_category ?? dateShort(row.month_bucket)}
                  detail={`${row.deal_count ?? 0} deals · ${currency(row.total_pipeline)}`}
                  value={percent(row.avg_margin_pct)}
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" aria-hidden="true" />}
            title="No margin trend yet"
            body="Margin analytics will appear once deals have margin snapshots."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function AgingDealsTeamWidget() {
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    return d.toISOString();
  }, []);
  const query = useQuery({
    queryKey: ["floor", "iron", "aging-deals-team"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qrm_deals")
        .select(
          `
          id, name, amount, margin_pct, expected_close_on, updated_at,
          company:qrm_companies ( name ),
          stage:qrm_deal_stages ( name ),
          assigned_rep:profiles!crm_deals_assigned_rep_id_fkey ( full_name )
        `,
        )
        .lt("updated_at", cutoff)
        .is("deleted_at", null)
        .order("updated_at", { ascending: true })
        .limit(8);
      if (error) throw new Error(error.message);
      return normalizeJoinedDealRows(data);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];
  const value = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return (
    <FloorWidgetShell
      title="Aging deals"
      icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/qrm/deals"
      linkLabel="Deals"
      minHeight="min-h-[280px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load aging deals.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        rows.length > 0 ? (
          <div className="space-y-3">
            <p className="rounded-md border border-[hsl(var(--qep-orange))]/25 bg-[hsl(var(--qep-orange))]/5 px-2 py-1 text-[11px] text-muted-foreground">
              Workspace-wide until direct-report filtering ships.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <MiniMetric label="Stalled" value={String(rows.length)} detail="5+ days in stage" />
              <MiniMetric label="At risk" value={currency(value)} detail="Open deal value" />
            </div>
            <ul>
              {rows.slice(0, 5).map((row) => {
                const company = one(row.company);
                const stage = one(row.stage);
                const rep = one(row.assigned_rep);
                return (
                  <CompactRow
                    key={row.id}
                    title={company?.name ?? row.name}
                    detail={`${rep?.full_name ?? "Unassigned"} · ${stage?.name ?? "Stage"} · ${daysSince(row.updated_at)}d`}
                    value={currency(row.amount)}
                    to={`/qrm/deals/${row.id}`}
                  />
                );
              })}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={<BadgeCheck className="h-6 w-6" aria-hidden="true" />}
            title="No stalled deals"
            body="Deals older than five days in stage will appear here."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

function deriveRisk(
  marginPct: number | null,
  expectedCloseOn: string | null,
): "high" | "medium" | "low" {
  const now = new Date();
  const close = expectedCloseOn ? new Date(expectedCloseOn) : null;
  const daysUntilClose = close
    ? Math.ceil((close.getTime() - now.getTime()) / 86_400_000)
    : null;

  if (marginPct != null && marginPct < 10) return "high";
  if (daysUntilClose != null && daysUntilClose < 7) return "high";
  if (marginPct != null && marginPct < 15) return "medium";
  if (daysUntilClose != null && daysUntilClose < 14) return "medium";
  return "low";
}

function initials(name: string | null | undefined): string {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

function stagePillClass(stageName: string | null | undefined): string {
  const s = (stageName ?? "").toLowerCase();
  if (s.includes("closed won") || s.includes("post-sale") || s.includes("invoice closed"))
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (s.includes("negotiation") || s.includes("quote"))
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (s.includes("proposal"))
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  return "border-slate-500/30 bg-slate-500/10 text-slate-300";
}

export function OwnerLargeDealsWidget() {
  const query = useQuery({
    queryKey: ["floor", "owner", "large-deals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qrm_deals")
        .select(
          `
          id, name, amount, margin_pct, expected_close_on, updated_at,
          company:qrm_companies ( name ),
          stage:qrm_deal_stages ( name ),
          assigned_rep:profiles!crm_deals_assigned_rep_id_fkey ( full_name )
        `,
        )
        .gte("amount", 250000)
        .is("deleted_at", null)
        .order("amount", { ascending: false })
        .limit(8);
      if (error) throw new Error(error.message);
      return normalizeJoinedDealRows(data);
    },
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];
  const shown = rows.slice(0, 6);

  return (
    <FloorWidgetShell
      title="Deals > $250K"
      icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/qrm/deals?amount=gte.250000"
      linkLabel={`View all deals (${rows.length})`}
      minHeight="min-h-[260px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load large deals.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        shown.length > 0 ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[840px] text-xs">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-2 py-1.5 text-left">Deal</th>
                  <th className="px-2 py-1.5 text-left">Customer</th>
                  <th className="px-2 py-1.5 text-left">Advisor</th>
                  <th className="px-2 py-1.5 text-right">Value</th>
                  <th className="px-2 py-1.5 text-right">GM%</th>
                  <th className="px-2 py-1.5 text-left">Stage</th>
                  <th className="px-2 py-1.5 text-left">Close</th>
                  <th className="px-2 py-1.5 text-center">Risk</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const company = one(row.company);
                  const stage = one(row.stage);
                  const rep = one(row.assigned_rep);
                  const risk = deriveRisk(row.margin_pct, row.expected_close_on);
                  const riskDot =
                    risk === "high"
                      ? "bg-rose-400"
                      : risk === "medium"
                        ? "bg-amber-400"
                        : "bg-emerald-400";
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-[hsl(var(--qep-deck-rule))]/40 transition-colors hover:bg-[hsl(var(--qep-deck))]"
                    >
                      <td className="max-w-[200px] truncate px-2 py-2 font-medium text-foreground">
                        <Link
                          to={`/qrm/deals/${row.id}`}
                          className="hover:text-[hsl(var(--qep-orange))]"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="max-w-[180px] truncate px-2 py-2 text-muted-foreground">
                        {company?.name ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--qep-orange))]/15 text-[9px] font-bold text-[hsl(var(--qep-orange))]">
                            {initials(rep?.full_name)}
                          </span>
                          <span className="truncate">{rep?.full_name ?? "Unassigned"}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground">
                        {currency(row.amount)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {row.margin_pct != null ? `${row.margin_pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <span
                          className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold ${stagePillClass(
                            stage?.name,
                          )}`}
                        >
                          {stage?.name ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {dateShort(row.expected_close_on)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${riskDot}`}
                          aria-label={`Risk: ${risk}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 6 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Showing {shown.length} of {rows.length} deals ·{" "}
                <Link to="/qrm/deals?amount=gte.250000" className="text-[hsl(var(--qep-orange))]">
                  View all deals →
                </Link>
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={<BadgeCheck className="h-6 w-6" aria-hidden="true" />}
            title="No large deals exposed"
            body="Deals over $250K will appear here for owner review."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function SlaPerformanceWidget() {
  const query = useQuery({
    queryKey: ["floor", "iron-woman", "sla-performance"],
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("flow_approvals")
        .select("id, status, requested_at, decided_at, due_at")
        .gte("requested_at", since.toISOString())
        .order("requested_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return normalizeSlaApprovalRows(data ?? []);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];
  const decided = rows.filter((row) => row.decided_at);
  const avgHours =
    decided.length > 0
      ? decided.reduce(
          (sum, row) =>
            sum + (new Date(row.decided_at ?? row.requested_at).getTime() - new Date(row.requested_at).getTime()) / 3_600_000,
          0,
        ) / decided.length
      : null;
  const overSla = rows.filter((row) => {
    const due = row.due_at ? new Date(row.due_at).getTime() : new Date(row.requested_at).getTime() + 2 * 3_600_000;
    return !row.decided_at && due < Date.now();
  }).length;

  return (
    <FloorWidgetShell
      title="SLA performance"
      icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/qrm/approvals"
      linkLabel="Queue"
      minHeight="min-h-[210px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load SLA performance.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric
              label="Avg decision"
              value={avgHours == null ? "--" : `${avgHours.toFixed(1)}h`}
              detail="Today"
            />
            <MiniMetric label="Over SLA" value={String(overSla)} detail="Undecided approvals" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Target is 2h from request to decision. Queue remains sorted by time pressure.
          </p>
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

export function RecentDecisionsWidget() {
  const query = useQuery({
    queryKey: ["floor", "iron-woman", "recent-decisions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("flow_approvals")
        .select(
          `
          id, subject, status, decided_at, decision_reason, workflow_slug,
          decided_by_profile:profiles!flow_approvals_decided_by_fkey ( full_name )
        `,
        )
        .not("decided_at", "is", null)
        .order("decided_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return normalizeApprovalDecisionRows(data ?? []);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];

  return (
    <FloorWidgetShell
      title="Recent decisions"
      icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/qrm/approvals"
      linkLabel="Audit"
      minHeight="min-h-[260px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load recent decisions.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        rows.length > 0 ? (
          <ul>
            {rows.slice(0, 6).map((row) => {
              const by = one(row.decided_by_profile);
              return (
                <CompactRow
                  key={row.id}
                  title={row.subject}
                  detail={`${by?.full_name ?? "Deal desk"} · ${dateShort(row.decided_at)} · ${row.workflow_slug}`}
                  value={statusLabel(row.status)}
                />
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<Clock className="h-6 w-6" aria-hidden="true" />}
            title="No decisions today"
            body="Approved, returned, and escalated workflow decisions will appear here."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

async function forceReadyShortcut(job: ServiceJobRow, actorId: string | null): Promise<void> {
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("service_jobs")
    .update({ current_stage: "ready_for_pickup", current_stage_entered_at: now })
    .eq("id", job.id);
  if (updateError) throw new Error(updateError.message);

  const { error: eventError } = await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    event_type: "stage_transition",
    actor_id: actorId,
    old_stage: job.current_stage,
    new_stage: "ready_for_pickup",
    metadata: { source: "floor_one_click_ready" },
  });
  if (eventError) throw new Error(eventError.message);
}

export function EditablePrepQueueWidget() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [blockingJobId, setBlockingJobId] = useState<string | null>(null);
  const [blockerType, setBlockerType] = useState<BlockerType>("parts_shortage");
  const [blockerDescription, setBlockerDescription] = useState("");

  const query = useQuery({
    queryKey: ["floor", "service", "editable-prep-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_jobs")
        .select(
          `
          id, workspace_id, current_stage, status_flags, priority, customer_problem_summary,
          scheduled_start_at, scheduled_end_at, current_stage_entered_at,
          customer:crm_companies ( name ),
          machine:crm_equipment ( make, model, serial_number, year )
        `,
        )
        .in("current_stage", ["scheduled", "in_progress", "blocked_waiting", "quality_check", "ready_for_pickup"])
        .is("deleted_at", null)
        .is("closed_at", null)
        .order("scheduled_start_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(8);
      if (error) throw new Error(error.message);
      return normalizeServiceJobRows(data ?? []);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: async ({
      job,
      toStage,
      blocker,
    }: {
      job: ServiceJobRow;
      toStage: ServiceStage;
      blocker?: { blocker_type: string; blocker_description?: string };
    }) => {
      const plan = getPrepHomeTransitionPlan(job.current_stage, toStage);
      if (plan.kind === "noop") return;
      if (plan.kind === "ready_shortcut") {
        await forceReadyShortcut(job, user?.id ?? null);
        return;
      }
      await transitionServiceJob(job.id, toStage, blocker);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["floor", "service", "editable-prep-queue"] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
      setBlockingJobId(null);
      setBlockerDescription("");
      toast({ title: "Prep status updated" });
    },
    onError: (err) => {
      toast({
        title: "Couldn't update prep status",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const rows = query.data ?? [];
  const blocked = rows.filter((row) => row.current_stage === "blocked_waiting").length;

  return (
    <FloorWidgetShell
      title="Prep queue"
      icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/service/wip"
      linkLabel="WIP"
      minHeight="min-h-[320px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load prep queue.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        rows.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniMetric label="In prep" value={String(rows.length)} detail="Scheduled through ready" />
              <MiniMetric label="Blocked" value={String(blocked)} detail="Needs reason cleared" />
            </div>
            <div className="space-y-2">
              {rows.slice(0, 6).map((job) => {
                const customer = one(job.customer);
                const machine = one(job.machine);
                const machineLabel =
                  [machine?.year, machine?.make, machine?.model].filter(Boolean).join(" ") ||
                  machine?.serial_number ||
                  "Machine";
                const isBlocking = blockingJobId === job.id;
                return (
                  <div
                    key={job.id}
                    className="rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/55 p-2"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {machineLabel}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {customer?.name ?? "Customer"} · {STAGE_LABELS[job.current_stage] ?? job.current_stage}
                        </p>
                      </div>
                      <span className="shrink-0 font-kpi text-[10px] font-extrabold uppercase tracking-[0.12em] text-[hsl(var(--qep-orange))]">
                        {dateShort(job.scheduled_end_at ?? job.scheduled_start_at)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="rounded border border-[hsl(var(--qep-deck-rule))] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:border-[hsl(var(--qep-orange))] hover:text-[hsl(var(--qep-orange))]"
                        disabled={mutation.isPending || job.current_stage === "in_progress"}
                        onClick={() => mutation.mutate({ job, toStage: "in_progress" })}
                      >
                        In prep
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[hsl(var(--qep-deck-rule))] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:border-[hsl(var(--qep-orange))] hover:text-[hsl(var(--qep-orange))]"
                        disabled={mutation.isPending || job.current_stage === "blocked_waiting"}
                        onClick={() => setBlockingJobId(isBlocking ? null : job.id)}
                      >
                        Blocked
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[hsl(var(--qep-orange))]/50 bg-[hsl(var(--qep-orange))]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--qep-orange))] hover:bg-[hsl(var(--qep-orange))]/20"
                        disabled={mutation.isPending || job.current_stage === "ready_for_pickup"}
                        onClick={() => mutation.mutate({ job, toStage: "ready_for_pickup" })}
                      >
                        Ready
                      </button>
                    </div>
                    {isBlocking ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <select
                          value={blockerType}
                          onChange={(event) => setBlockerType(event.target.value as BlockerType)}
                          className="h-8 rounded border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] px-2 text-xs text-foreground"
                          aria-label="Blocked reason"
                        >
                          {BLOCKER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={blockerDescription}
                          onChange={(event) => setBlockerDescription(event.target.value)}
                          placeholder="Optional note"
                          className="h-8 rounded border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] px-2 text-xs text-foreground placeholder:text-muted-foreground"
                        />
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded bg-[hsl(var(--qep-orange))] px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-black"
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              job,
                              toStage: "blocked_waiting",
                              blocker: {
                                blocker_type: blockerType,
                                blocker_description: blockerDescription.trim() || undefined,
                              },
                            })
                          }
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          Set
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Check className="h-6 w-6" aria-hidden="true" />}
            title="Prep queue clear"
            body="Scheduled, in-prep, blocked, and ready units will appear here."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function ServiceDeliveryScheduleWidget() {
  const now = useMemo(() => new Date().toISOString(), []);
  const fiveDays = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString();
  }, []);

  const query = useQuery({
    queryKey: ["floor", "service", "delivery-schedule"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_jobs")
        .select(
          `
          id, workspace_id, current_stage, status_flags, priority, customer_problem_summary,
          scheduled_start_at, scheduled_end_at, current_stage_entered_at,
          customer:crm_companies ( name ),
          machine:crm_equipment ( make, model, serial_number, year )
        `,
        )
        .eq("current_stage", "ready_for_pickup")
        .gte("scheduled_end_at", now)
        .lte("scheduled_end_at", fiveDays)
        .is("deleted_at", null)
        .is("closed_at", null)
        .order("scheduled_end_at", { ascending: true })
        .limit(8);
      if (error) throw new Error(error.message);
      return normalizeServiceJobRows(data ?? []);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];

  return (
    <FloorWidgetShell
      title="Delivery schedule"
      icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/service"
      linkLabel="Service"
      minHeight="min-h-[240px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load delivery schedule.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        rows.length > 0 ? (
          <ul>
            {rows.slice(0, 6).map((job) => {
              const customer = one(job.customer);
              const machine = one(job.machine);
              const machineLabel =
                [machine?.year, machine?.make, machine?.model].filter(Boolean).join(" ") ||
                machine?.serial_number ||
                "Machine";
              return (
                <CompactRow
                  key={job.id}
                  title={machineLabel}
                  detail={`${customer?.name ?? "Customer"} · ready ${daysSince(job.current_stage_entered_at)}d`}
                  value={dateShort(job.scheduled_end_at)}
                  to="/service/wip"
                />
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<Check className="h-6 w-6" aria-hidden="true" />}
            title="No ready deliveries"
            body="Ready-for-pickup jobs scheduled over the next five days will appear here."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}
