/**
 * DataSourceBadge — 24px pill badge for integration data source states.
 * Used across Admin Hub, Deal Intelligence, and Dashboard.
 * Per CDO design direction §2.
 */

import { cn } from "@/lib/utils";

export type DataSourceState = "Live" | "Demo" | "Manual" | "Error" | "Stale";

interface DataSourceBadgeProps {
  state: DataSourceState;
  className?: string;
}

const STATE_STYLES: Record<DataSourceState, string> = {
  Live: "bg-[#EFF6FF] text-[#1B2A3D] border-[#BFDBFE]",
  Demo: "bg-[#FFF7ED] text-[#B45309] border-[#FED7AA]",
  Manual: "bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]",
  Error: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
  Stale: "bg-[#FFFBEB] text-[#A16207] border-[#FDE68A]",
};

export function DataSourceBadge({ state, className }: DataSourceBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-6 px-2 rounded-full border text-xs font-medium whitespace-nowrap",
        STATE_STYLES[state],
        className
      )}
    >
      {state}
    </span>
  );
}
