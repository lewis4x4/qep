import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { UserRole } from "@/lib/database.types";
import { getEffectiveIronRole, type IronRole } from "@/features/qrm/lib/iron-roles";
import { useIronRoleBlend } from "@/features/qrm/lib/useIronRoleBlend";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Box,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  DollarSign,
  FileText,
  Files,
  MapPin,
  Mic,
  PackageSearch,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { useFloorLayout } from "../hooks/useFloorLayout";
import { useFloorNarrative } from "../hooks/useFloorNarrative";
import { useFloorAttentionSignals } from "../hooks/useFloorAttentionSignals";
import { applyAttentionPinning, type FloorWidgetWithAttention } from "../lib/attention";
import { FLOOR_WIDGET_REGISTRY, resolveFloorWidget } from "../lib/floor-widget-registry";
import type { FloorQuickAction } from "../lib/layout-types";
import { AdvisorBriefingBanner } from "../components/AdvisorBriefingBanner";
import { AdvisorActionCards } from "../components/AdvisorActionCards";
import { ManagerActionCards } from "../components/ManagerActionCards";
import { ExpiringIncentivesStrip } from "../components/ExpiringIncentivesStrip";

export interface FloorPageProps {
  userId: string;
  userRole: UserRole;
  userFullName: string | null;
  ironRoleFromProfile?: string | null;
}

const ADMIN_ROLES: UserRole[] = ["admin", "manager", "owner"];
const PREVIEWABLE_ROLES = new Set<IronRole>([
  "iron_manager",
  "iron_advisor",
  "iron_parts_counter",
  "iron_parts_manager",
  "iron_woman",
  "iron_man",
]);

const ROLE_HOME_COPY: Record<IronRole, {
  title: string;
  kicker: string;
  question: string;
  empty: string;
}> = {
  iron_owner: {
    title: "Owner Home",
    kicker: "Business health",
    question: "Is the business healthy?",
    empty: "Owner signals will appear here once the workspace has enough live activity.",
  },
  iron_manager: {
    title: "Manager Home",
    kicker: "Approvals and stale work",
    question: "Are my advisors closing? What needs my attention?",
    empty: "Manager work queues will appear here as approvals, aging deals, and margin signals come in.",
  },
  iron_advisor: {
    title: "Advisor Home",
    kicker: "Today's selling motion",
    question: "What do I do today?",
    empty: "Advisor priorities will appear here once quotes, follow-ups, and copilot turns are assigned.",
  },
  iron_woman: {
    title: "Deal Desk Home",
    kicker: "Blocker clearing",
    question: "What is blocking open deals?",
    empty: "Deal desk blockers will appear here when approvals, credit apps, or order-processing work is waiting.",
  },
  iron_man: {
    title: "Service Home",
    kicker: "Next job",
    question: "What is my next job?",
    empty: "Service work will appear here when jobs, demos, and PDI tasks are assigned.",
  },
  iron_parts_counter: {
    title: "Parts Counter Home",
    kicker: "Serial, quote, done",
    question: "What part request needs action first?",
    empty: "Counter inquiries and quote drafts will appear here as parts work arrives.",
  },
  iron_parts_manager: {
    title: "Parts Manager Home",
    kicker: "Inventory health",
    question: "Is stock healthy?",
    empty: "Parts demand, replenishment, and supplier signals will appear here as inventory data changes.",
  },
};

const QUICK_ACTION_ICON_MAP: Record<string, LucideIcon> = {
  quote: FileText,
  voice: Mic,
  visit: MapPin,
  wrench: Wrench,
  search: Search,
  drafts: Files,
  spark: Zap,
  users: Users,
  activity: Activity,
  check: ClipboardCheck,
  clipboard: ClipboardList,
  sparkles: Sparkles,
  box: Box,
  trending: TrendingUp,
  credit: CreditCard,
  money: DollarSign,
  approve: BadgeCheck,
  parts: PackageSearch,
};

function guessIcon(actionId: string): LucideIcon {
  if (actionId.includes("quote")) return FileText;
  if (actionId.includes("voice")) return Mic;
  if (actionId.includes("visit")) return MapPin;
  if (actionId.includes("lookup") || actionId.includes("search")) return Search;
  if (actionId.includes("draft")) return Files;
  if (actionId.includes("approval")) return BadgeCheck;
  if (actionId.includes("credit")) return CreditCard;
  if (actionId.includes("deposit") || actionId.includes("money")) return DollarSign;
  if (actionId.includes("replen") || actionId.includes("stock") || actionId.includes("parts")) return PackageSearch;
  if (actionId.includes("pdi") || actionId.includes("check")) return ClipboardCheck;
  if (actionId.includes("iron") || actionId.includes("ask")) return Sparkles;
  if (actionId.includes("pipeline")) return Activity;
  if (actionId.includes("job")) return Wrench;
  return Zap;
}

function resolveIcon(action: FloorQuickAction): LucideIcon {
  if (action.icon && QUICK_ACTION_ICON_MAP[action.icon]) return QUICK_ACTION_ICON_MAP[action.icon];
  return guessIcon(action.id);
}

export function FloorPage({
  userId,
  userRole,
  userFullName,
  ironRoleFromProfile,
}: FloorPageProps) {
  const [searchParams] = useSearchParams();
  const { blend } = useIronRoleBlend(userId);
  const resolvedIronRole = getEffectiveIronRole(userRole, blend, ironRoleFromProfile);
  const previewRoleParam = searchParams.get("view_as");
  const isAdmin = ADMIN_ROLES.includes(userRole);
  const previewRole =
    isAdmin && previewRoleParam && PREVIEWABLE_ROLES.has(previewRoleParam as IronRole)
      ? (previewRoleParam as IronRole)
      : null;
  const activeRole = previewRole ?? resolvedIronRole.role;
  const copy = ROLE_HOME_COPY[activeRole];
  const { layout, updatedAt, isLoading } = useFloorLayout(activeRole, previewRole ? null : userId);

  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  const displayName = userFullName ?? "";
  const firstName = displayName.split(" ").filter(Boolean)[0] ?? "";
  const narrative = useFloorNarrative(activeRole, firstName);
  const attentionSignals = useFloorAttentionSignals(activeRole, userId);

  const serialActionBand = useMemo(() => {
    const firstWidget = layout.widgets[0];
    if (activeRole !== "iron_parts_counter" || firstWidget?.id !== "parts.serial-first") {
      return null;
    }
    const descriptor = resolveFloorWidget(firstWidget.id);
    if (!descriptor) return null;
    const Component = descriptor.component;
    return <Component />;
  }, [activeRole, layout.widgets]);

  const roleWidgets = useMemo(
    () =>
      serialActionBand
        ? layout.widgets.filter((widget, index) => !(index === 0 && widget.id === "parts.serial-first"))
        : layout.widgets,
    [layout.widgets, serialActionBand],
  );

  const visibleWidgets = useMemo(
    () =>
      applyAttentionPinning(
        roleWidgets,
        FLOOR_WIDGET_REGISTRY,
        attentionSignals.data ?? null,
      ),
    [roleWidgets, attentionSignals.data],
  );

  const isOwner = activeRole === "iron_owner";
  const isAdvisor = activeRole === "iron_advisor";
  const isManager = activeRole === "iron_manager";

  return (
    <div className="min-h-screen bg-[#0b1018] text-slate-100 antialiased">
      <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        {isAdvisor ? <AdvisorBriefingBanner /> : null}
        {isManager ? <ExpiringIncentivesStrip /> : null}
        {/* Title block */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#f28a07]/35 bg-[#f28a07]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#f6a53a]">
              Role Home
            </span>
            {previewRole ? (
              <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-200">
                Read-only preview
              </span>
            ) : null}
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            {copy.title}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-slate-300">
            {copy.question}
          </p>
        </section>

        {/* 01 NARRATIVE */}
        <section className="rounded-2xl border border-white/5 bg-[#121927]/60 p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#f6a53a]">
            01 Narrative
          </p>
          <p className="mt-3 text-base leading-7 text-slate-200">
            {layout.showNarrative && !isLoading
              ? narrative.text
              : "Your role home is loading the current workspace signals."}
          </p>
          {narrative.model ? (
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Last 24h · {narrative.model}
            </p>
          ) : null}
        </section>

        {/* 02 ACTIONS */}
        <section>
          <p className="mb-3 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#f6a53a]">
            02 Actions
          </p>
          {serialActionBand ? <div className="mb-3">{serialActionBand}</div> : null}
          {isAdvisor ? (
            <AdvisorActionCards />
          ) : isManager ? (
            <ManagerActionCards />
          ) : layout.quickActions.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {layout.quickActions.map((action, index) => (
                <RoleAction key={action.id} action={action} index={index} />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">
              No shortcuts are assigned to this role.
            </p>
          )}
        </section>

        {/* 03 THE FLOOR */}
        <section className="rounded-2xl border border-white/5 bg-[#0f1624]/60 p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#f6a53a]">
                03 The Floor
              </p>
              <h2 className="mt-0.5 text-base font-semibold tracking-tight text-white">
                Work Queue signals
              </h2>
            </div>
            <div className="text-xs text-slate-500">
              {updatedAt
                ? `Synced ${new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "Sync pending"}
              {isAdmin ? " · Office tools remain in the main app" : ""}
            </div>
          </div>

          {isOwner ? (
            <OwnerFloorGrid widgets={visibleWidgets} isLoading={isLoading} />
          ) : isAdvisor ? (
            <AdvisorFloorGrid widgets={visibleWidgets} isLoading={isLoading} />
          ) : isManager ? (
            <ManagerFloorGrid widgets={visibleWidgets} isLoading={isLoading} />
          ) : (
            <RoleWidgetGrid widgets={visibleWidgets} isLoading={isLoading} emptyMessage={copy.empty} />
          )}
        </section>
      </main>
    </div>
  );
}

function RoleAction({ action, index }: { action: FloorQuickAction; index: number }) {
  const Icon = resolveIcon(action);
  return (
    <Link
      to={action.route}
      className={cn(
        "group flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-all",
        index === 0
          ? "border-[#f28a07]/45 bg-[#f28a07]/10 text-white hover:bg-[#f28a07]/15"
          : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.07]",
      )}
      aria-label={`${action.label}${action.subLabel ? ` — ${action.subLabel}` : ""}`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          index === 0 ? "bg-[#f28a07] text-[#15100a]" : "bg-black/25 text-slate-300",
        )}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{action.label}</span>
          {action.subLabel ? <span className="block truncate text-xs text-slate-500">{action.subLabel}</span> : null}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-[#f28a07]" aria-hidden="true" />
    </Link>
  );
}

function OwnerFloorGrid({
  widgets,
  isLoading,
}: {
  widgets: FloorWidgetWithAttention[];
  isLoading: boolean;
}) {
  const find = (id: string) => widgets.find((w) => w.id === id);
  const customerHealth = find("nervous.customer-health");
  const revenuePace = find("exec.revenue-pace");
  const buPulse = find("exec.bu-pulse");
  const largeDeals = find("iron.owner-large-deals");

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="min-h-[220px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
          <div className="min-h-[220px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04] md:col-span-2" />
        </div>
        <div className="min-h-[140px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
        <div className="min-h-[340px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
      </div>
    );
  }

  const renderWidget = (widget: FloorWidgetWithAttention | undefined) => {
    if (!widget) return null;
    const descriptor = resolveFloorWidget(widget.id);
    if (!descriptor) return null;
    const Component = descriptor.component;
    return <Component />;
  };

  return (
    <div className="space-y-3">
      {/* Row 1: Customer Health (1/3) + Revenue Pace (2/3) */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-1">{renderWidget(customerHealth)}</div>
        <div className="md:col-span-2">{renderWidget(revenuePace)}</div>
      </div>
      {/* Row 2: BU Pulse full width */}
      {buPulse ? <div>{renderWidget(buPulse)}</div> : null}
      {/* Row 3: Deals table full width */}
      {largeDeals ? <div>{renderWidget(largeDeals)}</div> : null}
    </div>
  );
}

function AdvisorFloorGrid({
  widgets,
  isLoading,
}: {
  widgets: FloorWidgetWithAttention[];
  isLoading: boolean;
}) {
  const find = (id: string) => widgets.find((w) => w.id === id);
  const myQuotes = find("sales.my-quotes-by-status");
  const actionItems = find("sales.action-items");
  const recentActivity = find("sales.recent-activity");
  const followUpQueue = find("qrm.follow-up-queue");
  // sales.ai-briefing intentionally omitted — it now renders as the
  // collapsible AdvisorBriefingBanner at the very top of FloorPage.

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="min-h-[420px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04] md:col-span-2" />
          <div className="flex min-h-[420px] flex-col gap-3">
            <div className="flex-1 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
            <div className="flex-1 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
          </div>
        </div>
        <div className="min-h-[260px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
      </div>
    );
  }

  const renderWidget = (widget: FloorWidgetWithAttention | undefined) => {
    if (!widget) return null;
    const descriptor = resolveFloorWidget(widget.id);
    if (!descriptor) return null;
    const Component = descriptor.component;
    return <Component />;
  };

  return (
    <div className="space-y-3">
      {/* Row 1: Hero (2/3) + Stacked rail (1/3) */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="min-w-0 md:col-span-2">{renderWidget(myQuotes)}</div>
        <div className="flex min-w-0 flex-col gap-3 md:col-span-1">
          {actionItems ? <div className="min-h-0">{renderWidget(actionItems)}</div> : null}
          {recentActivity ? <div className="min-h-0">{renderWidget(recentActivity)}</div> : null}
        </div>
      </div>
      {/* Row 2: Pipeline below-fold full width */}
      {followUpQueue ? <div className="min-w-0">{renderWidget(followUpQueue)}</div> : null}
    </div>
  );
}

function ManagerFloorGrid({
  widgets,
  isLoading,
}: {
  widgets: FloorWidgetWithAttention[];
  isLoading: boolean;
}) {
  const find = (id: string) => widgets.find((w) => w.id === id);
  const teamPipeline = find("iron.team-pipeline-table");
  const approvalQueue = find("iron.approval-queue");
  const managerForecast = find("iron.manager-forecast");
  const marginTrend = find("iron.margin-trend");
  const stalledDeals = find("iron.manager-stalled-deals");
  const largeDeals = find("iron.owner-large-deals");

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="min-h-[420px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04] md:col-span-2" />
          <div className="flex min-h-[420px] flex-col gap-3">
            <div className="flex-1 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
            <div className="flex-1 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
            <div className="flex-1 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
          </div>
        </div>
        <div className="min-h-[260px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
        <div className="min-h-[260px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
      </div>
    );
  }

  const renderWidget = (widget: FloorWidgetWithAttention | undefined) => {
    if (!widget) return null;
    const descriptor = resolveFloorWidget(widget.id);
    if (!descriptor) return null;
    const Component = descriptor.component;
    return <Component />;
  };

  return (
    <div className="space-y-3">
      {/* Row 1: Team pipeline hero (2/3) + stacked rail (1/3) */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="min-w-0 md:col-span-2">{renderWidget(teamPipeline)}</div>
        <div className="flex min-w-0 flex-col gap-3 md:col-span-1">
          {approvalQueue ? <div className="min-h-0">{renderWidget(approvalQueue)}</div> : null}
          {managerForecast ? <div className="min-h-0">{renderWidget(managerForecast)}</div> : null}
          {marginTrend ? <div className="min-h-0">{renderWidget(marginTrend)}</div> : null}
        </div>
      </div>
      {/* Row 2: Stalled deals — full width below fold */}
      {stalledDeals ? <div className="min-w-0">{renderWidget(stalledDeals)}</div> : null}
      {/* Row 3: Top deals ≥ $250K — full width below fold */}
      {largeDeals ? <div className="min-w-0">{renderWidget(largeDeals)}</div> : null}
    </div>
  );
}

function RoleWidgetGrid({
  widgets,
  isLoading,
  emptyMessage,
}: {
  widgets: FloorWidgetWithAttention[];
  isLoading: boolean;
  emptyMessage: string;
}) {
  const resolved = widgets
    .map((widget) => ({ ...widget, descriptor: resolveFloorWidget(widget.id) }))
    .filter((widget): widget is FloorWidgetWithAttention & { descriptor: NonNullable<ReturnType<typeof resolveFloorWidget>> } => Boolean(widget.descriptor));

  if (isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="min-h-[220px] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
        ))}
      </div>
    );
  }

  if (resolved.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center">
        <p className="text-sm text-slate-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {resolved.map((widget, index) => {
        const Component = widget.descriptor.component;
        return (
          <div
            key={`${widget.id}-${index}`}
            className={cn(
              "relative min-w-0",
              widget.descriptor.size === "wide" ? "md:col-span-2 xl:col-span-2" : "",
            )}
          >
            {widget.attentionPinned && widget.attention?.reason ? (
              <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full border border-[#f28a07]/40 bg-[#1a1208]/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#f6a53a] shadow-[0_12px_32px_-20px_#f28a07]">
                Attention · {widget.attention.reason}
              </div>
            ) : null}
            <Component />
          </div>
        );
      })}
    </div>
  );
}
