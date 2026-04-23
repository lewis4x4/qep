import { Link } from "react-router-dom";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { Brain, Mic, Route, Building2, Timer, Map as MapIcon, AlertTriangle, Lock, DollarSign, Clock4, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIronRoleBlend } from "../lib/useIronRoleBlend";
import { resolveIronRoleAndBlend } from "../lib/iron-roles";
import { useCommandCenter } from "../command-center/hooks/useCommandCenter";
import { buildMobileFieldPriorityFeed } from "../lib/mobile-field-command";

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
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-orange">Field OS</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Mobile Field Command</h1>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {role?.info.display ?? "Field"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Fast field priorities, voice capture, and command links designed for road.
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
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      ) : commandQuery.isError || !commandQuery.data ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">Field command unavailable.</p>
        </DeckSurface>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Closable 7d</p>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                {formatCompactCurrency(commandQuery.data.commandStrip.closableRevenue7d)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Revenue from deals that could close in next 7 days.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-qep-warm" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">At Risk</p>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                {formatCompactCurrency(commandQuery.data.commandStrip.atRiskRevenue)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Revenue from deals flagged as high churn risk.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-qep-warm" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Blocked</p>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                {String(commandQuery.data.commandStrip.blockedDeals)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Deals waiting on blocker resolution before close.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Clock4 className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Follow-ups</p>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                {String(commandQuery.data.commandStrip.overdueFollowUps)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Deals with overdue next touch scheduled.</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Today&apos;s field priorities</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Rep-specific priorities for fast field closes and voice capture.
                </p>
              </div>
            </div>
          </DeckSurface>

          {priorities.length === 0 ? (
            <DeckSurface className="border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">No mobile-priority items right now.</p>
            </DeckSurface>
          ) : (
            <div className="space-y-3">
              {priorities.map((item) => {
                const laneClass = {
                  blockers: "border-red-500/30 text-red-400",
                  revenue_at_risk: "border-amber-500/30 text-amber-400",
                  revenue_ready: "border-emerald-500/30 text-emerald-400",
                  default: "border-border bg-card",
                }[item.lane] || "border-border bg-card";

                return (
                  <DeckSurface className="p-3">
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
                                  : "border-border bg-card"
                            }`}
                          >
                            {item.lane.replace(/_/g, " ")}
                          </Badge>
                          {item.stageName && (
                            <span className="text-xs text-muted-foreground ml-2">{item.stageName}</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-foreground">{item.headline}</p>
                      </div>
                      <div className="mt-2 flex flex-col gap-2 items-start">
                        {item.companyName && (
                          <p className="text-xs text-muted-foreground">{item.companyName}</p>
                        )}
                        {item.contactName && (
                          <p className="text-xs text-muted-foreground">{item.contactName}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {item.rationale[0]}
                        </p>
                        {item.amount !== null && (
                          <span className="text-sm font-semibold tracking-tight text-foreground">{formatCompactCurrency(item.amount)}</span>
                        )}
                      </div>
                      {item.primaryAction.href ? (
                        <Button asChild size="sm" className="h-8">
                          <Link to={item.primaryAction.href}>
                            {item.primaryAction.label} <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      ) : null}
                      {item.secondaryAction?.href ? (
                        <Button asChild size="sm" variant="outline" className="h-8">
                          <Link to={item.secondaryAction.href}>
                            {item.secondaryAction.label}
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </DeckSurface>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuickAction({ to, icon: Icon, label }: { to: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-[72px] flex-col justify-between rounded-xl border border-qep-deck-rule bg-qep-deck-elevated/40 px-4 py-3 transition hover:border-qep-orange/40 hover:bg-qep-orange/5"
    >
      <Icon className="h-5 w-5 text-qep-orange" aria-hidden />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </Link>
  );
}

function formatCompactCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}
