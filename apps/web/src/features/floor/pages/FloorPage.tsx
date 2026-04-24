import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import type { UserRole } from "@/lib/database.types";
import { getEffectiveIronRole, type IronRole } from "@/features/qrm/lib/iron-roles";
import { useIronRoleBlend } from "@/features/qrm/lib/useIronRoleBlend";
import { supabase } from "@/lib/supabase";
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
  Home,
  LogOut,
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

import { FloorJumpMenu } from "../components/FloorJumpMenu";
import { useFloorLayout } from "../hooks/useFloorLayout";
import { useFloorNarrative } from "../hooks/useFloorNarrative";
import { useFloorAttentionSignals } from "../hooks/useFloorAttentionSignals";
import { applyAttentionPinning, type FloorWidgetWithAttention } from "../lib/attention";
import { FLOOR_WIDGET_REGISTRY, resolveFloorWidget } from "../lib/floor-widget-registry";
import type { FloorQuickAction } from "../lib/layout-types";

export interface FloorPageProps {
  userId: string;
  userRole: UserRole;
  userFullName: string | null;
  ironRoleFromProfile?: string | null;
}

const ADMIN_ROLES: UserRole[] = ["admin", "manager", "owner"];

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
    question: "What needs approval, and what is getting stale?",
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
  const { blend } = useIronRoleBlend(userId);
  const ironRole = getEffectiveIronRole(userRole, blend, ironRoleFromProfile);
  const copy = ROLE_HOME_COPY[ironRole.role];
  const { layout, updatedAt, isLoading } = useFloorLayout(ironRole.role, userId);

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
  const isAdmin = ADMIN_ROLES.includes(userRole);
  const narrative = useFloorNarrative(ironRole.role, firstName);
  const attentionSignals = useFloorAttentionSignals(ironRole.role, userId);

  const serialActionBand = useMemo(() => {
    const firstWidget = layout.widgets[0];
    if (ironRole.role !== "iron_parts_counter" || firstWidget?.id !== "parts.serial-first") {
      return null;
    }
    const descriptor = resolveFloorWidget(firstWidget.id);
    if (!descriptor) return null;
    const Component = descriptor.component;
    return <Component />;
  }, [ironRole.role, layout.widgets]);

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

  return (
    <div className="min-h-screen bg-[#0b1018] text-slate-100 antialiased">
      <RoleHomeHeader userDisplayName={displayName || copy.title} roleDisplayName={copy.title} />

      <main className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#121927] p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)] sm:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#f28a07]/35 bg-[#f28a07]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#f6a53a]">
                    Role Home
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {copy.kicker}
                  </span>
                </div>
                <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  {copy.title}
                </h1>
                <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">
                  {copy.question}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 md:max-w-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Today's read
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  {layout.showNarrative && !isLoading ? narrative.text : "Your role home is loading the current workspace signals."}
                </p>
                <div className="mt-3 h-1 rounded-full bg-slate-800">
                  <div className="h-full w-2/3 rounded-full bg-[#f28a07]" />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#121927] p-4 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)]">
            <p className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Shortcuts
            </p>
            <div className="mt-3 grid gap-2">
              {serialActionBand ? <div>{serialActionBand}</div> : null}
              {layout.quickActions.length > 0 ? (
                layout.quickActions.map((action, index) => (
                  <RoleAction key={action.id} action={action} index={index} />
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">
                  No shortcuts are assigned to this role.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-[#0f1624] p-4 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)] sm:p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#f6a53a]">
                Work Queue
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">
                Role-specific signals
              </h2>
            </div>
            <div className="text-xs text-slate-500">
              {updatedAt ? `Synced ${new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Sync pending"}
              {isAdmin ? " · Office tools remain in the main app" : ""}
            </div>
          </div>

          <RoleWidgetGrid widgets={visibleWidgets} isLoading={isLoading} emptyMessage={copy.empty} />
        </section>
      </main>
    </div>
  );
}

function RoleHomeHeader({
  userDisplayName,
  roleDisplayName,
}: {
  userDisplayName: string;
  roleDisplayName: string;
}) {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.assign("/login");
  };

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0b1018]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1480px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link to="/floor" className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f28a07] text-[#15100a] shadow-[0_0_24px_-12px_#f28a07]">
            <Home className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">QEP Role Home</span>
            <span className="block truncate text-xs text-slate-500">{roleDisplayName}</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <FloorJumpMenu />
          </div>
          <div className="hidden min-w-0 text-right md:block">
            <p className="truncate text-sm font-semibold text-white">{userDisplayName}</p>
            <p className="truncate text-xs text-slate-500">{roleDisplayName}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:border-[#f28a07]/40 hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
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
