import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Layers,
  Clock,
  AlertTriangle,
  Phone,
  User,
  Wrench,
  Box,
  CheckCircle2,
  Package,
  Timer,
  TrendingUp,
  ArrowRight,
  Search,
  Copy,
  Check,
  Truck,
} from "lucide-react";
import { fetchPartsQueue, assignRequest, updateRequestStatus } from "../lib/companion-api";
import type { QueueItem, RequestPriority, RequestSource } from "../lib/types";
import { supabase } from "../../../lib/supabase";

// ── Design Tokens ──────────────────────────────────────────

const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  cardHover: "#182A44",
  border: "#1F3254",
  borderSoft: "#18263F",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  orangeDeep: "rgba(232,119,34,0.35)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  danger: "#EF4444",
  dangerBg: "rgba(239,68,68,0.12)",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.12)",
  info: "#3B82F6",
  infoBg: "rgba(59,130,246,0.12)",
  purple: "#A855F7",
  purpleBg: "rgba(168,85,247,0.14)",
} as const;

// ── SLA thresholds (minutes) per priority ──────────────────

const SLA: Record<string, number> = {
  critical: 30,
  urgent: 60,
  normal: 120,
  low: 240,
};

// ── Utility ────────────────────────────────────────────────

function formatAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function isStalled(item: QueueItem): boolean {
  const sla = SLA[item.priority] ?? 120;
  return item.age_minutes > sla * 4;
}

// ── Micro Components ───────────────────────────────────────

function IronAvatarMini({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="flex-shrink-0">
      <defs>
        <radialGradient id="ironBgQ" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#1F3254" />
          <stop offset="100%" stopColor="#0A1628" />
        </radialGradient>
        <linearGradient id="ironHatQ" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F08838" />
          <stop offset="100%" stopColor="#D06A1E" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="url(#ironBgQ)" />
      <ellipse cx="32" cy="38" rx="12" ry="13" fill="#E8C39A" />
      <path d="M15 32 Q15 20 32 20 Q49 20 49 32 L49 34 L15 34 Z" fill="url(#ironHatQ)" />
      <rect x="14" y="33" width="36" height="3" rx="1" fill="#B85A17" />
      <circle cx="32" cy="27" r="3" fill="#0A1628" />
      <circle cx="32" cy="27" r="1.4" fill="#E87722" />
      <circle cx="27" cy="38" r="1.3" fill="#1B2A3D" />
      <circle cx="37" cy="38" r="1.3" fill="#1B2A3D" />
    </svg>
  );
}

function Pill({
  children,
  color,
  bg,
  border,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider"
      style={{ color, background: bg, border: `1px solid ${border}` }}
    >
      {children}
    </span>
  );
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 font-mono font-semibold text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors duration-150"
      style={{
        background: T.bgElevated,
        border: `1px solid ${T.border}`,
        color: T.text,
      }}
    >
      {text}
      {copied ? (
        <Check size={10} className="text-green-400" />
      ) : (
        <Copy size={10} style={{ color: T.textDim }} />
      )}
    </button>
  );
}

// ── Priority helpers ───────────────────────────────────────

const priorityConfig: Record<
  string,
  { color: string; bg: string; border: string; stripe: string; label: string; pulse: boolean }
> = {
  critical: {
    color: T.danger,
    bg: T.dangerBg,
    border: T.danger,
    stripe: T.danger,
    label: "CRITICAL",
    pulse: true,
  },
  urgent: {
    color: T.warning,
    bg: T.warningBg,
    border: T.warning,
    stripe: T.warning,
    label: "URGENT",
    pulse: false,
  },
  normal: {
    color: T.info,
    bg: T.infoBg,
    border: T.info,
    stripe: T.info,
    label: "NORMAL",
    pulse: false,
  },
  low: {
    color: T.textDim,
    bg: "rgba(95,115,145,0.1)",
    border: T.textDim,
    stripe: T.textDim,
    label: "LOW",
    pulse: false,
  },
};

const sourceConfig: Record<
  string,
  { icon: React.ReactNode; label: string; color: string; bg: string; border: string }
> = {
  service: {
    icon: <Wrench size={11} />,
    label: "Service",
    color: T.purple,
    bg: T.purpleBg,
    border: T.purple,
  },
  customer_phone: {
    icon: <Phone size={11} />,
    label: "Phone",
    color: T.warning,
    bg: T.warningBg,
    border: T.warning,
  },
  customer_walkin: {
    icon: <User size={11} />,
    label: "Walk-in",
    color: T.success,
    bg: T.successBg,
    border: T.success,
  },
  sales: {
    icon: <User size={11} />,
    label: "Sales",
    color: T.info,
    bg: T.infoBg,
    border: T.info,
  },
  internal: {
    icon: <Box size={11} />,
    label: "Internal",
    color: T.textMuted,
    bg: "rgba(138,155,180,0.1)",
    border: T.textMuted,
  },
};

// ── Stat Card ──────────────────────────────────────────────

function StatCard({
  icon,
  iconBg,
  value,
  label,
}: {
  icon: React.ReactNode;
  iconBg: string;
  value: string | number;
  label: string;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 min-w-0"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <div
        className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[18px] font-extrabold leading-tight" style={{ color: T.text }}>
          {value}
        </div>
        <div
          className="text-[10px] uppercase tracking-wider font-semibold leading-tight"
          style={{ color: T.textMuted }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

// ── Item status pill ───────────────────────────────────────

function ItemStatusPill({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    pulled: { color: T.success, bg: T.successBg, label: "PULLED" },
    locating: { color: T.purple, bg: T.purpleBg, label: "LOCATING" },
    pending: { color: T.textMuted, bg: "rgba(138,155,180,0.1)", label: "PENDING" },
    backordered: { color: T.danger, bg: T.dangerBg, label: "BACKORDERED" },
  };
  const c = map[status] || map.pending;
  return (
    <span
      className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded-full"
      style={{ color: c.color, background: c.bg }}
    >
      {c.label}
    </span>
  );
}

// ── Filter Tabs ────────────────────────────────────────────

type FilterKey = "all" | "mine" | "unassigned" | "service" | "customer" | "stalled";

// ── Queue Page ─────────────────────────────────────────────

export function QueuePage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const queryClient = useQueryClient();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  const {
    data: queue = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["parts-queue"],
    queryFn: fetchPartsQueue,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Supabase Realtime subscription for live queue updates
  useEffect(() => {
    const channel = supabase
      .channel("parts-queue-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "parts_requests",
        },
        () => {
          refetch();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  // Filter queue items
  const filtered = useMemo(() => {
    return queue.filter((item) => {
      switch (filter) {
        case "service":
          return item.request_source === "service";
        case "customer":
          return (
            item.request_source === "customer_phone" ||
            item.request_source === "customer_walkin"
          );
        case "unassigned":
          return !item.assigned_to;
        case "mine":
          return item.assigned_to === currentUserId;
        case "stalled":
          return isStalled(item);
        default:
          return true;
      }
    });
  }, [queue, filter, currentUserId]);

  const filterTabs: Array<{ key: FilterKey; label: string; count: number }> = useMemo(
    () => [
      { key: "all", label: "All", count: queue.length },
      {
        key: "mine",
        label: "Mine",
        count: queue.filter((q) => q.assigned_to === currentUserId).length,
      },
      {
        key: "unassigned",
        label: "Unassigned",
        count: queue.filter((q) => !q.assigned_to).length,
      },
      {
        key: "service",
        label: "Service",
        count: queue.filter((q) => q.request_source === "service").length,
      },
      {
        key: "customer",
        label: "Customer",
        count: queue.filter(
          (q) => q.request_source === "customer_phone" || q.request_source === "customer_walkin",
        ).length,
      },
      {
        key: "stalled",
        label: "Stalled",
        count: queue.filter((q) => isStalled(q)).length,
      },
    ],
    [queue, currentUserId],
  );

  // ── Stats ──────────────────────────────────────────────────
  const openCount = queue.length;
  const criticalCount = queue.filter((q) => q.priority === "critical").length;
  const avgFulfill = useMemo(() => {
    if (queue.length === 0) return 0;
    return Math.round(queue.reduce((s, q) => s + q.age_minutes, 0) / queue.length);
  }, [queue]);
  const oldestMinutes = queue.length > 0 ? Math.max(...queue.map((q) => q.age_minutes)) : 0;
  const openValue = useMemo(() => {
    return queue.reduce((sum, q) => {
      const itemTotal = (q.items || []).reduce((s, it) => s + it.quantity * 100, 0);
      return sum + itemTotal;
    }, 0);
  }, [queue]);

  // ── Iron AI tips (simple heuristic per card) ───────────────

  function getIronTip(item: QueueItem): string | null {
    if (item.priority === "critical" && item.age_minutes > (SLA.critical ?? 30)) {
      return `This critical request is ${formatAge(item.age_minutes)} old and past SLA. Consider pulling parts immediately or escalating to a lead.`;
    }
    if (isStalled(item)) {
      return `This request has been stalled for ${formatAge(item.age_minutes)}. Check with the assignee or reassign to keep the customer moving.`;
    }
    if (
      (item.items || []).some((it) => it.status === "backordered")
    ) {
      return "One or more items are backordered. Check cross-references or alternate suppliers to avoid customer delays.";
    }
    if (!item.assigned_to) {
      return "Unassigned request. Claim it now to keep queue velocity high.";
    }
    return null;
  }

  // ── Next status helper ─────────────────────────────────────

  function getNextStatus(
    current: string,
  ): { status: string; label: string } | null {
    const flow: Record<string, { status: string; label: string }> = {
      requested: { status: "acknowledged", label: "Acknowledge" },
      acknowledged: { status: "locating", label: "Find Part" },
      locating: { status: "pulled", label: "Mark Pulled" },
      pulled: { status: "ready", label: "Ready" },
    };
    return flow[current] ?? null;
  }

  // ── Loading State ──────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: T.bg }}>
        <div
          className="w-10 h-10 rounded-full animate-spin"
          style={{
            border: `3px solid ${T.border}`,
            borderTopColor: T.orange,
          }}
        />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: T.bg }}>
      {/* ── Hero Section ────────────────────────────────────── */}
      <div
        className="flex-shrink-0"
        style={{
          background: `linear-gradient(180deg, ${T.orangeGlow} 0%, transparent 100%)`,
        }}
      >
        {/* Title row */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-xl"
            style={{ background: T.orangeGlow }}
          >
            <Layers size={18} style={{ color: T.orange }} />
          </div>
          <h1
            className="text-[22px] font-extrabold leading-none"
            style={{ color: T.text }}
          >
            Parts Queue
          </h1>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold tracking-widest"
            style={{
              background: T.orangeGlow,
              color: T.orange,
              border: `1px solid ${T.orangeDeep}`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: T.orange }}
            />
            LIVE
          </span>
        </div>

        {/* Stat cards grid */}
        <div className="grid grid-cols-5 gap-2 px-5 pb-4">
          <StatCard
            icon={<Package size={14} style={{ color: T.orange }} />}
            iconBg={T.orangeGlow}
            value={openCount}
            label="Open"
          />
          <StatCard
            icon={<AlertTriangle size={14} style={{ color: T.danger }} />}
            iconBg={T.dangerBg}
            value={criticalCount}
            label="Critical"
          />
          <StatCard
            icon={<Timer size={14} style={{ color: T.info }} />}
            iconBg={T.infoBg}
            value={avgFulfill > 0 ? formatAge(avgFulfill) : "--"}
            label="Avg Fulfill"
          />
          <StatCard
            icon={<Clock size={14} style={{ color: T.warning }} />}
            iconBg={T.warningBg}
            value={oldestMinutes > 0 ? formatAge(oldestMinutes) : "--"}
            label="Oldest"
          />
          <StatCard
            icon={<TrendingUp size={14} style={{ color: T.success }} />}
            iconBg={T.successBg}
            value={openValue > 0 ? formatCurrency(openValue) : "--"}
            label="Open Value"
          />
        </div>
      </div>

      {/* ── Filter Tabs ─────────────────────────────────────── */}
      <div
        className="flex gap-1.5 flex-shrink-0 overflow-x-auto px-5 py-3"
        style={{ borderBottom: `1px solid ${T.border}` }}
      >
        {filterTabs.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold tracking-wide cursor-pointer transition-all duration-150 whitespace-nowrap"
              style={{
                background: active ? T.orangeGlow : "transparent",
                border: `1px solid ${active ? T.orange : T.border}`,
                color: active ? T.orange : T.textMuted,
              }}
            >
              {f.label}
              <span
                className="text-[10px] font-extrabold px-1.5 py-px rounded-full min-w-[18px] text-center"
                style={{
                  background: active ? T.orange : T.border,
                  color: active ? "#fff" : T.textDim,
                }}
              >
                {f.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Queue Cards ─────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-3">
        {error && (
          <div
            className="p-4 rounded-xl text-sm"
            style={{
              background: T.dangerBg,
              border: `1px solid ${T.danger}`,
              color: T.danger,
            }}
          >
            Failed to load queue. {(error as Error).message}
          </div>
        )}

        {filtered.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20">
            <CheckCircle2 size={44} style={{ color: T.success }} className="mb-3" />
            <p className="text-sm font-bold" style={{ color: T.text }}>
              Queue is clear
            </p>
            <p className="text-xs mt-1" style={{ color: T.textMuted }}>
              No open requests right now.
            </p>
          </div>
        )}

        {filtered.map((item) => {
          const pc = priorityConfig[item.priority] || priorityConfig.normal;
          const sc = sourceConfig[item.request_source] || sourceConfig.internal;
          const stalled = isStalled(item);
          const ironTip = getIronTip(item);
          const next = getNextStatus(item.status);
          const isCritical = item.priority === "critical";
          const itemValue = (item.items || []).reduce((s, it) => s + it.quantity * 100, 0);

          return (
            <div
              key={item.id}
              className="rounded-xl cursor-pointer transition-all duration-150 group"
              style={{
                background: T.card,
                border: `1px solid ${isCritical ? T.danger : T.border}`,
                borderLeft: `4px solid ${pc.stripe}`,
                boxShadow: isCritical
                  ? `0 0 12px ${T.dangerBg}, inset 0 0 0 1px ${T.dangerBg}`
                  : "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = T.cardHover;
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = T.card;
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              {/* ── Top row: pills + age ─────────────────────── */}
              <div className="flex items-center gap-1.5 flex-wrap px-4 pt-3 pb-2">
                <Pill color={pc.color} bg={pc.bg} border={pc.border}>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${pc.pulse ? "animate-pulse" : ""}`}
                    style={{ background: pc.color }}
                  />
                  {pc.label}
                </Pill>

                <Pill color={sc.color} bg={sc.bg} border={sc.border}>
                  {sc.icon} {sc.label}
                </Pill>

                {item.bay_number && (
                  <Pill color={T.purple} bg={T.purpleBg} border={T.purple}>
                    {item.bay_number}
                  </Pill>
                )}

                {stalled && (
                  <Pill color={T.danger} bg={T.dangerBg} border={T.danger}>
                    STALLED
                  </Pill>
                )}

                {item.auto_escalated && (
                  <Pill color={T.warning} bg={T.warningBg} border={T.warning}>
                    AUTO-ESC
                  </Pill>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <Clock
                    size={12}
                    style={{
                      color:
                        item.age_minutes > 120
                          ? T.danger
                          : item.age_minutes > 60
                            ? T.warning
                            : T.textDim,
                    }}
                  />
                  <span
                    className="text-[13px] font-bold"
                    style={{
                      color:
                        item.age_minutes > 120
                          ? T.danger
                          : item.age_minutes > 60
                            ? T.warning
                            : T.textMuted,
                    }}
                  >
                    {formatAge(item.age_minutes)}
                  </span>
                </div>
              </div>

              {/* ── Customer + Machine + Value row ───────────── */}
              <div className="flex items-baseline justify-between px-4 pb-1">
                <div className="min-w-0">
                  <span className="text-[15px] font-bold" style={{ color: T.text }}>
                    {item.customer_name || item.requester_name || "Unknown"}
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Truck size={11} style={{ color: T.textDim }} />
                    <span className="text-[12px]" style={{ color: T.textMuted }}>
                      {item.machine_description ||
                        (item.machine_manufacturer
                          ? `${item.machine_manufacturer} ${item.machine_model}`
                          : "No machine specified")}
                    </span>
                  </div>
                </div>
                {itemValue > 0 && (
                  <div className="text-right flex-shrink-0 ml-3">
                    <div
                      className="text-[15px] font-bold font-mono"
                      style={{ color: T.success }}
                    >
                      {formatCurrency(itemValue)}
                    </div>
                    <div
                      className="text-[10px] uppercase tracking-wider"
                      style={{ color: T.textDim }}
                    >
                      Ticket Value
                    </div>
                  </div>
                )}
              </div>

              {/* ── Items list ───────────────────────────────── */}
              {(item.items || []).length > 0 && (
                <div className="flex flex-col gap-1 px-4 py-2">
                  {(item.items || []).map((it, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs"
                      style={{
                        background: T.bg,
                        border: `1px solid ${T.borderSoft}`,
                      }}
                    >
                      <Copyable text={it.part_number} />
                      <span className="truncate" style={{ color: T.textMuted }}>
                        {it.description || "--"}
                      </span>
                      <span className="ml-auto flex-shrink-0 font-semibold" style={{ color: T.textMuted }}>
                        x{it.quantity}
                      </span>
                      <ItemStatusPill status={it.status} />
                    </div>
                  ))}
                </div>
              )}

              {/* ── Notes ────────────────────────────────────── */}
              {item.notes && (
                <div
                  className="mx-4 mb-2 px-3 py-2 rounded-lg text-xs italic"
                  style={{
                    background: T.warningBg,
                    border: `1px solid ${T.warning}`,
                    color: T.warning,
                  }}
                >
                  &ldquo;{item.notes}&rdquo;
                </div>
              )}

              {/* ── Iron AI Tip ──────────────────────────────── */}
              {ironTip && (
                <div
                  className="mx-4 mb-2 flex items-start gap-2.5 px-3 py-2.5 rounded-lg"
                  style={{
                    background: T.orangeGlow,
                    border: `1px solid ${T.orangeDeep}`,
                  }}
                >
                  <IronAvatarMini size={28} />
                  <div className="text-[12px] leading-relaxed min-w-0">
                    <span className="font-bold" style={{ color: T.orange }}>
                      Iron:{" "}
                    </span>
                    <span style={{ color: T.text }}>{ironTip}</span>
                  </div>
                </div>
              )}

              {/* ── Action Footer ────────────────────────────── */}
              <div
                className="flex items-center gap-2 px-4 py-3"
                style={{ borderTop: `1px solid ${T.borderSoft}` }}
              >
                {/* Find Part button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Navigate to search or open search panel - placeholder
                  }}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors duration-150"
                  style={{
                    background: "transparent",
                    border: `1px solid ${T.border}`,
                    color: T.textMuted,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = T.bgElevated;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    <Search size={12} /> Find Part
                  </span>
                </button>

                {/* Assign button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    assignRequest(item.id).then(() =>
                      queryClient.invalidateQueries({ queryKey: ["parts-queue"] }),
                    );
                  }}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors duration-150"
                  style={{
                    background: "transparent",
                    border: `1px solid ${T.border}`,
                    color: T.textMuted,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = T.bgElevated;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  Assign
                </button>

                {/* Primary action */}
                {next && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateRequestStatus(item.id, next.status).then(() =>
                        queryClient.invalidateQueries({ queryKey: ["parts-queue"] }),
                      );
                    }}
                    className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer transition-all duration-150"
                    style={{
                      background: T.orange,
                      border: "none",
                      color: "#fff",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#D06A1E";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = T.orange;
                    }}
                  >
                    {next.label}
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
