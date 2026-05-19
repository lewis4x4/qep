import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTodayFeed } from "../hooks/useTodayFeed";
import { useRepStreaks } from "../hooks/useRepStreaks";
import { useAuth } from "@/hooks/useAuth";
import { EveningBriefingHero } from "../components/EveningBriefingHero";
import { SalesNarrativeBlock } from "../components/SalesNarrativeBlock";
import { SalesActionsBlock } from "../components/SalesActionsBlock";
import { SalesQuickTools } from "../components/SalesQuickTools";
import { TomorrowFirstMove } from "../components/TomorrowFirstMove";
import { LiveSignalsStrip } from "../components/LiveSignalsStrip";
import { StreakBadge } from "../components/StreakBadge";
import { TodayFeedSkeleton } from "../components/TodayFeedSkeleton";
import { PrepCard } from "../components/PrepCard";
import { ActionItemCard } from "../components/ActionItemCard";
import { LogVisitFlow } from "../components/LogVisitFlow";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Flame, Calendar, Plus, ClipboardCheck, ChevronRight, Clock } from "lucide-react";
import { formatRepFirstName } from "../lib/format-rep-name";
import type {
  ManagerPendingApproval,
  RepStuckApproval,
} from "../lib/types";

function formatCurrencyCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

interface BriefingCopy {
  headline: string | null;
  followup: string | null;
  assistantStatus: string;
}

function buildBriefingCopy(args: {
  timeOfDay: "morning" | "afternoon" | "evening";
  pipelineCount: number;
  pipelineValue: number;
  warmCount: number;
  coolingCount: number;
  closingSoonCount: number;
  quotesThisWeek: number;
}): BriefingCopy {
  const {
    timeOfDay,
    pipelineCount,
    pipelineValue,
    warmCount,
    coolingCount,
    closingSoonCount,
    quotesThisWeek,
  } = args;

  if (pipelineCount === 0) {
    return {
      headline:
        "Your book is quiet. Drop your first visit and the briefing sharpens overnight.",
      followup: null,
      assistantStatus: "Ready",
    };
  }

  const pipelineLine = `${formatCurrencyCompact(pipelineValue)} across ${pipelineCount} ${pipelineCount === 1 ? "deal" : "deals"}`;
  const followupBits: string[] = [];
  if (closingSoonCount > 0) {
    followupBits.push(`${closingSoonCount} closing this week`);
  }
  if (coolingCount > 0) {
    followupBits.push(`${coolingCount} cooling`);
  }
  if (followupBits.length === 0 && warmCount > 0) {
    followupBits.push(`${warmCount} warm and engaged`);
  }
  if (followupBits.length === 0 && quotesThisWeek > 0) {
    followupBits.push(`${quotesThisWeek} quotes sent this week`);
  }
  const followup = followupBits.length > 0 ? followupBits.join(" · ") : null;

  if (timeOfDay === "evening") {
    return {
      headline: `Today's book: ${pipelineLine}.`,
      followup: followup ? `Tomorrow: ${followup}.` : "Tomorrow's prep is ready.",
      assistantStatus: "Briefing tomorrow",
    };
  }

  if (timeOfDay === "morning") {
    return {
      headline: `${pipelineLine} ready to move.`,
      followup,
      assistantStatus: "Scoring deals",
    };
  }

  return {
    headline: `${pipelineLine} in motion right now.`,
    followup,
    assistantStatus: "Watching signals",
  };
}

export function TodayFeedPage() {
  const {
    briefing,
    liveStats,
    livePriorityActions,
    pipeline,
    timeOfDay,
    isLoading,
  } = useTodayFeed();
  const streaks = useRepStreaks();
  const { profile } = useAuth();
  const [logVisitOpen, setLogVisitOpen] = useState(false);

  const firstName = useMemo(
    () =>
      formatRepFirstName({
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
      }),
    [profile?.full_name, profile?.email],
  );

  if (isLoading) {
    return <TodayFeedSkeleton />;
  }

  const dealMap = new Map(pipeline.map((d) => [d.deal_id, d]));

  const allPriorities = [
    ...(briefing?.priority_actions ?? []),
    ...livePriorityActions,
  ];
  const seen = new Set<string>();
  const priorities = allPriorities.filter((p) => {
    if (!p.deal_id) return true;
    if (seen.has(p.deal_id)) return false;
    seen.add(p.deal_id);
    return true;
  });

  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const closingSoonCount = pipeline.filter(
    (d) =>
      d.expected_close_on &&
      new Date(d.expected_close_on).getTime() - now < week,
  ).length;
  const warmCount = pipeline.filter((d) => d.heat_status === "warm").length;
  const coolingCount = pipeline.filter(
    (d) => d.heat_status === "cooling" || d.heat_status === "cold",
  ).length;

  const briefingCopy = buildBriefingCopy({
    timeOfDay,
    pipelineCount: pipeline.length,
    pipelineValue: liveStats.total_pipeline_value,
    warmCount,
    coolingCount,
    closingSoonCount,
    quotesThisWeek: liveStats.quotes_sent_this_week,
  });

  const handleVoiceDictate = () => setLogVisitOpen(true);

  return (
    <div className="px-4 py-4 space-y-4 max-w-lg mx-auto pb-8">
      <div className="flex items-center justify-between px-4 py-3 sm:hidden">
        <h1 className="text-xl font-bold text-foreground">Today</h1>
        <button
          type="button"
          aria-label="Log a visit"
          data-capture-trigger
          onClick={() => setLogVisitOpen(true)}
          className="w-10 h-10 rounded-full bg-qep-orange text-white flex items-center justify-center active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <Sheet open={logVisitOpen} onOpenChange={setLogVisitOpen}>
        <SheetContent side="bottom">
          <LogVisitFlow onComplete={() => setLogVisitOpen(false)} />
        </SheetContent>
      </Sheet>

      <EveningBriefingHero
        firstName={firstName}
        timeOfDay={timeOfDay}
        headline={briefingCopy.headline}
        followup={briefingCopy.followup}
        assistantStatus={briefingCopy.assistantStatus}
        onVoicePress={handleVoiceDictate}
        collapsible
        storageKey="today-hero"
      />

      <SalesNarrativeBlock firstName={firstName} />

      {pipeline.length > 0 && (
        <LiveSignalsStrip
          pipeline={pipeline}
          expiringQuoteCount={briefing?.expiring_quotes?.length ?? 0}
        />
      )}

      {(pipeline.length > 0 || streaks.currentStreak > 0 || streaks.longestStreak > 0) && (
        <StreakBadge
          currentStreak={streaks.currentStreak}
          longestStreak={streaks.longestStreak}
          lastActiveAt={streaks.lastActiveAt}
          isLoading={streaks.isLoading}
        />
      )}

      <SalesActionsBlock
        pipeline={pipeline}
        liveStats={liveStats}
        onVoiceQuote={handleVoiceDictate}
      />

      {pipeline.length > 0 && <TomorrowFirstMove pipeline={pipeline} />}

      <SalesQuickTools />

      {priorities.length > 0 && (
        <div>
          <SectionHeader
            icon={<Flame className="w-3.5 h-3.5 text-qep-orange" />}
            label="Priority Actions"
            trailing={`${priorities.length} items`}
          />
          <div className="space-y-3">
            {priorities.slice(0, 5).map((action, i) => (
              <ActionItemCard
                key={action.deal_id ?? i}
                action={action}
                deal={action.deal_id ? dealMap.get(action.deal_id) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      <ApprovalsSection
        pendingApprovals={briefing?.pending_approvals}
        role={profile?.role ?? null}
      />

      {briefing?.prep_cards && briefing.prep_cards.length > 0 && (
        <div>
          <SectionHeader
            icon={<Calendar className="w-3.5 h-3.5 text-purple-400" />}
            label="Today's Meetings"
          />
          <div className="space-y-3">
            {briefing.prep_cards.map((card) => (
              <PrepCard
                key={card.customer_id ?? card.customer_name}
                card={card}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  icon,
  label,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 h-px bg-white/[0.06]" />
      {trailing && (
        <span className="text-[11px] text-muted-foreground/60 font-medium">
          {trailing}
        </span>
      )}
    </div>
  );
}

const MANAGER_ROLES = new Set(["manager", "owner", "admin"]);

function formatCurrencyShort(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function formatAssignedRole(role: string | null): string {
  if (!role) return "the approver";
  // Roles flow through as e.g. "manager", "owner", "branch_sales_manager".
  // Spread underscores → spaces and title-case for display.
  return role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Phase 2C: Approvals visibility on the morning briefing. Renders nothing
 * unless the briefing has rep_stuck (for reps) or manager_pending_count > 0
 * (for managers/owners/admins). Reps tap into /sales/my-approvals; managers
 * tap into the full approval center at /qrm/command/approvals.
 */
function ApprovalsSection({
  pendingApprovals,
  role,
}: {
  pendingApprovals:
    | {
        rep_stuck: RepStuckApproval[];
        manager_pending: ManagerPendingApproval[];
        manager_pending_count: number;
      }
    | undefined;
  role: string | null;
}) {
  const navigate = useNavigate();

  if (!pendingApprovals) return null;

  const isManager = role != null && MANAGER_ROLES.has(role);
  const showManager = isManager && pendingApprovals.manager_pending_count > 0;
  const showRep = pendingApprovals.rep_stuck.length > 0;

  if (!showRep && !showManager) return null;

  const olderThan24h = showManager
    ? pendingApprovals.manager_pending.filter((a) => a.hours_pending >= 24).length
    : 0;

  return (
    <div>
      <SectionHeader
        icon={
          <ClipboardCheck
            className={`w-3.5 h-3.5 ${showManager ? "text-qep-orange" : "text-amber-400"}`}
          />
        }
        label="Approvals"
        trailing={
          showManager
            ? `${pendingApprovals.manager_pending_count} pending`
            : `${pendingApprovals.rep_stuck.length} stuck`
        }
      />

      {showManager ? (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => navigate("/qrm/command/approvals")}
            className="w-full text-left rounded-2xl border border-qep-orange/40 bg-qep-orange/[0.09] hover:bg-qep-orange/[0.13] transition-colors px-4 py-3.5 active:scale-[0.995]"
            aria-label={`${pendingApprovals.manager_pending_count} quotes need your decision — open approvals`}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-qep-orange/20 flex items-center justify-center shrink-0">
                <ClipboardCheck className="w-4.5 h-4.5 text-qep-orange" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-foreground leading-tight">
                  <span className="tabular-nums text-qep-orange">
                    {pendingApprovals.manager_pending_count}
                  </span>{" "}
                  {pendingApprovals.manager_pending_count === 1 ? "quote" : "quotes"}{" "}
                  need your decision
                </p>
                {olderThan24h > 0 && (
                  <p className="text-[12px] text-foreground/70 mt-0.5">
                    <span className="tabular-nums font-medium text-amber-300">
                      {olderThan24h}
                    </span>{" "}
                    older than 24h
                  </p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 text-qep-orange/80" />
            </div>
          </button>

          {pendingApprovals.manager_pending.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.04] overflow-hidden">
              {pendingApprovals.manager_pending.map((row) => (
                <button
                  key={row.approval_case_id}
                  type="button"
                  onClick={() => navigate("/qrm/command/approvals")}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {row.customer_name ?? "Customer"}
                      {row.quote_number && (
                        <span className="text-muted-foreground/70 font-normal ml-1.5">
                          · {row.quote_number}
                        </span>
                      )}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5 tabular-nums">
                      {formatCurrencyShort(row.total_amount)}
                      {row.margin_pct != null && (
                        <span className="ml-1.5">· {row.margin_pct.toFixed(1)}% margin</span>
                      )}
                      <span className="ml-1.5">
                        · {row.hours_pending}h pending
                        {row.submitted_by_name ? ` · ${row.submitted_by_name}` : ""}
                      </span>
                    </p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {showRep && !showManager && (
        <div className="space-y-2.5">
          {pendingApprovals.rep_stuck.map((row) => (
            <button
              key={row.quote_package_id}
              type="button"
              onClick={() => navigate("/sales/my-approvals")}
              className="w-full text-left rounded-xl border border-amber-400/30 bg-amber-400/[0.05] hover:bg-amber-400/[0.08] transition-colors px-3.5 py-3 active:scale-[0.995]"
              aria-label={`Quote ${row.quote_number ?? ""} stuck for ${row.hours_pending} hours`}
            >
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 shrink-0 text-amber-300/90" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-foreground truncate">
                    {row.customer_name ?? "Customer"}
                    {row.quote_number && (
                      <span className="text-muted-foreground/70 font-normal ml-1.5">
                        · {row.quote_number}
                      </span>
                    )}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5 tabular-nums">
                    {formatCurrencyShort(row.total_amount)}
                    <span className="ml-1.5">
                      · Submitted {row.hours_pending}h ago to{" "}
                      {formatAssignedRole(row.assigned_role)}
                    </span>
                  </p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-amber-300/70" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
