/**
 * ExpiringIncentivesStrip — top-of-page ribbon that surfaces
 * manufacturer incentives expiring within the next 24 hours. Renders
 * only when expiringIncentives is non-empty so it stays out of the
 * way the rest of the time.
 *
 * Source: useIronManagerData.expiringIncentives — already fetched but
 * unused on the manager home today.
 */
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useIronManagerData } from "@/features/dashboards/hooks/useDashboardData";

interface IncentiveRow {
  id: string;
  manufacturer: string | null;
  program_name: string | null;
  expiration_date: string | null;
  discount_type: string | null;
  discount_value: number | null;
}

function dateShort(iso: string | null): string {
  if (!iso) return "today";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ExpiringIncentivesStrip() {
  const { data } = useIronManagerData();
  const incentives = (data?.expiringIncentives ?? []) as IncentiveRow[];

  if (incentives.length === 0) return null;

  const lead = incentives[0];
  const overflow = incentives.length - 1;
  const leadLabel = [lead.manufacturer, lead.program_name].filter(Boolean).join(" · ");

  return (
    <Link
      to="/admin/incentives"
      className="group flex items-center justify-between gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-amber-100 transition-colors hover:border-amber-400/55 hover:bg-amber-500/15"
      aria-label="Expiring manufacturer incentives"
    >
      <span className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-300">
          Incentive expiring
        </span>
        <span className="hidden text-xs font-semibold sm:inline">
          {leadLabel || "Manufacturer program"}
        </span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-amber-200/80">
          · ends {dateShort(lead.expiration_date)}
        </span>
        {overflow > 0 ? (
          <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]">
            +{overflow} more
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200">
        Review
        <ArrowRight
          className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}
