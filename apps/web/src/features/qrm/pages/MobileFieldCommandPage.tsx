import { Link } from "react-router-dom";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Brain, Mic, Route, Building2, Timer, Map as MapIcon, AlertTriangle, Lock, DollarSign, Clock4 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIronRoleBlend } from "../lib/useIronRoleBlend";
import { resolveIronRoleAndBlend } from "../lib/iron-roles";
import { useCommandCenter } from "../command-center/hooks/useCommandCenter";
import { buildMobileFieldPriorityFeed } from "../lib/mobile-field-command";

function formatCompactCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

export function MobileFieldCommandPage() {
  const { profile } = useAuth();
  const blendQuery = useIronRoleBlend(profile?.id);
  const role = profile
    ? resolveIronRoleAndBlend(profile.role, blendQuery.blend, profile.iron_role)
    : null;
  const commandQuery = useCommandCenter("mine");

  const priorities = useMemo(
    () => (commandQuery.data ? buildMobileFieldPriorityFeed(commandQuery.data) : []),
    [commandQuery.data],
  );

  if (!profile) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-24 pt-3 sm:px-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-orange">Field OS</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mobile Field Command</h1>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {role?.info.display ?? "Field"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Fast field priorities, voice capture, and command links designed for the road.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <QuickAction to="/voice-qrm" icon={Mic} label="Voice note" />
        <QuickAction to="/qrm/visit-intelligence" icon={Brain} label="Visit brief" />
        <QuickAction to="/qrm/deals" icon={Route} label="My deals" />
        <QuickAction to="/qrm/companies" icon={Building2} label="Accounts" />
        <QuickAction to="/qrm/time-bank" icon={Timer} label="Time bank" />
        <QuickAction to="/fleet" icon={MapIcon} label="Fleet map" />
        <QuickAction to="/qrm" icon={Route} label="Full QRM" />
      </div>

      {commandQuery.isLoading ? (
        <Card className="p-4 text-sm text-muted-foreground">Loading field command…</Card>
      ) : commandQuery.isError || !commandQuery.data ? (
        <Card className="border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
          {commandQuery.error instanceof Error ? commandQuery.error.message : "Field command unavailable."}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={DollarSign} label="Closable 7d" value={formatCompactCurrency(commandQuery.data.commandStrip.closableRevenue7d)} />
            <MetricCard icon={AlertTriangle} label="At risk" value={formatCompactCurrency(commandQuery.data.commandStrip.atRiskRevenue)} tone="warn" />
            <MetricCard icon={Lock} label="Blocked" value={String(commandQuery.data.commandStrip.blockedDeals)} tone={commandQuery.data.commandStrip.blockedDeals > 0 ? "warn" : "default"} />
            <MetricCard icon={Clock4} label="Follow-ups" value={String(commandQuery.data.commandStrip.overdueFollowUps)} tone={commandQuery.data.commandStrip.overdueFollowUps > 0 ? "warn" : "default"} />
          </div>

          <Card className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Today&apos;s field priorities</p>
            <div className="mt-3 space-y-3">
              {priorities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No mobile-priority items right now.</p>
              ) : (
                priorities.map((item) => (
                  <div key={item.recommendationKey} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              item.lane === "blockers"
                                ? "border-red-500/30 text-red-400"
                                : item.lane === "revenue_at_risk"
                                ? "border-amber-500/30 text-amber-400"
                                : "border-emerald-500/30 text-emerald-400"
                            }`}
                          >
                            {item.lane.replace(/_/g, " ")}
                          </Badge>
                          {item.stageName && <span className="text-[10px] text-muted-foreground">{item.stageName}</span>}
                        </div>
                        <p className="mt-2 text-sm font-medium text-foreground">{item.headline}</p>
                        {(item.companyName || item.contactName) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[item.companyName, item.contactName].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {item.rationale[0] && (
                          <p className="mt-2 text-xs text-muted-foreground">{item.rationale[0]}</p>
                        )}
                      </div>
                      {item.amount !== null && (
                        <span className="text-sm font-semibold text-foreground">{formatCompactCurrency(item.amount)}</span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.primaryAction.href ? (
                        <Button asChild size="sm" className="h-8">
                          <Link to={item.primaryAction.href}>{item.primaryAction.label}</Link>
                        </Button>
                      ) : null}
                      {item.secondaryAction?.href ? (
                        <Button asChild size="sm" variant="outline" className="h-8">
                          <Link to={item.secondaryAction.href}>{item.secondaryAction.label}</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[72px] flex-col justify-between rounded-xl border border-border bg-card px-4 py-3 transition hover:border-qep-orange/40 hover:bg-qep-orange/5"
    >
      <Icon className="h-5 w-5 text-qep-orange" />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </Link>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}
