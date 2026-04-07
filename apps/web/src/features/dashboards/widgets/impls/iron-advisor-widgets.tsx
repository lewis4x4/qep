/**
 * Iron Advisor widget impls — SLA brief, follow-up queue, prospecting counter.
 *
 * All read from useIronAdvisorData(userId), so they pull the user id off
 * useAuth() rather than requiring it as a prop. The follow-up queue widget
 * is the bulk of the IronAdvisorDashboard's old inline JSX, hoisted here so
 * the dashboard file becomes a thin shell wrapper.
 */
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { Widget } from "../Widget";
import { AdvisorMorningBriefingCard } from "../../components/AdvisorMorningBriefingCard";
import { ProspectingKpiCounter } from "../../../qrm/components/ProspectingKpiCounter";
import { useIronAdvisorData } from "../../hooks/useDashboardData";
import { calendarDaysFromToday, followUpDueBadge } from "../../lib/advisor-dates";
import { Sunrise, CalendarDays, Target } from "lucide-react";

function touchpointDealId(tp: {
  follow_up_cadences?: { deal_id?: string } | Array<{ deal_id?: string }> | null;
}): string | undefined {
  const c = tp.follow_up_cadences;
  if (!c) return undefined;
  if (Array.isArray(c)) return c[0]?.deal_id;
  return c.deal_id;
}

export function AdvisorBriefWidget() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data, isLoading, isError } = useIronAdvisorData(userId);
  const slaDeals = (data?.myDeals ?? []).filter(
    (d: any) => d.sla_deadline_at && new Date(d.sla_deadline_at) < new Date(),
  );
  return (
    <Widget
      title="SLA + new leads"
      description="Live exception view from your pipeline."
      icon={<Sunrise className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load SLA brief." : null}
    >
      <AdvisorMorningBriefingCard
        slaDeals={slaDeals.map((d: any) => ({
          id: d.id,
          name: d.name,
          sla_deadline_at: d.sla_deadline_at,
        }))}
        newLeads={(data?.newLeads ?? []).map((d: any) => ({
          id: d.id,
          name: d.name,
          created_at: d.created_at,
        }))}
      />
    </Widget>
  );
}

export function FollowUpQueueWidget() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { data, isLoading, isError } = useIronAdvisorData(userId);
  const todayStr = data?.todayStr ?? new Date().toISOString().split("T")[0];
  const touchpoints = data?.dueTouchpoints ?? [];

  return (
    <Widget
      title="Follow-up queue"
      description="Pending touchpoints today through 3 days out."
      icon={<CalendarDays className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load follow-ups." : null}
    >
      {touchpoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">No follow-ups in the current window.</p>
      ) : (
        <div className="space-y-2">
          {touchpoints.map((tp: any) => {
            const dealId = touchpointDealId(tp);
            const dayDelta = calendarDaysFromToday(tp.scheduled_date ?? todayStr);
            const due = followUpDueBadge(dayDelta);
            const toneClass =
              due.tone === "overdue"
                ? "bg-red-500/15 text-red-400"
                : due.tone === "today"
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-muted text-muted-foreground";
            const row = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {String(tp.touchpoint_type ?? "touchpoint").replace(/_/g, " ")}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${toneClass}`}>
                    {due.label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{tp.purpose}</p>
                {tp.suggested_message && (
                  <p className="mt-1 text-xs italic text-foreground/70">{tp.suggested_message}</p>
                )}
              </>
            );
            const shellClass =
              "block rounded-lg border border-border p-2.5 transition hover:border-foreground/20";
            return (
              <div key={tp.id}>
                {dealId ? (
                  <Link to={`/crm/deals/${dealId}`} className={shellClass}>
                    {row}
                  </Link>
                ) : (
                  <div className={shellClass}>{row}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

export function ProspectingCounterWidget() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  return (
    <Widget
      title="Prospecting target"
      description="Today's positive-visit progress."
      icon={<Target className="h-4 w-4" />}
    >
      {/* ProspectingKpiCounter renders its own Card chrome — wrap in a div so the
          widget shell still owns the outer header but doesn't double-card. */}
      <div className="-mt-3">
        <ProspectingKpiCounter userId={userId} />
      </div>
    </Widget>
  );
}
