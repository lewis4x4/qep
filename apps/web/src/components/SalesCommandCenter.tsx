import { useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Flame,
  Mic,
  Target,
  TrendingUp,
  Zap,
  Activity,
  BarChart3,
  ThermometerSun,
  Snowflake,
  CircleDot,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { crmSupabase } from "@/features/qrm/lib/qrm-supabase";
import { MorningBriefSection } from "@/features/dashboards/components/MorningBriefSection";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { MotionList } from "@/components/primitives/MotionList";
import { MotionItem } from "@/components/primitives/MotionItem";
import type { UserRole } from "@/lib/database.types";
import {
  getExtractedContactLabel,
  normalizeExtractedDealData,
} from "@/lib/voice-capture-extraction";

// ─── Types ───────────────────────────────────────────────────────

interface SalesCommandCenterProps {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userRole: UserRole;
}

interface WeightedDeal {
  id: string;
  name: string;
  stage_name: string;
  stage_probability: number | null;
  amount: number | null;
  weighted_amount: number | null;
  primary_contact_id: string | null;
  company_id: string | null;
  expected_close_on: string | null;
  next_follow_up_at: string | null;
  last_activity_at: string | null;
  created_at: string;
}

interface EnrichedDeal extends WeightedDeal {
  contactName: string | null;
  companyName: string | null;
  heat: "hot" | "warm" | "cold" | "at_risk";
}

interface VoiceCaptureRow {
  id: string;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extracted_data: any;
  sentiment: string | null;
  manager_attention: boolean;
  transcript: string | null;
}

interface CommandCenterData {
  deals: EnrichedDeal[];
  totalPipelineValue: number;
  weightedPipelineValue: number;
  openDealCount: number;
  overdueFollowUps: EnrichedDeal[];
  todayFollowUps: EnrichedDeal[];
  weekFollowUps: EnrichedDeal[];
  activitiesThisWeek: number;
  dealsClosingThisWeek: EnrichedDeal[];
  voiceCaptures: VoiceCaptureRow[];
  briefing: { content: string; briefing_date: string } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

function getFollowUpUrgency(
  nextFollowUpAt: string,
): "overdue" | "today" | "this_week" | "upcoming" {
  const now = new Date();
  const followUp = new Date(nextFollowUpAt);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  const weekEnd = new Date(todayStart.getTime() + 7 * 86_400_000);

  if (followUp < now) return "overdue";
  if (followUp < todayEnd) return "today";
  if (followUp < weekEnd) return "this_week";
  return "upcoming";
}

function getHoursOverdue(nextFollowUpAt: string): number {
  return Math.max(
    0,
    (Date.now() - new Date(nextFollowUpAt).getTime()) / 3_600_000,
  );
}

function formatOverdue(hours: number): string {
  if (hours < 1) return "< 1h overdue";
  if (hours < 24) return `${Math.round(hours)}h overdue`;
  const days = Math.floor(hours / 24);
  return `${days}d overdue`;
}

function getDealHeat(
  deal: WeightedDeal,
): "hot" | "warm" | "cold" | "at_risk" {
  const now = Date.now();
  const daysSinceActivity = deal.last_activity_at
    ? (now - new Date(deal.last_activity_at).getTime()) / 86_400_000
    : Infinity;
  const isOverdue =
    deal.next_follow_up_at && new Date(deal.next_follow_up_at) < new Date();

  if (isOverdue && daysSinceActivity > 5) return "at_risk";
  if (daysSinceActivity <= 2) return "hot";
  if (daysSinceActivity <= 5) return "warm";
  return "cold";
}

function getDynamicSubtitle(data: CommandCenterData): {
  text: string;
  tone: "urgent" | "active" | "calm";
} {
  if (data.overdueFollowUps.length > 0) {
    const n = data.overdueFollowUps.length;
    return {
      text: `${n} follow-up${n > 1 ? "s" : ""} overdue — let's get on ${n > 1 ? "them" : "it"}.`,
      tone: "urgent",
    };
  }
  if (data.todayFollowUps.length > 0) {
    const n = data.todayFollowUps.length;
    return {
      text: `${n} follow-up${n > 1 ? "s" : ""} due today. Stay ahead of the game.`,
      tone: "active",
    };
  }
  if (data.dealsClosingThisWeek.length > 0) {
    const n = data.dealsClosingThisWeek.length;
    return {
      text: `${n} deal${n > 1 ? "s" : ""} targeting close this week. Time to close strong.`,
      tone: "active",
    };
  }
  if (data.openDealCount > 0) {
    return {
      text: "All follow-ups handled. Time to move deals forward.",
      tone: "calm",
    };
  }
  return { text: "Your command center is ready.", tone: "calm" };
}

const HEAT_CONFIG = {
  hot: {
    label: "Hot",
    icon: Flame,
    badgeClass:
      "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  warm: {
    label: "Warm",
    icon: ThermometerSun,
    badgeClass:
      "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  },
  cold: {
    label: "Cold",
    icon: Snowflake,
    badgeClass:
      "bg-blue-400/15 text-blue-400 border-blue-400/30",
  },
  at_risk: {
    label: "At Risk",
    icon: AlertTriangle,
    badgeClass:
      "bg-red-500/15 text-red-400 border-red-500/30",
  },
} as const;

const SENTIMENT_BADGE: Record<string, { variant: "success" | "destructive" | "secondary"; label: string }> = {
  positive: { variant: "success", label: "Positive" },
  negative: { variant: "destructive", label: "Negative" },
  neutral: { variant: "secondary", label: "Neutral" },
};

// ─── Data Fetching ───────────────────────────────────────────────

async function fetchCommandCenterData(
  _userId: string,
): Promise<CommandCenterData> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const weekEnd = new Date(todayStart.getTime() + 7 * 86_400_000);

  const db = supabase;

  const [
    dealsResult,
    activitiesResult,
    voiceResult,
    briefingResult,
  ] = await Promise.all([
    crmSupabase
      .from("crm_deals_weighted")
      .select(
        "id, name, stage_name, stage_probability, amount, weighted_amount, primary_contact_id, company_id, expected_close_on, next_follow_up_at, last_activity_at, created_at",
      )
      .is("closed_at", null),
    crmSupabase
      .from("crm_activities")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("occurred_at", weekAgo.toISOString()),
    db
      .from("voice_captures")
      .select(
        "id, created_at, extracted_data, sentiment, manager_attention, transcript",
      )
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("morning_briefings")
      .select("content, briefing_date")
      .eq("briefing_date", todayStr)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (dealsResult.error) {
    console.warn("[command-center] crm_deals_weighted:", dealsResult.error);
    return {
      deals: [],
      totalPipelineValue: 0,
      weightedPipelineValue: 0,
      openDealCount: 0,
      overdueFollowUps: [],
      todayFollowUps: [],
      weekFollowUps: [],
      activitiesThisWeek: activitiesResult.count ?? 0,
      dealsClosingThisWeek: [],
      voiceCaptures: (voiceResult.data ?? []) as VoiceCaptureRow[],
      briefing: briefingResult.data as {
        content: string;
        briefing_date: string;
      } | null,
    };
  }

  const rawDeals = (dealsResult.data ?? []) as WeightedDeal[];

  const contactIds = [
    ...new Set(rawDeals.map((d) => d.primary_contact_id).filter(Boolean)),
  ] as string[];
  const companyIds = [
    ...new Set(rawDeals.map((d) => d.company_id).filter(Boolean)),
  ] as string[];

  const [contactsResult, companiesResult] = await Promise.all([
    contactIds.length > 0
      ? crmSupabase
          .from("crm_contacts")
          .select("id, first_name, last_name")
          .in("id", contactIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    companyIds.length > 0
      ? crmSupabase
          .from("crm_companies")
          .select("id, name")
          .in("id", companyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const contactMap = new Map(
    (contactsResult.data ?? []).map((c) => [
      c.id,
      `${c.first_name} ${c.last_name}`.trim(),
    ]),
  );
  const companyMap = new Map(
    (companiesResult.data ?? []).map((c) => [c.id, c.name]),
  );

  const deals: EnrichedDeal[] = rawDeals.map((d) => ({
    ...d,
    contactName: d.primary_contact_id
      ? (contactMap.get(d.primary_contact_id) ?? null)
      : null,
    companyName: d.company_id
      ? (companyMap.get(d.company_id) ?? null)
      : null,
    heat: getDealHeat(d),
  }));

  const dealsWithFollowUp = deals.filter((d) => d.next_follow_up_at);

  const overdueFollowUps = dealsWithFollowUp
    .filter((d) => getFollowUpUrgency(d.next_follow_up_at!) === "overdue")
    .sort(
      (a, b) =>
        new Date(a.next_follow_up_at!).getTime() -
        new Date(b.next_follow_up_at!).getTime(),
    );

  const todayFollowUps = dealsWithFollowUp
    .filter((d) => getFollowUpUrgency(d.next_follow_up_at!) === "today")
    .sort(
      (a, b) =>
        new Date(a.next_follow_up_at!).getTime() -
        new Date(b.next_follow_up_at!).getTime(),
    );

  const weekFollowUps = dealsWithFollowUp
    .filter((d) => getFollowUpUrgency(d.next_follow_up_at!) === "this_week")
    .sort(
      (a, b) =>
        new Date(a.next_follow_up_at!).getTime() -
        new Date(b.next_follow_up_at!).getTime(),
    );

  const dealsClosingThisWeek = deals.filter((d) => {
    if (!d.expected_close_on) return false;
    const closeDate = new Date(d.expected_close_on);
    return closeDate >= todayStart && closeDate < weekEnd;
  });

  const totalPipelineValue = deals.reduce(
    (sum, d) => sum + (d.amount ?? 0),
    0,
  );
  const weightedPipelineValue = deals.reduce(
    (sum, d) => sum + (d.weighted_amount ?? 0),
    0,
  );

  return {
    deals,
    totalPipelineValue,
    weightedPipelineValue,
    openDealCount: deals.length,
    overdueFollowUps,
    todayFollowUps,
    weekFollowUps,
    activitiesThisWeek: activitiesResult.count ?? 0,
    dealsClosingThisWeek,
    voiceCaptures: (voiceResult.data ?? []) as VoiceCaptureRow[],
    briefing: briefingResult.data as {
      content: string;
      briefing_date: string;
    } | null,
  };
}

// ─── Metric Card ─────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  subValue,
  icon: Icon,
  href,
  accent,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  accent?: "orange" | "red" | "green" | "blue";
}) {
  const accentColor = {
    orange: "text-qep-orange",
    red: "text-red-400",
    green: "text-emerald-400",
    blue: "text-blue-400",
  }[accent ?? "orange"];

  const inner = (
    <GlassPanel className="p-6 transition-all duration-300 hover:shadow-2xl hover:border-white/20 group">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400">
            {label}
          </p>
          <p className={`mt-2 text-3xl font-light tabular-nums text-white`}>
            {value}
          </p>
          {subValue && (
            <p className="mt-1 text-[11px] text-slate-400">
              {subValue}
            </p>
          )}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] group-hover:bg-white/[0.08] transition-colors">
          <Icon className={`h-5 w-5 ${accentColor}`} aria-hidden="true" />
        </div>
      </div>
    </GlassPanel>
  );

  if (href) {
    return (
      <Link to={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

// ─── Action Queue ────────────────────────────────────────────────

function FollowUpItem({ deal }: { deal: EnrichedDeal }) {
  const urgency = getFollowUpUrgency(deal.next_follow_up_at!);
  const hours = urgency === "overdue" ? getHoursOverdue(deal.next_follow_up_at!) : 0;

  const urgencyStyles = {
    overdue: "border-l-red-500 bg-red-500/5",
    today: "border-l-qep-orange bg-qep-orange/5",
    this_week: "border-l-yellow-500/60 bg-yellow-500/[0.03]",
    upcoming: "border-l-white/20",
  };

  const urgencyBadge = {
    overdue: (
      <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-red-400 bg-red-500/10 px-2 py-1 rounded-md">
        {formatOverdue(hours)}
      </span>
    ),
    today: (
      <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-qep-orange bg-qep-orange/10 px-2 py-1 rounded-md">
        Due today
      </span>
    ),
    this_week: (
      <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-300 bg-white/5 px-2 py-1 rounded-md">
        This week
      </span>
    ),
    upcoming: null,
  };

  const navigate = useNavigate();

  return (
    <MotionItem onClick={() => navigate(`/qrm/deals/${deal.id}`)}>
      <div className="w-full grid grid-cols-1 md:grid-cols-12 gap-4 items-center relative z-10">
        <div className="col-span-12 md:col-span-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-white group-hover:text-qep-orange transition-colors">
              {deal.name}
            </span>
            {urgencyBadge[urgency]}
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <CircleDot className="h-3 w-3" aria-hidden />
              {deal.stage_name}
            </span>
            {deal.contactName && (
              <>
                <span className="text-white/20">·</span>
                <span>{deal.contactName}</span>
              </>
            )}
            {deal.companyName && (
              <>
                <span className="text-white/20">·</span>
                <span>{deal.companyName}</span>
              </>
            )}
          </div>
        </div>
        <div className="col-span-6 md:col-span-5 flex justify-end">
          {deal.amount != null && (
            <span className="text-sm font-medium text-slate-200 tabular-nums">
              {formatCurrency(deal.amount)}
            </span>
          )}
        </div>
        <div className="hidden md:flex col-span-1 justify-end text-slate-500 group-hover:text-qep-orange transition-colors">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </div>
      </div>
    </MotionItem>
  );
}

type QueueCategory = "overdue" | "today" | "this_week";

interface CategoryConfig {
  key: QueueCategory;
  label: string;
  icon: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  countBg: string;
}

const CATEGORIES: CategoryConfig[] = [
  {
    key: "overdue",
    label: "Overdue",
    icon: "🔴",
    pillBg: "bg-red-500/10",
    pillBorder: "border-red-500/30",
    pillText: "text-red-400",
    countBg: "bg-red-500/20",
  },
  {
    key: "today",
    label: "Today",
    icon: "🟠",
    pillBg: "bg-qep-orange/10",
    pillBorder: "border-qep-orange/30",
    pillText: "text-qep-orange",
    countBg: "bg-qep-orange/20",
  },
  {
    key: "this_week",
    label: "This Week",
    icon: "🟡",
    pillBg: "bg-yellow-500/8",
    pillBorder: "border-yellow-500/25",
    pillText: "text-yellow-400",
    countBg: "bg-yellow-500/20",
  },
];

const PEEK_LIMIT = 3;

function ActionQueueSection({
  overdueFollowUps,
  todayFollowUps,
  weekFollowUps,
}: {
  overdueFollowUps: EnrichedDeal[];
  todayFollowUps: EnrichedDeal[];
  weekFollowUps: EnrichedDeal[];
}) {
  const buckets: Record<QueueCategory, EnrichedDeal[]> = {
    overdue: overdueFollowUps,
    today: todayFollowUps,
    this_week: weekFollowUps,
  };

  const defaultCategory: QueueCategory | null =
    overdueFollowUps.length > 0
      ? "overdue"
      : todayFollowUps.length > 0
        ? "today"
        : weekFollowUps.length > 0
          ? "this_week"
          : null;

  const [openCategory, setOpenCategory] = useState<QueueCategory | null>(defaultCategory);

  const totalActions =
    overdueFollowUps.length + todayFollowUps.length + weekFollowUps.length;

  if (totalActions === 0) {
    return (
      <section aria-label="Follow-up queue">
        <h2 className="mb-4 flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400">
          <Target className="h-4 w-4" aria-hidden />
          Action Queue
        </h2>
        <GlassPanel>
          <div className="flex flex-col items-center gap-2 text-center py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 mb-2">
              <Zap className="h-5 w-5 text-emerald-400" aria-hidden />
            </div>
            <p className="text-lg font-light text-white">
              All clear — no pending follow-ups
            </p>
            <p className="text-sm text-slate-400">
              Great work. Focus on advancing your active deals.
            </p>
          </div>
        </GlassPanel>
      </section>
    );
  }

  const activeBucket = openCategory ? buckets[openCategory] : [];
  const visibleDeals = activeBucket.slice(0, PEEK_LIMIT);
  const remaining = activeBucket.length - PEEK_LIMIT;

  return (
    <section aria-label="Follow-up queue">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Target className="h-4 w-4" aria-hidden />
          Action Queue
        </h2>
        <Link
          to="/qrm/deals"
          className="text-xs text-muted-foreground hover:text-qep-orange transition-colors"
        >
          View pipeline
        </Link>
      </div>

      {/* Category pills — the hero of this section */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {CATEGORIES.map((cat) => {
          const count = buckets[cat.key].length;
          if (count === 0) return (
            <div
              key={cat.key}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 opacity-40"
            >
              <span className="text-xs font-medium text-muted-foreground">{cat.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">0</span>
            </div>
          );

          const isOpen = openCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setOpenCategory(isOpen ? null : cat.key)}
              className={cn(
                "relative flex items-center justify-center gap-2.5 rounded-xl border px-4 py-3.5 transition-all duration-200",
                isOpen
                  ? `${cat.pillBg} ${cat.pillBorder} ${cat.pillText} shadow-lg shadow-black/20 scale-[1.02]`
                  : `bg-white/[0.03] border-white/10 text-muted-foreground hover:border-white/20 hover:bg-white/[0.05]`,
              )}
            >
              <span className="text-sm">{cat.icon}</span>
              <span className="text-xs font-semibold">{cat.label}</span>
              <span className={cn(
                "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                isOpen ? cat.countBg : "bg-white/10",
              )}>
                {count}
              </span>
              {isOpen && (
                <ChevronDown className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-3 w-3 opacity-50" />
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded items for the selected category */}
      {openCategory && activeBucket.length > 0 && (
        <MotionList className="space-y-2 mt-4 animate-in slide-in-from-top-2 fade-in duration-200">
          {visibleDeals.map((deal) => (
            <FollowUpItem key={deal.id} deal={deal} />
          ))}
          {remaining > 0 && (
            <Link
              to="/qrm/deals"
              className="flex items-center justify-center gap-1.5 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 text-xs font-bold tracking-[0.1em] uppercase text-slate-400 transition-colors hover:text-qep-orange hover:border-qep-orange/30"
            >
              View {remaining} more in pipeline
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </MotionList>
      )}
    </section>
  );
}

// ─── Deal Momentum ───────────────────────────────────────────────

const MOMENTUM_PEEK = 4;

function DealMomentumSection({ deals }: { deals: EnrichedDeal[] }) {
  const [showAll, setShowAll] = useState(false);

  const topDeals = useMemo(
    () =>
      [...deals]
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
        .slice(0, 8),
    [deals],
  );

  if (topDeals.length === 0) return null;

  const visibleDeals = showAll ? topDeals : topDeals.slice(0, MOMENTUM_PEEK);
  const hasMore = topDeals.length > MOMENTUM_PEEK;

  return (
    <section aria-label="Deal momentum">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400">
          <TrendingUp className="h-4 w-4" aria-hidden />
          Deal Momentum
        </h2>
        <Link
          to="/qrm/deals"
          className="text-xs font-bold tracking-[0.1em] uppercase text-slate-400 hover:text-qep-orange transition-colors"
        >
          All deals
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {visibleDeals.map((deal) => {
          const heatCfg = HEAT_CONFIG[deal.heat];
          const HeatIcon = heatCfg.icon;
          return (
            <Link
              key={deal.id}
              to={`/qrm/deals/${deal.id}`}
              className="group block"
            >
              <GlassPanel className="h-full p-5 transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-start justify-between mb-4">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold tracking-[0.2em] uppercase ${heatCfg.badgeClass}`}
                  >
                    <HeatIcon className="h-3 w-3" aria-hidden />
                    {heatCfg.label}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-sm font-medium text-white truncate group-hover:text-qep-orange transition-colors">
                  {deal.name}
                </p>
                <p className="mt-1 text-xs text-slate-400 truncate">
                  {deal.stage_name}
                  {deal.contactName ? ` · ${deal.contactName}` : ""}
                </p>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-xl font-light tabular-nums text-slate-200">
                    {deal.amount != null
                      ? formatCurrency(deal.amount)
                      : "—"}
                  </span>
                  {deal.last_activity_at && (
                    <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">
                      {timeAgo(deal.last_activity_at)}
                    </span>
                  )}
                </div>
              </GlassPanel>
            </Link>
          );
        })}
      </div>
      {hasMore && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400 transition-colors hover:text-white hover:border-white/20"
        >
          {showAll ? "Show less" : `Show ${topDeals.length - MOMENTUM_PEEK} more deals`}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
        </button>
      )}
    </section>
  );
}

// ─── Field Intelligence (Voice Captures) ─────────────────────────

function FieldIntelligenceSection({
  voiceCaptures,
}: {
  voiceCaptures: VoiceCaptureRow[];
}) {
  const navigate = useNavigate();

  if (voiceCaptures.length === 0) {
    return (
      <section aria-label="Field intelligence">
        <h2 className="mb-4 flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400">
          <Mic className="h-4 w-4" aria-hidden />
          Field Intelligence
        </h2>
        <GlassPanel>
          <div className="flex flex-col items-center gap-2 text-center py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-qep-orange/10 mb-2">
              <Mic className="h-5 w-5 text-qep-orange" aria-hidden />
            </div>
            <p className="text-lg font-light text-white">
              No voice captures yet
            </p>
            <p className="text-sm text-slate-400 mb-4">
              Record field visits to build your deal intelligence.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/voice")}
              className="rounded-full border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
            >
              Record Field Note
            </Button>
          </div>
        </GlassPanel>
      </section>
    );
  }

  return (
    <section aria-label="Field intelligence">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] uppercase text-slate-400">
          <Mic className="h-4 w-4" aria-hidden />
          Field Intelligence
        </h2>
        <Link
          to="/voice/history"
          className="text-xs font-bold tracking-[0.1em] uppercase text-slate-400 hover:text-qep-orange transition-colors"
        >
          All captures
        </Link>
      </div>
      <MotionList>
        {voiceCaptures.map((vc) => {
          const extracted = normalizeExtractedDealData(vc.extracted_data);
          const contactName = getExtractedContactLabel(extracted);
          const sentimentInfo = vc.sentiment
            ? SENTIMENT_BADGE[vc.sentiment]
            : null;
          const snippet = vc.transcript
            ? vc.transcript.slice(0, 120) +
              (vc.transcript.length > 120 ? "..." : "")
            : null;

          return (
            <MotionItem
              key={vc.id}
            >
              <div className="w-full flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap mb-1">
                    <span className="text-sm font-medium text-white">
                      {contactName ?? "Voice capture"}
                    </span>
                    {sentimentInfo && (
                      <span
                        className={cn("text-[10px] font-bold tracking-[0.2em] uppercase px-2 py-1 rounded-md", 
                          sentimentInfo.variant === "success" ? "bg-emerald-500/10 text-emerald-400" :
                          sentimentInfo.variant === "destructive" ? "bg-red-500/10 text-red-400" :
                          "bg-white/5 text-slate-300"
                        )}
                      >
                        {sentimentInfo.label}
                      </span>
                    )}
                    {vc.manager_attention && (
                      <span className="text-[10px] font-bold tracking-[0.2em] uppercase px-2 py-1 rounded-md bg-red-500/10 text-red-400">
                        Flagged
                      </span>
                    )}
                  </div>
                  {snippet && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      "{snippet}"
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {timeAgo(vc.created_at)}
                </span>
              </div>
            </MotionItem>
          );
        })}
      </MotionList>
    </section>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────

function CommandCenterSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Header skeleton */}
      <div>
        <div className="h-7 bg-muted rounded w-64 mb-2" />
        <div className="h-4 bg-muted rounded w-96" />
      </div>
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-4 space-y-3"
          >
            <div className="h-2.5 bg-muted rounded w-20" />
            <div className="h-7 bg-muted rounded w-16" />
          </div>
        ))}
      </div>
      {/* Action queue */}
      <div className="space-y-2">
        <div className="h-4 bg-muted rounded w-32 mb-3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-4 space-y-2"
          >
            <div className="h-4 bg-muted rounded w-48" />
            <div className="h-3 bg-muted rounded w-72" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function SalesCommandCenter({
  userId,
  userName,
  userEmail,
  userRole,
}: SalesCommandCenterProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["command-center", userId],
    queryFn: () => fetchCommandCenterData(userId),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const greeting = useMemo(() => getTimeGreeting(), []);
  const firstName = useMemo(() => {
    if (userName) return userName.split(" ")[0];
    return userEmail?.split("@")[0] ?? "there";
  }, [userName, userEmail]);

  const subtitle = useMemo(() => {
    if (!data) return null;
    return getDynamicSubtitle(data);
  }, [data]);

  const todayFormatted = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [],
  );

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto bg-qep-bg min-h-full">
        <CommandCenterSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 max-w-6xl mx-auto bg-qep-bg min-h-full">
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <AlertTriangle className="h-8 w-8 text-qep-orange" />
          <p className="text-sm text-foreground font-medium">
            Could not load your command center
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const subtitleColorMap = {
    urgent: "text-red-400",
    active: "text-qep-orange",
    calm: "text-emerald-400",
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto min-h-full">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-10 sm:mb-12">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h1 className="text-4xl sm:text-5xl font-display font-medium tracking-tight text-white">
            {greeting}, {firstName}.
          </h1>
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-500 tabular-nums">
            {todayFormatted}
          </span>
        </div>
        {subtitle && (
          <p
            className={`mt-4 text-lg font-light ${subtitleColorMap[subtitle.tone]}`}
          >
            {subtitle.text}
          </p>
        )}
      </div>

      {/* ── AI Briefing (hero position, shared with the Iron dashboards) ─ */}
      <div className="mb-10">
        <MorningBriefSection />
      </div>

      {/* ── Metrics ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <MetricCard
          label="Pipeline"
          value={formatCurrency(data.totalPipelineValue)}
          subValue={`${formatCurrency(data.weightedPipelineValue)} weighted`}
          icon={DollarSign}
          href="/qrm/deals"
          accent="orange"
        />
        <MetricCard
          label="Open Deals"
          value={String(data.openDealCount)}
          subValue={
            data.dealsClosingThisWeek.length > 0
              ? `${data.dealsClosingThisWeek.length} closing this week`
              : undefined
          }
          icon={BarChart3}
          href="/qrm/deals"
          accent="blue"
        />
        <MetricCard
          label="Follow-ups"
          value={String(
            data.overdueFollowUps.length +
              data.todayFollowUps.length +
              data.weekFollowUps.length,
          )}
          subValue={
            data.overdueFollowUps.length > 0
              ? `${data.overdueFollowUps.length} overdue`
              : "All on track"
          }
          icon={Clock}
          accent={data.overdueFollowUps.length > 0 ? "red" : "green"}
        />
        <MetricCard
          label="Activity (7d)"
          value={String(data.activitiesThisWeek)}
          icon={Activity}
          href="/qrm/activities"
          accent="green"
        />
      </div>

      {/* ── Deal Momentum ──────────────────────────────────────── */}
      <div className="mb-10">
        <DealMomentumSection deals={data.deals} />
      </div>

      {/* ── Action Queue (with filter pills) ───────────────────── */}
      <div className="mb-10">
        <ActionQueueSection
          overdueFollowUps={data.overdueFollowUps}
          todayFollowUps={data.todayFollowUps}
          weekFollowUps={data.weekFollowUps}
        />
      </div>

      {/* ── Field Intelligence ─────────────────────────────────── */}
      <div className="mb-10">
        <FieldIntelligenceSection voiceCaptures={data.voiceCaptures} />
      </div>
    </div>
  );
}
