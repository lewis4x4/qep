import { Card } from "@/components/ui/card";
import { Activity, Briefcase, Wrench, Package, DollarSign } from "lucide-react";
import type { CustomerHealthProfile } from "../lib/nervous-system-api";

interface CustomerHealthScoreProps {
  profile: CustomerHealthProfile;
  compact?: boolean;
}

function scoreColor(score: number): { text: string; stroke: string; bg: string; label: string } {
  if (score >= 80) return { text: "text-emerald-400", stroke: "stroke-emerald-400", bg: "bg-emerald-500/10", label: "Excellent" };
  if (score >= 60) return { text: "text-blue-400", stroke: "stroke-blue-400", bg: "bg-blue-500/10", label: "Good" };
  if (score >= 40) return { text: "text-amber-400", stroke: "stroke-amber-400", bg: "bg-amber-500/10", label: "Fair" };
  return { text: "text-red-400", stroke: "stroke-red-400", bg: "bg-red-500/10", label: "At risk" };
}

export function CustomerHealthScore({ profile, compact = false }: CustomerHealthScoreProps) {
  const score = profile.health_score ?? 0;
  const color = scoreColor(score);
  const components = profile.health_score_components;

  // Radial gauge — circumference for a 40r circle
  const radius = compact ? 28 : 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <Card className={`p-4 ${compact ? "" : "space-y-3"}`}>
      <div className="flex items-center gap-4">
        {/* Radial gauge */}
        <div className="relative shrink-0" style={{ width: compact ? 72 : 96, height: compact ? 72 : 96 }}>
          <svg
            className="-rotate-90"
            width={compact ? 72 : 96}
            height={compact ? 72 : 96}
            viewBox={`0 0 ${compact ? 72 : 96} ${compact ? 72 : 96}`}
          >
            <circle
              cx={compact ? 36 : 48}
              cy={compact ? 36 : 48}
              r={radius}
              strokeWidth="6"
              fill="none"
              className="stroke-muted"
            />
            <circle
              cx={compact ? 36 : 48}
              cy={compact ? 36 : 48}
              r={radius}
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              className={color.stroke}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className={`font-bold leading-none ${color.text} ${compact ? "text-lg" : "text-2xl"}`}>
              {Math.round(score)}
            </p>
            {!compact && <p className="text-[9px] uppercase tracking-wider text-muted-foreground">health</p>}
          </div>
        </div>

        {/* Identity + rating label */}
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-bold uppercase tracking-wider ${color.text}`}>{color.label}</p>
          <h3 className="text-sm font-semibold text-foreground truncate">
            {profile.company_name ?? profile.customer_name}
          </h3>
          {profile.pricing_persona && (
            <p className="text-[10px] text-muted-foreground">
              {profile.pricing_persona.replace(/_/g, " ")}
            </p>
          )}
        </div>
      </div>

      {/* Component breakdown */}
      {!compact && components && (
        <div className="space-y-2 pt-2">
          <ComponentBar label="Deal velocity" value={components.deal_velocity} max={25} icon={Briefcase} color="text-emerald-400" />
          <ComponentBar label="Service engagement" value={components.service_engagement} max={25} icon={Wrench} color="text-cyan-400" />
          <ComponentBar label="Parts revenue" value={components.parts_revenue} max={25} icon={Package} color="text-amber-400" />
          <ComponentBar label="Financial health" value={components.financial_health} max={25} icon={DollarSign} color="text-violet-400" />
        </div>
      )}

      {/* Live signals (derived from real cross-dept data) */}
      {!compact && components?.signals && (
        <div className="mt-3 pt-3 border-t border-border/60">
          <p className="mb-1.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3 w-3" aria-hidden /> Live signals
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {components.signals.parts_spend_90d !== undefined && (
              <span>Parts 90d: <strong className="text-foreground">${Math.round(components.signals.parts_spend_90d).toLocaleString()}</strong></span>
            )}
            {components.signals.service_visits_90d !== undefined && (
              <span>Service 90d: <strong className="text-foreground">{components.signals.service_visits_90d}</strong></span>
            )}
            {components.signals.avg_days_to_pay !== null && components.signals.avg_days_to_pay !== undefined && (
              <span>Days to pay: <strong className="text-foreground">{Math.round(components.signals.avg_days_to_pay)}</strong></span>
            )}
            {components.signals.quote_close_ratio !== null && components.signals.quote_close_ratio !== undefined && (
              <span>Close rate: <strong className="text-foreground">{(components.signals.quote_close_ratio * 100).toFixed(0)}%</strong></span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function ComponentBar({
  label,
  value,
  max,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  max: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Icon className={`h-3 w-3 ${color}`} aria-hidden />
          {label}
        </span>
        <span className="text-foreground font-medium">{Math.round(value)}/{max}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color.replace("text-", "bg-")}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
