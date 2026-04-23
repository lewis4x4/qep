/**
 * OperationalWidgets — Floor-native real-data widgets for Phase 2+.
 *
 * These replace former preview placeholders without taking ownership of the source
 * domains. Each widget reads a small RLS-scoped summary and renders in the
 * same Floor frame as the rest of the surface.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  Boxes,
  BriefcaseBusiness,
  CalendarClock,
  FileClock,
  Gauge,
  HeartPulse,
  PackageCheck,
  PackageSearch,
  ReceiptText,
  TrendingUp,
  Truck,
  Wrench,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { fetchOwnerDashboardSummary } from "@/features/owner/lib/owner-api";
import { useDemandForecast } from "@/features/parts/hooks/useDemandForecast";
import { useInventoryHealth } from "@/features/parts/hooks/useInventoryHealth";
import { usePartsOrders, type PartsOrderListRow } from "@/features/parts/hooks/usePartsOrders";
import { useServiceJobList } from "@/features/service/hooks/useServiceJobs";
import type { ServiceJobWithRelations } from "@/features/service/lib/types";
import {
  EmptyState,
  ErrorLine,
  FloorWidgetShell,
  LoadingLine,
} from "./DirectWrapWidgets";

type CustomerPartsIntelRow = {
  id: string;
  crm_company_id: string;
  churn_risk: string;
  spend_trend: string;
  order_count_12m: number;
  total_spend_12m: number;
  predicted_next_quarter_spend: number;
  opportunity_value: number;
  days_since_last_order: number | null;
  recommended_outreach: string | null;
  computed_at: string;
  crm_companies?: { id: string; name: string } | { id: string; name: string }[] | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  status: string;
  total: number;
  balance_due: number | null;
  due_date: string;
  created_at: string;
  crm_companies?: { name: string } | { name: string }[] | null;
};

type VendorRow = {
  id: string;
  name: string;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  fill_rate: number | null;
  composite_score: number | null;
  machine_down_priority: boolean;
};

type DealRow = {
  id: string;
  name: string;
  amount: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  stage_id: string;
};

type DealStageRow = {
  id: string;
  name: string;
  is_closed_won: boolean;
  is_closed_lost: boolean;
};

type QuotePackageRow = {
  id: string;
  customer_company: string | null;
  net_total: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

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

function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return `${Math.round(Number(value) * 100)}%`;
}

function daysBetween(start: string, end = new Date()): number {
  const startMs = new Date(start).getTime();
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.round((end.getTime() - startMs) / 86_400_000));
}

function isSameLocalDay(value: string): boolean {
  const d = new Date(value);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function lineItemCount(order: PartsOrderListRow): number {
  const lineItems = order.line_items;
  if (Array.isArray(lineItems)) return lineItems.length;
  if (lineItems && typeof lineItems === "object" && Array.isArray((lineItems as { items?: unknown[] }).items)) {
    return (lineItems as { items: unknown[] }).items.length;
  }
  return 0;
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/55 px-3 py-2">
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

function MiniRow({
  title,
  detail,
  value,
}: {
  title: string;
  detail?: string;
  value?: string;
}) {
  return (
    <li className="flex min-w-0 items-center justify-between gap-3 border-b border-[hsl(var(--qep-deck-rule))]/60 py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-foreground">{title}</p>
        {detail ? <p className="truncate text-[11px] text-muted-foreground">{detail}</p> : null}
      </div>
      {value ? (
        <span className="shrink-0 font-kpi text-xs font-extrabold uppercase tracking-[0.08em] text-[hsl(var(--qep-orange))]">
          {value}
        </span>
      ) : null}
    </li>
  );
}

export function MorningBriefFloorWidget() {
  const events = useQuery({
    queryKey: ["floor", "morning-brief", "events"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_event_feed", {
        p_workspace: null,
        p_hours_back: 24,
      });
      if (error) throw error;
      return data as { count: number; events: { type: string; summary: string; at: string }[] };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const items = events.data?.events?.slice(0, 3) ?? [];

  return (
    <FloorWidgetShell
      title="Morning brief"
      icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/owner"
      linkLabel="Brief"
      minHeight="min-h-[210px]"
    >
      {events.isLoading ? <LoadingLine /> : null}
      {events.isError ? <ErrorLine>Couldn't load overnight signals.</ErrorLine> : null}
      {!events.isLoading && !events.isError ? (
        <div className="space-y-3">
          <Metric
            label="Last 24 hours"
            value={String(events.data?.count ?? 0)}
            detail="New orders, wins, imports, and predictive plays"
          />
          {items.length > 0 ? (
            <ul>
              {items.map((event, index) => (
                <MiniRow
                  key={`${event.type}-${event.at}-${index}`}
                  title={event.summary}
                  detail={new Date(event.at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  value={event.type.replace(/_/g, " ")}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Quiet overnight. The narrative strip will stay on deterministic fallback until new signal volume appears.
            </p>
          )}
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

export function SalesCommissionSourceFloorWidget() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["floor", "sales", "commission-source", user?.id ?? "all"],
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      let builder = supabase
        .from("quote_packages")
        .select("id, customer_company, net_total, status, created_at, updated_at, created_by")
        .gte("updated_at", monthStart.toISOString())
        .in("status", ["accepted", "won", "closed_won", "signed"])
        .order("updated_at", { ascending: false })
        .limit(25);

      if (user?.id) builder = builder.eq("created_by", user.id);
      const { data, error } = await builder;
      if (error) throw error;
      const rows = (data ?? []) as QuotePackageRow[];
      return {
        rows,
        bookedValue: rows.reduce((sum, row) => sum + Number(row.net_total ?? 0), 0),
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <FloorWidgetShell
      title="Commission source"
      icon={<BadgeDollarSign className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/quote-v2"
      linkLabel="Quotes"
      minHeight="min-h-[210px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load closed quote value.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="MTD source" value={currency(query.data?.bookedValue)} detail="Accepted quote value" />
            <Metric label="Closed rows" value={String(query.data?.rows.length ?? 0)} detail="QA-R2 defines commission math" />
          </div>
          <ul>
            {(query.data?.rows ?? []).slice(0, 3).map((row) => (
              <MiniRow
                key={row.id}
                title={row.customer_company ?? "Closed quote"}
                detail={statusLabel(row.status)}
                value={currency(row.net_total)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

export function PartsQuoteDraftsFloorWidget() {
  const { data, isLoading, isError } = usePartsOrders();
  const drafts = useMemo(
    () => (data ?? []).filter((row) => row.status === "draft" || row.status === "saved"),
    [data],
  );

  return (
    <FloorWidgetShell
      title="Parts drafts"
      icon={<FileClock className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/parts/orders"
      linkLabel="Drafts"
      minHeight="min-h-[200px]"
    >
      {isLoading ? <LoadingLine /> : null}
      {isError ? <ErrorLine>Couldn't load parts drafts.</ErrorLine> : null}
      {!isLoading && !isError ? (
        drafts.length > 0 ? (
          <div className="space-y-3">
            <Metric label="Open drafts" value={String(drafts.length)} detail="Saved counter work" />
            <ul>
              {drafts.slice(0, 3).map((order) => (
                <MiniRow
                  key={order.id}
                  title={order.crm_companies?.name ?? order.portal_customers?.email ?? "Parts draft"}
                  detail={`${lineItemCount(order)} lines · ${daysBetween(order.created_at)}d old`}
                  value={statusLabel(order.status)}
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={<PackageCheck className="h-6 w-6" aria-hidden="true" />}
            title="No saved drafts"
            body="Counter drafts will appear here when parts work is paused before submit."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function PartsOrderStatusFloorWidget() {
  const { data, isLoading, isError } = usePartsOrders();
  const today = useMemo(() => (data ?? []).filter((row) => isSameLocalDay(row.created_at)), [data]);
  const open = useMemo(
    () => (data ?? []).filter((row) => !["delivered", "cancelled", "canceled"].includes(row.status)),
    [data],
  );
  const ready = open.filter((row) => ["confirmed", "processing", "shipped"].includes(row.status)).length;

  return (
    <FloorWidgetShell
      title="Order status"
      icon={<Truck className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/parts/orders"
      linkLabel="Orders"
      minHeight="min-h-[220px]"
    >
      {isLoading ? <LoadingLine /> : null}
      {isError ? <ErrorLine>Couldn't load parts orders.</ErrorLine> : null}
      {!isLoading && !isError ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Today" value={String(today.length)} />
            <Metric label="Open" value={String(open.length)} />
            <Metric label="Moving" value={String(ready)} />
          </div>
          <ul>
            {open.slice(0, 4).map((order) => (
              <MiniRow
                key={order.id}
                title={order.crm_companies?.name ?? order.portal_customers?.email ?? "Parts order"}
                detail={`${lineItemCount(order)} lines · ${statusLabel(order.order_source)}`}
                value={statusLabel(order.status)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

export function PartsCustomerIntelFloorWidget() {
  const query = useQuery({
    queryKey: ["floor", "parts", "customer-intel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_parts_intelligence")
        .select(
          `
          id,
          crm_company_id,
          churn_risk,
          spend_trend,
          order_count_12m,
          total_spend_12m,
          predicted_next_quarter_spend,
          opportunity_value,
          days_since_last_order,
          recommended_outreach,
          computed_at,
          crm_companies!customer_parts_intelligence_crm_company_id_fkey ( id, name )
        `,
        )
        .order("computed_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as CustomerPartsIntelRow[];
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const focus = query.data?.[0] ?? null;
  const company = one(focus?.crm_companies);

  return (
    <FloorWidgetShell
      title="Customer intel"
      icon={<HeartPulse className="h-3.5 w-3.5" aria-hidden="true" />}
      to={company ? `/qrm/companies/${company.id}` : "/parts/analytics"}
      linkLabel={company ? "Open" : "Analytics"}
      minHeight="min-h-[220px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load customer parts intelligence.</ErrorLine> : null}
      {!query.isLoading && !query.isError ? (
        focus ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/55 px-3 py-2">
              <p className="truncate text-sm font-semibold text-foreground">{company?.name ?? "Customer"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {statusLabel(focus.spend_trend)} spend · {statusLabel(focus.churn_risk)} churn risk
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="12m spend" value={currency(focus.total_spend_12m)} />
              <Metric label="Next qtr" value={currency(focus.predicted_next_quarter_spend)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {focus.recommended_outreach ?? "No outreach recommendation on the latest intelligence row."}
            </p>
          </div>
        ) : (
          <EmptyState
            icon={<PackageSearch className="h-6 w-6" aria-hidden="true" />}
            title="No customer intel yet"
            body="Parts intelligence rows will appear once the analytics snapshot job runs."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function PartsDemandForecastFloorWidget() {
  const forecast = useDemandForecast();
  const rows = forecast.data?.rows ?? [];

  return (
    <FloorWidgetShell
      title="Demand forecast"
      icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/parts/forecast"
      linkLabel="Forecast"
      minHeight="min-h-[240px]"
    >
      {forecast.isLoading ? <LoadingLine /> : null}
      {forecast.isError ? <ErrorLine>Couldn't load demand forecast.</ErrorLine> : null}
      {!forecast.isLoading && !forecast.isError ? (
        rows.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Action" value={String(forecast.data?.actionRequired ?? 0)} />
              <Metric label="Critical" value={String(forecast.data?.criticalRiskCount ?? 0)} />
              <Metric label="Watch" value={String(forecast.data?.watchCount ?? 0)} />
            </div>
            <ul>
              {rows.slice(0, 4).map((row) => (
                <MiniRow
                  key={`${row.part_number}-${row.branch_id}-${row.forecast_month}`}
                  title={row.part_number}
                  detail={`${row.branch_id} · ${statusLabel(row.stockout_risk)} risk`}
                  value={`${Math.round(row.predicted_qty)} qty`}
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={<TrendingUp className="h-6 w-6" aria-hidden="true" />}
            title="Forecast clear"
            body="No high-risk forecast rows are currently calling for action."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function PartsInventoryHealthFloorWidget() {
  const inventory = useInventoryHealth();
  const rows = inventory.data?.rows ?? [];
  const stockouts = rows.filter((row) => row.stock_status === "stockout").length;
  const critical = rows.filter((row) => row.stock_status === "critical").length;
  const reorder = rows.filter((row) => row.stock_status === "reorder").length;

  return (
    <FloorWidgetShell
      title="Inventory health"
      icon={<Boxes className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/parts/inventory"
      linkLabel="Inventory"
      minHeight="min-h-[220px]"
    >
      {inventory.isLoading ? <LoadingLine /> : null}
      {inventory.isError ? <ErrorLine>Couldn't load inventory health.</ErrorLine> : null}
      {!inventory.isLoading && !inventory.isError ? (
        rows.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Out" value={String(stockouts)} />
              <Metric label="Critical" value={String(critical)} />
              <Metric label="Reorder" value={String(reorder)} />
            </div>
            <ul>
              {rows.slice(0, 4).map((row) => (
                <MiniRow
                  key={row.inventory_id}
                  title={row.part_number}
                  detail={`${row.branch_id} · ${statusLabel(row.stock_status)}`}
                  value={`${row.qty_on_hand} ea`}
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={<PackageCheck className="h-6 w-6" aria-hidden="true" />}
            title="Stock levels clear"
            body="No stockout, critical, reorder, or low-profile rows are currently visible."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function ExecRevenuePaceFloorWidget() {
  const query = useQuery({
    queryKey: ["floor", "exec", "revenue-pace"],
    queryFn: fetchOwnerDashboardSummary,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <FloorWidgetShell
      title="Revenue pace"
      icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/owner"
      linkLabel="Owner"
      minHeight="min-h-[205px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load owner revenue summary.</ErrorLine> : null}
      {!query.isLoading && !query.isError && query.data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="MTD booked" value={currency(query.data.revenue.mtd)} detail={`Today ${currency(query.data.revenue.today)}`} />
            <Metric label="Pipeline" value={currency(query.data.pipeline.weighted_total)} detail={`${query.data.pipeline.at_risk_count} at risk`} />
          </div>
          <p className="text-xs text-muted-foreground">
            {query.data.revenue.mtd_vs_prev_pct == null
              ? "No prior-month comparison yet."
              : `${query.data.revenue.mtd_vs_prev_pct.toFixed(1)}% vs. prior month same-day pace.`}
          </p>
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

export function ExecDealVelocityFloorWidget() {
  const query = useQuery({
    queryKey: ["floor", "exec", "deal-velocity"],
    queryFn: async () => {
      const [{ data: deals, error: dealsError }, { data: stages, error: stagesError }] =
        await Promise.all([
          supabase
            .from("qrm_deals")
            .select("id, name, amount, created_at, updated_at, closed_at, stage_id")
            .is("deleted_at", null)
            .order("updated_at", { ascending: true })
            .limit(100),
          supabase
            .from("qrm_deal_stages")
            .select("id, name, is_closed_won, is_closed_lost"),
        ]);
      if (dealsError) throw dealsError;
      if (stagesError) throw stagesError;
      const stageMap = new Map((stages ?? []).map((stage) => [stage.id, stage as DealStageRow]));
      const openDeals = ((deals ?? []) as DealRow[]).filter((deal) => {
        const stage = stageMap.get(deal.stage_id);
        return !deal.closed_at && !stage?.is_closed_won && !stage?.is_closed_lost;
      });
      const totalAge = openDeals.reduce((sum, deal) => sum + daysBetween(deal.updated_at), 0);
      const stalled = openDeals.filter((deal) => daysBetween(deal.updated_at) >= 14);
      return {
        openDeals,
        stalled,
        averageStageAge: openDeals.length ? Math.round(totalAge / openDeals.length) : 0,
        stageMap,
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <FloorWidgetShell
      title="Deal velocity"
      icon={<BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/qrm/deals"
      linkLabel="Deals"
      minHeight="min-h-[220px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load deal velocity.</ErrorLine> : null}
      {!query.isLoading && !query.isError && query.data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Open" value={String(query.data.openDeals.length)} />
            <Metric label="Avg age" value={`${query.data.averageStageAge}d`} />
            <Metric label="Stalled" value={String(query.data.stalled.length)} />
          </div>
          <ul>
            {query.data.stalled.slice(0, 3).map((deal) => (
              <MiniRow
                key={deal.id}
                title={deal.name}
                detail={query.data.stageMap.get(deal.stage_id)?.name ?? "Pipeline"}
                value={`${daysBetween(deal.updated_at)}d`}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

export function PendingInvoicesFloorWidget() {
  const query = useQuery({
    queryKey: ["floor", "iron-woman", "pending-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_invoices")
        .select(
          `
          id,
          invoice_number,
          status,
          total,
          balance_due,
          due_date,
          created_at,
          crm_companies!customer_invoices_crm_company_id_fkey ( name )
        `,
        )
        .in("status", ["pending", "sent", "overdue", "approved", "draft"])
        .order("due_date", { ascending: true })
        .limit(25);
      if (error) throw error;
      const rows = (data ?? []) as InvoiceRow[];
      return {
        rows,
        totalDue: rows.reduce((sum, row) => sum + Number(row.balance_due ?? row.total ?? 0), 0),
        overdue: rows.filter((row) => row.status === "overdue" || new Date(row.due_date) < new Date()).length,
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <FloorWidgetShell
      title="Pending invoices"
      icon={<ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/service"
      linkLabel="Office"
      minHeight="min-h-[220px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load pending invoices.</ErrorLine> : null}
      {!query.isLoading && !query.isError && query.data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Rows" value={String(query.data.rows.length)} />
            <Metric label="Due" value={currency(query.data.totalDue)} />
            <Metric label="Late" value={String(query.data.overdue)} />
          </div>
          <ul>
            {query.data.rows.slice(0, 3).map((row) => (
              <MiniRow
                key={row.id}
                title={one(row.crm_companies)?.name ?? row.invoice_number}
                detail={`Due ${new Date(row.due_date).toLocaleDateString()}`}
                value={currency(row.balance_due ?? row.total)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

export function OpenServiceTicketsFloorWidget() {
  const { data, isLoading, isError } = useServiceJobList({
    per_page: 40,
    include_closed: false,
  });

  const jobs = (data?.jobs ?? []) as ServiceJobWithRelations[];
  const waiting = jobs.filter((job) =>
    (job.status_flags ?? []).some((flag) => String(flag).startsWith("waiting_")),
  );
  const critical = jobs.filter((job) => job.priority === "critical" || job.priority === "urgent");

  return (
    <FloorWidgetShell
      title="Open service tickets"
      icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/service/wip"
      linkLabel="WIP"
      minHeight="min-h-[220px]"
    >
      {isLoading ? <LoadingLine /> : null}
      {isError ? <ErrorLine>Couldn't load open service tickets.</ErrorLine> : null}
      {!isLoading && !isError ? (
        jobs.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Open" value={String(jobs.length)} />
              <Metric label="Waiting" value={String(waiting.length)} />
              <Metric label="Urgent" value={String(critical.length)} />
            </div>
            <ul>
              {jobs.slice(0, 3).map((job) => (
                <MiniRow
                  key={job.id}
                  title={job.customer?.name ?? job.requested_by_name ?? "Service job"}
                  detail={job.customer_problem_summary ?? statusLabel(job.current_stage)}
                  value={statusLabel(job.priority)}
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={<PackageCheck className="h-6 w-6" aria-hidden="true" />}
            title="No open tickets"
            body="Service WIP is clear from the Floor's current view."
          />
        )
      ) : null}
    </FloorWidgetShell>
  );
}

export function PartsLostSalesFloorWidget() {
  const { data, isLoading, isError } = usePartsOrders();
  const lost = useMemo(
    () =>
      (data ?? []).filter((row) =>
        ["cancelled", "canceled", "rejected", "lost", "expired"].includes(row.status),
      ),
    [data],
  );
  const recent = lost.slice(0, 5);

  return (
    <FloorWidgetShell
      title="Lost parts sales"
      icon={<PackageSearch className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/parts/analytics"
      linkLabel="Review"
      minHeight="min-h-[210px]"
    >
      {isLoading ? <LoadingLine /> : null}
      {isError ? <ErrorLine>Couldn't load lost parts signals.</ErrorLine> : null}
      {!isLoading && !isError ? (
        <div className="space-y-3">
          <Metric
            label="Lost signals"
            value={String(lost.length)}
            detail="Cancelled, rejected, lost, or expired parts rows"
          />
          {recent.length > 0 ? (
            <ul>
              {recent.slice(0, 3).map((order) => (
                <MiniRow
                  key={order.id}
                  title={order.crm_companies?.name ?? order.portal_customers?.email ?? "Parts order"}
                  detail={`${lineItemCount(order)} lines · ${daysBetween(order.created_at)}d old`}
                  value={statusLabel(order.status)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No lost parts rows in the current orders list. QA-N1 still defines reason-code logging.
            </p>
          )}
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

export function PartsSupplierHealthFloorWidget() {
  const query = useQuery({
    queryKey: ["floor", "parts", "supplier-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_profiles")
        .select("id, name, avg_lead_time_hours, responsiveness_score, fill_rate, composite_score, machine_down_priority")
        .order("machine_down_priority", { ascending: false })
        .limit(40);
      if (error) throw error;
      const rows = (data ?? []) as VendorRow[];
      const avg = (values: number[]) =>
        values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      return {
        rows,
        machineDown: rows.filter((row) => row.machine_down_priority),
        avgFill: avg(rows.map((row) => Number(row.fill_rate)).filter(Number.isFinite)),
        avgComposite: avg(rows.map((row) => Number(row.composite_score)).filter(Number.isFinite)),
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <FloorWidgetShell
      title="Supplier health"
      icon={<Boxes className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/parts/vendors"
      linkLabel="Vendors"
      minHeight="min-h-[220px]"
    >
      {query.isLoading ? <LoadingLine /> : null}
      {query.isError ? <ErrorLine>Couldn't load supplier health.</ErrorLine> : null}
      {!query.isLoading && !query.isError && query.data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Vendors" value={String(query.data.rows.length)} />
            <Metric label="Fill" value={pct(query.data.avgFill)} />
            <Metric label="Score" value={pct(query.data.avgComposite)} />
          </div>
          <ul>
            {query.data.rows.slice(0, 3).map((vendor) => (
              <MiniRow
                key={vendor.id}
                title={vendor.name}
                detail={vendor.machine_down_priority ? "Machine-down priority" : "Standard vendor"}
                value={pct(vendor.composite_score)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}
