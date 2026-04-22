/**
 * DataSourceBadge — 24px pill badge for integration data source states.
 * Used across Admin Hub, Deal Intelligence, and Dashboard.
 * Per CDO design direction §2.
 */

import { cn } from "@/lib/utils";

export type DataSourceState = "Live" | "Demo" | "Manual" | "Error" | "Stale" | "Native";

interface DataSourceBadgeProps {
  state: DataSourceState;
  className?: string;
}

const STATE_STYLES: Record<DataSourceState, string> = {
  Live:
    "bg-blue-50 text-blue-950 border-blue-200 dark:bg-blue-950/45 dark:text-blue-100 dark:border-blue-800",
  Demo:
    "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800",
  Manual:
    "bg-muted text-muted-foreground border-border dark:bg-muted/80",
  Error:
    "bg-red-50 text-red-900 border-red-200 dark:bg-red-950/40 dark:text-red-100 dark:border-red-900",
  Stale:
    "bg-yellow-50 text-yellow-900 border-yellow-200 dark:bg-yellow-950/35 dark:text-yellow-100 dark:border-yellow-800",
  Native:
    "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-100 dark:border-emerald-800",
};

export function DataSourceBadge({ state, className }: DataSourceBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-5 px-2 rounded-full border text-[11px] font-medium uppercase tracking-wide whitespace-nowrap",
        STATE_STYLES[state],
        className
      )}
    >
      {state}
    </span>
  );
}
