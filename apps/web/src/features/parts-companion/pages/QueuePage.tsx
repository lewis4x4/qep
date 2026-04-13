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
} from "lucide-react";
import { fetchPartsQueue, assignRequest, updateRequestStatus } from "../lib/companion-api";
import type { QueueItem, RequestPriority, RequestSource } from "../lib/types";
import { supabase } from "../../../lib/supabase";

// ── Badge Components ────────────────────────────────────────

function PriorityBadge({ priority }: { priority: RequestPriority }) {
  const config: Record<
    string,
    { bg: string; text: string; border: string; label: string; pulse: boolean }
  > = {
    critical: {
      bg: "#FEE2E2",
      text: "#991B1B",
      border: "#FCA5A5",
      label: "CRITICAL",
      pulse: true,
    },
    urgent: {
      bg: "#FEF3C7",
      text: "#92400E",
      border: "#FCD34D",
      label: "URGENT",
      pulse: false,
    },
    normal: {
      bg: "#DBEAFE",
      text: "#1E40AF",
      border: "#93C5FD",
      label: "NORMAL",
      pulse: false,
    },
    low: {
      bg: "#F3F4F6",
      text: "#6B7280",
      border: "#D1D5DB",
      label: "LOW",
      pulse: false,
    },
  };
  const c = config[priority] || config.normal;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tracking-wider"
      style={{
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
      }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${c.pulse ? "animate-pulse" : ""}`}
        style={{ background: c.text }}
      />
      {c.label}
    </span>
  );
}

function SourceBadge({ source }: { source: RequestSource }) {
  const config: Record<string, { icon: React.ReactNode; label: string; bg: string; text: string }> = {
    service: { icon: <Wrench size={12} />, label: "Service", bg: "#EDE9FE", text: "#5B21B6" },
    customer_phone: { icon: <Phone size={12} />, label: "Phone", bg: "#FEF3C7", text: "#92400E" },
    customer_walkin: { icon: <User size={12} />, label: "Walk-in", bg: "#D1FAE5", text: "#065F46" },
    sales: { icon: <User size={12} />, label: "Sales", bg: "#DBEAFE", text: "#1E40AF" },
    internal: { icon: <Box size={12} />, label: "Internal", bg: "#F3F4F6", text: "#6B7280" },
  };
  const c = config[source] || config.internal;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ background: c.bg, color: c.text }}
    >
      {c.icon} {c.label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    requested: { bg: "#FEF3C7", text: "#92400E", label: "Requested" },
    acknowledged: { bg: "#DBEAFE", text: "#1E40AF", label: "Acknowledged" },
    locating: { bg: "#EDE9FE", text: "#5B21B6", label: "Locating" },
    pulled: { bg: "#D1FAE5", text: "#065F46", label: "Pulled" },
    ready: { bg: "#BBF7D0", text: "#14532D", label: "Ready" },
    fulfilled: { bg: "#F3F4F6", text: "#6B7280", label: "Fulfilled" },
    backordered: { bg: "#FEE2E2", text: "#991B1B", label: "Backordered" },
  };
  const c = config[status] || config.requested;
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: c.bg, color: c.text }}
    >
      {c.label}
    </span>
  );
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Filter Tabs ─────────────────────────────────────────────

type FilterKey = "all" | "mine" | "unassigned" | "service" | "customer";

// ── Queue Page ──────────────────────────────────────────────

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
    refetchInterval: 60_000, // Fallback polling if realtime disconnects
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
          // Refetch on any change to parts_requests
          refetch();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  // Filter queue items
  const filtered = queue.filter((item) => {
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
      default:
        return true;
    }
  });

  const filterTabs: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: "All", count: queue.length },
    { key: "mine", label: "Mine", count: queue.filter((q) => q.assigned_to === currentUserId).length },
    { key: "unassigned", label: "Unassigned", count: queue.filter((q) => !q.assigned_to).length },
    { key: "service", label: "Service", count: queue.filter((q) => q.request_source === "service").length },
    {
      key: "customer",
      label: "Customer",
      count: queue.filter(
        (q) => q.request_source === "customer_phone" || q.request_source === "customer_walkin",
      ).length,
    },
  ];

  // Stats
  const openCount = queue.length;
  const oldestMinutes = queue.length > 0 ? Math.max(...queue.map((q) => q.age_minutes)) : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats bar */}
      <div
        className="flex items-center gap-6 flex-shrink-0 bg-white"
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-qep-orange" />
          <span className="text-sm font-bold text-[#2D3748]">Parts Queue</span>
        </div>
        <div className="flex gap-5 ml-auto">
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-qep-orange">{openCount}</span>
            <span className="text-[11px] text-[#718096] uppercase tracking-wider">Open</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-[#E53E3E]">
              {oldestMinutes > 0 ? formatAge(oldestMinutes) : "—"}
            </span>
            <span className="text-[11px] text-[#718096] uppercase tracking-wider">Oldest</span>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div
        className="flex gap-1 flex-shrink-0 bg-white"
        style={{
          padding: "8px 24px",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        {filterTabs.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-3.5 py-1.5 rounded-md border-none text-[13px] font-semibold cursor-pointer transition-all duration-150"
            style={{
              background: filter === f.key ? "#FFF3E8" : "transparent",
              color: filter === f.key ? "#E87722" : "#4A5568",
            }}
          >
            {f.label}
            <span
              className="ml-1 text-[11px] font-bold px-1.5 py-px rounded-lg"
              style={{
                background: filter === f.key ? "#E87722" : "#E2E8F0",
                color: filter === f.key ? "white" : "#718096",
              }}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-2">
        {error && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            Failed to load queue. {(error as Error).message}
          </div>
        )}

        {filtered.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-[#718096]">
            <CheckCircle2 size={40} className="mb-3 text-green-400" />
            <p className="text-sm font-semibold">Queue is clear</p>
            <p className="text-xs mt-1">No open requests right now.</p>
          </div>
        )}

        {filtered.map((item) => (
          <div
            key={item.id}
            className="bg-white rounded-xl cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-px"
            style={{
              border: `1px solid ${item.priority === "critical" ? "#FCA5A5" : "#E2E8F0"}`,
              borderLeft: `4px solid ${
                item.priority === "critical"
                  ? "#DC2626"
                  : item.priority === "urgent"
                    ? "#F59E0B"
                    : item.priority === "normal"
                      ? "#3182CE"
                      : "#D1D5DB"
              }`,
              padding: 16,
              boxShadow:
                item.priority === "critical"
                  ? "0 0 0 1px rgba(232,119,34,0.1), 0 2px 8px rgba(232,119,34,0.08)"
                  : "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            {/* Header row */}
            <div className="flex items-center gap-2 mb-2">
              <PriorityBadge priority={item.priority} />
              <SourceBadge source={item.request_source} />
              {item.bay_number && (
                <span className="text-xs font-semibold text-[#4A5568] bg-[#F3F4F6] px-2 py-0.5 rounded">
                  {item.bay_number}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Clock
                  size={12}
                  className={
                    item.age_minutes > 120
                      ? "text-[#DC2626]"
                      : item.age_minutes > 60
                        ? "text-[#F59E0B]"
                        : "text-[#718096]"
                  }
                />
                <span
                  className="text-[13px] font-bold"
                  style={{
                    color:
                      item.age_minutes > 120
                        ? "#DC2626"
                        : item.age_minutes > 60
                          ? "#F59E0B"
                          : "#718096",
                  }}
                >
                  {formatAge(item.age_minutes)}
                </span>
              </div>
            </div>

            {/* Machine */}
            <div className="mb-1">
              <span className="text-[15px] font-bold text-[#2D3748]">
                {item.machine_description ||
                  (item.machine_manufacturer
                    ? `${item.machine_manufacturer} ${item.machine_model}`
                    : "No machine specified")}
              </span>
            </div>

            {/* Requester */}
            <div className="text-[13px] text-[#4A5568] mb-1.5">
              {item.requester_name || "Unknown"}
            </div>

            {/* Items */}
            <div className="flex flex-wrap gap-1 mb-2">
              {(item.items || []).slice(0, 3).map((it, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded bg-[#F7F8FA] border border-[#E2E8F0] text-[#2D3748]"
                >
                  <span className="font-semibold font-mono">{it.part_number}</span>
                  <span className="text-[#718096]"> x{it.quantity}</span>
                </span>
              ))}
              {(item.items || []).length > 3 && (
                <span className="text-xs text-[#718096] px-2 py-0.5">
                  +{item.items.length - 3} more
                </span>
              )}
            </div>

            {/* Notes */}
            {item.notes && (
              <div className="text-xs text-[#4A5568] italic px-2.5 py-1.5 bg-[#FFFBEB] rounded-md border border-[#FEF3C7] mb-2">
                &ldquo;{item.notes}&rdquo;
              </div>
            )}

            {/* Auto-escalated warning */}
            {item.auto_escalated && (
              <div className="flex items-center gap-1 text-[11px] text-[#E53E3E] mb-2">
                <AlertTriangle size={12} />
                Auto-escalated{" "}
                {item.escalated_at
                  ? `at ${formatAge(
                      (Date.now() - new Date(item.escalated_at).getTime()) /
                        60000,
                    )} ago`
                  : ""}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <StatusPill status={item.status} />
              <div className="ml-auto flex gap-1.5">
                {item.status === "requested" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateRequestStatus(item.id, "acknowledged").then(() =>
                        queryClient.invalidateQueries({ queryKey: ["parts-queue"] }),
                      );
                    }}
                    className="px-3 py-1 rounded-md border border-[#E2E8F0] bg-white text-xs font-semibold text-[#2D3748] cursor-pointer hover:bg-[#F7F8FA]"
                  >
                    Acknowledge
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    assignRequest(item.id).then(() =>
                      queryClient.invalidateQueries({ queryKey: ["parts-queue"] }),
                    );
                  }}
                  className="px-3 py-1 rounded-md border border-qep-orange bg-[#FFF3E8] text-xs font-semibold text-qep-orange cursor-pointer hover:bg-[#FFE8D4]"
                >
                  Assign to Me
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
