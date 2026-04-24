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

type QuoteStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "approved_with_conditions"
  | "changes_requested"
  | "ready"
  | "sent"
  | "viewed"
  | "accepted"
  | "rejected"
  | "expired"
  | "converted_to_deal"
  | "archived";

type QuoteRow = {
  id: string;
  deal_id: string | null;
  quote_number: string | null;
  customer_company: string | null;
  customer_name: string | null;
  equipment: unknown;
  net_total: number | null;
  status: QuoteStatus | string;
  sent_at: string | null;
  viewed_at: string | null;
  updated_at: string;
  created_by: string | null;
  deal?: { id: string; assigned_rep_id: string | null; name: string | null } | null;
};

type CounterInquiryRow = {
  id: string;
  inquiry_type: string;
  query_text: string;
  outcome: string;
  result_parts: string[] | null;
  match_type: string | null;
  machine_description: string | null;
  created_at: string;
};

type MarginRow = {
  month_bucket: string | null;
  avg_margin_pct: number | null;
  flagged_deal_count: number | null;
  deal_count: number | null;
  total_pipeline: number | null;
  equipment_category: string | null;
};

type DealRow = {
  id: string;
  name: string;
  amount: number | null;
  margin_pct: number | null;
  stage_changed_at?: string | null;
  expected_close_on: string | null;
  updated_at: string;
  company?: { name: string | null } | { name: string | null }[] | null;
  stage?: { name: string | null } | { name: string | null }[] | null;
  assigned_rep?: { full_name: string | null } | { full_name: string | null }[] | null;
};

type ApprovalDecisionRow = {
  id: string;
  subject: string;
  status: string;
  decided_at: string | null;
  decision_reason: string | null;
  workflow_slug: string;
  decided_by_profile?: { full_name: string | null } | { full_name: string | null }[] | null;
};

type ServiceJobRow = {
  id: string;
  current_stage: ServiceStage;
  priority: string;
  status_flags: string[] | null;
  customer_problem_summary: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  current_stage_entered_at: string | null;
  workspace_id: string;
  customer?: { name: string | null } | { name: string | null }[] | null;
  machine?: {
    make: string | null;
    model: string | null;
    serial_number: string | null;
    year: number | null;
  } | {
    make: string | null;
    model: string | null;
    serial_number: string | null;
    year: number | null;
  }[] | null;
};

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
      for (const row of [...(createdResult.data ?? []), ...(assignedResult.data ?? [])] as unknown as QuoteRow[]) {
        byId.set(row.id, row);
      }
      return [...byId.values()].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const activeCount = (query.data ?? []).length;
  const totalValue = (query.data ?? []).reduce((sum, row) => sum + Number(row.net_total ?? 0), 0);
  const visibleRows = (query.data ?? []).slice(0, 8);

  return (
    <FloorWidgetShell
      title="My quotes"
      icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/quote"
      linkLabel="Quotes"
      minHeight="min-h-[360px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load quotes.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        activeCount > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MiniMetric label="Open quotes" value={String(activeCount)} detail="Draft through expired" />
              <MiniMetric label="Quoted value" value={currency(totalValue)} detail="Current visible rows" />
            </div>
            <div className="overflow-x-auto rounded-lg border border-[hsl(var(--qep-deck-rule))]">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-[hsl(var(--qep-deck))]/70 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Quote ID</th>
                    <th className="px-3 py-2 font-semibold">Customer</th>
                    <th className="px-3 py-2 font-semibold">Equipment</th>
                    <th className="px-3 py-2 text-right font-semibold">Value</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Days sent</th>
                    <th className="px-3 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--qep-deck-rule))]/70">
                  {visibleRows.map((row) => {
                    const quoteHref = `/quote-v2?package_id=${encodeURIComponent(row.id)}${row.deal_id ? `&crm_deal_id=${encodeURIComponent(row.deal_id)}` : ""}`;
                    const action = quoteActionLabel(row.status);
                    return (
                      <tr key={row.id} className="bg-[hsl(var(--qep-deck))]/35">
                        <td className="px-3 py-2 font-kpi font-extrabold text-foreground">
                          {row.quote_number ?? row.id.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2">
                          <p className="max-w-[180px] truncate font-semibold text-foreground">
                            {row.customer_company ?? row.customer_name ?? "Unassigned"}
                          </p>
                          {one(row.deal)?.name ? (
                            <p className="max-w-[180px] truncate text-[11px] text-muted-foreground">{one(row.deal)?.name}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 max-w-[170px] truncate text-muted-foreground">{equipmentSummary(row.equipment)}</td>
                        <td className="px-3 py-2 text-right font-kpi font-extrabold text-[hsl(var(--qep-orange))]">
                          {currency(row.net_total)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-full border border-[hsl(var(--qep-deck-rule))] bg-background/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {statusLabel(row.status)}
                          </span>
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
      return (data ?? []) as CounterInquiryRow[];
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
      return (data ?? []) as MarginRow[];
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
      return (data ?? []) as unknown as DealRow[];
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
      return (data ?? []) as unknown as DealRow[];
    },
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ?? [];

  return (
    <FloorWidgetShell
      title="Deals over $250K"
      icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/qrm/deals"
      linkLabel="Pipeline"
      minHeight="min-h-[260px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load large deals.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        rows.length > 0 ? (
          <ul>
            {rows.slice(0, 6).map((row) => {
              const company = one(row.company);
              const stage = one(row.stage);
              const rep = one(row.assigned_rep);
              return (
                <CompactRow
                  key={row.id}
                  title={company?.name ?? row.name}
                  detail={`${rep?.full_name ?? "Unassigned"} · ${stage?.name ?? "Stage"} · close ${dateShort(row.expected_close_on)}`}
                  value={currency(row.amount)}
                  to={`/qrm/deals/${row.id}`}
                />
              );
            })}
          </ul>
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
      return (data ?? []) as Array<{
        id: string;
        status: string;
        requested_at: string;
        decided_at: string | null;
        due_at: string | null;
      }>;
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
            sum + (new Date(row.decided_at as string).getTime() - new Date(row.requested_at).getTime()) / 3_600_000,
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
      return (data ?? []) as unknown as ApprovalDecisionRow[];
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
      return (data ?? []) as unknown as ServiceJobRow[];
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
      return (data ?? []) as unknown as ServiceJobRow[];
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
