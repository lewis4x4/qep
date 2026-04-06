import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import type { ReactNode } from "react";

export interface ForecastCounter {
  label: string;
  value: number | string;
  href?: string;
  icon?: ReactNode;
  tone?: "blue" | "orange" | "red" | "green" | "violet" | "neutral";
}

interface ForwardForecastBarProps {
  counters: ForecastCounter[];
  className?: string;
}

const TONE: Record<NonNullable<ForecastCounter["tone"]>, string> = {
  blue:    "text-blue-400",
  orange:  "text-qep-orange",
  red:     "text-red-400",
  green:   "text-emerald-400",
  violet:  "text-violet-400",
  neutral: "text-muted-foreground",
};

/**
 * Top-of-dashboard strip with N counters: "92 service intervals due / 14
 * customers in budget cycle / 7 deals at SLA risk / $340K of quotes
 * expiring / 23 trade-up windows opening". Each counter is click-through
 * to a filtered list when href is provided.
 */
export function ForwardForecastBar({ counters, className = "" }: ForwardForecastBarProps) {
  return (
    <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-${Math.min(counters.length, 5)} ${className}`}>
      {counters.map((c, i) => {
        const inner = (
          <Card className="p-3 hover:border-foreground/20 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                  {c.label}
                </p>
                <p className={`mt-1 text-lg font-bold tabular-nums ${TONE[c.tone ?? "neutral"]}`}>
                  {c.value}
                </p>
              </div>
              {c.icon && <div className={`shrink-0 ${TONE[c.tone ?? "neutral"]}`}>{c.icon}</div>}
            </div>
          </Card>
        );
        return c.href ? (
          <Link key={i} to={c.href}>{inner}</Link>
        ) : (
          <div key={i}>{inner}</div>
        );
      })}
    </div>
  );
}
