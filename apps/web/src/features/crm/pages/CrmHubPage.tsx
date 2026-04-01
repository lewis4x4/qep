import { useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Brain,
  Camera,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  DollarSign,
  Flame,
  HelpCircle,
  Loader2,
  MessageSquare,
  Mic,
  Snowflake,
  Sparkles,
  Swords,
  Target,
  ThermometerSun,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { crmSupabase } from "../lib/crm-supabase";
import type { UserRole } from "@/lib/database.types";
import {
  getExtractedContactLabel,
  normalizeExtractedDealData,
} from "@/lib/voice-capture-extraction";

// ─── Props ──────────────────────────────────────────────────────

interface CrmHubPageProps {
  userRole: UserRole;
  userId: string;
  userName: string | null;
  userEmail: string | null;
}

// ─── Types ──────────────────────────────────────────────────────

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

interface ScoredDeal {
  id: string;
  name: string;
  amount: number | null;
  deal_score: number | null;
  deal_score_factors: Record<string, number> | null;
  stage_name: string | null;
}

interface AnomalyAlert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

interface CompetitiveMention {
  id: string;
  competitor_name: string;
  context: string | null;
  sentiment: string | null;
  created_at: string;
}

interface KnowledgeGap {
  id: string;
  question: string;
  created_at: string;
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
  scoredDeals: ScoredDeal[];
  anomalyAlerts: AnomalyAlert[];
  competitiveMentions: CompetitiveMention[];
  knowledgeGaps: KnowledgeGap[];
  avgDealScore: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────

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
  return Math.max(0, (Date.now() - new Date(nextFollowUpAt).getTime()) / 3_600_000);
}

function formatOverdue(hours: number): string {
  if (hours < 1) return "< 1h overdue";
  if (hours < 24) return `${Math.round(hours)}h overdue`;
  const days = Math.floor(hours / 24);
  return `${days}d overdue`;
}

function getDealHeat(deal: WeightedDeal): "hot" | "warm" | "cold" | "at_risk" {
  const now = Date.now();
  const daysSinceActivity = deal.last_activity_at
    ? (now - new Date(deal.last_activity_at).getTime()) / 86_400_000
    : Infinity;
  const isOverdue = deal.next_follow_up_at && new Date(deal.next_follow_up_at) < new Date();
  if (isOverdue && daysSinceActivity > 5) return "at_risk";
  if (daysSinceActivity <= 2) return "hot";
  if (daysSinceActivity <= 5) return "warm";
  return "cold";
}

function getDynamicSubtitle(data: CommandCenterData): { text: string; tone: "urgent" | "active" | "calm" } {
  if (data.anomalyAlerts.length > 0) {
    const n = data.anomalyAlerts.length;
    return { text: `${n} AI alert${n > 1 ? "s" : ""} need your attention.`, tone: "urgent" };
  }
  if (data.overdueFollowUps.length > 0) {
    const n = data.overdueFollowUps.length;
    return { text: `${n} follow-up${n > 1 ? "s" : ""} overdue — let's get on ${n > 1 ? "them" : "it"}.`, tone: "urgent" };
  }
  if (data.todayFollowUps.length > 0) {
    const n = data.todayFollowUps.length;
    return { text: `${n} follow-up${n > 1 ? "s" : ""} due today. Stay ahead of the game.`, tone: "active" };
  }
  if (data.dealsClosingThisWeek.length > 0) {
    const n = data.dealsClosingThisWeek.length;
    return { text: `${n} deal${n > 1 ? "s" : ""} targeting close this week. Time to close strong.`, tone: "active" };
  }
  if (data.openDealCount > 0) {
    return { text: "All follow-ups handled. Time to move deals forward.", tone: "calm" };
  }
  return { text: "Your AI command center is ready.", tone: "calm" };
}

const HEAT_CONFIG = {
  hot: { label: "Hot", icon: Flame, badgeClass: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  warm: { label: "Warm", icon: ThermometerSun, badgeClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  cold: { label: "Cold", icon: Snowflake, badgeClass: "bg-blue-400/15 text-blue-400 border-blue-400/30" },
  at_risk: { label: "At Risk", icon: AlertTriangle, badgeClass: "bg-red-500/15 text-red-400 border-red-500/30" },
} as const;

const SENTIMENT_BADGE: Record<string, { variant: "success" | "destructive" | "secondary"; label: string }> = {
  positive: { variant: "success", label: "Positive" },
  negative: { variant: "destructive", label: "Negative" },
  neutral: { variant: "secondary", label: "Neutral" },
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-l-red-500 bg-red-500/5",
  high: "border-l-orange-500 bg-orange-500/5",
  medium: "border-l-yellow-500 bg-yellow-500/5",
  low: "border-l-blue-400 bg-blue-400/5",
};

// ─── Data Fetching ──────────────────────────────────────────────

async function fetchCommandCenterData(
  _userId: string,
  isElevated: boolean,
): Promise<CommandCenterData> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(todayStart.getTime() + 7 * 86_400_000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [
    dealsResult,
    activitiesResult,
    voiceResult,
    briefingResult,
    alertsResult,
    scoredDealsResult,
    competitiveResult,
    gapsResult,
  ] = await Promise.all([
    crmSupabase
      .from("crm_deals_weighted")
      .select("id, name, stage_name, stage_probability, amount, weighted_amount, primary_contact_id, company_id, expected_close_on, next_follow_up_at, last_activity_at, created_at")
      .is("closed_at", null),
    crmSupabase
      .from("crm_activities")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("occurred_at", weekAgo.toISOString()),
    db.from("voice_captures")
      .select("id, created_at, extracted_data, sentiment, manager_attention, transcript")
      .order("created_at", { ascending: false })
      .limit(5),
    db.from("morning_briefings")
      .select("content, briefing_date")
      .eq("briefing_date", todayStr)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("anomaly_alerts")
      .select("id, alert_type, severity, title, description, entity_type, entity_id, created_at")
      .eq("acknowledged", false)
      .order("created_at", { ascending: false })
      .limit(10),
    db.from("crm_deals")
      .select("id, name, amount, deal_score, deal_score_factors")
      .not("deal_score", "is", null)
      .is("deleted_at", null)
      .is("closed_at", null)
      .order("deal_score", { ascending: false })
      .limit(10),
    isElevated
      ? db.from("competitive_mentions")
          .select("id, competitor_name, context, sentiment, created_at")
          .gte("created_at", weekAgo.toISOString())
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    isElevated
      ? db.from("knowledge_gaps")
          .select("id, question, created_at")
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  if (dealsResult.error) throw dealsResult.error;

  const rawDeals = (dealsResult.data ?? []) as WeightedDeal[];

  const contactIds = [...new Set(rawDeals.map((d) => d.primary_contact_id).filter(Boolean))] as string[];
  const companyIds = [...new Set(rawDeals.map((d) => d.company_id).filter(Boolean))] as string[];

  const [contactsResult, companiesResult] = await Promise.all([
    contactIds.length > 0
      ? crmSupabase.from("crm_contacts").select("id, first_name, last_name").in("id", contactIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    companyIds.length > 0
      ? crmSupabase.from("crm_companies").select("id, name").in("id", companyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const contactMap = new Map((contactsResult.data ?? []).map((c) => [c.id, `${c.first_name} ${c.last_name}`.trim()]));
  const companyMap = new Map((companiesResult.data ?? []).map((c) => [c.id, c.name]));

  const deals: EnrichedDeal[] = rawDeals.map((d) => ({
    ...d,
    contactName: d.primary_contact_id ? (contactMap.get(d.primary_contact_id) ?? null) : null,
    companyName: d.company_id ? (companyMap.get(d.company_id) ?? null) : null,
    heat: getDealHeat(d),
  }));

  const dealsWithFollowUp = deals.filter((d) => d.next_follow_up_at);
  const overdueFollowUps = dealsWithFollowUp
    .filter((d) => getFollowUpUrgency(d.next_follow_up_at!) === "overdue")
    .sort((a, b) => new Date(a.next_follow_up_at!).getTime() - new Date(b.next_follow_up_at!).getTime());
  const todayFollowUps = dealsWithFollowUp
    .filter((d) => getFollowUpUrgency(d.next_follow_up_at!) === "today")
    .sort((a, b) => new Date(a.next_follow_up_at!).getTime() - new Date(b.next_follow_up_at!).getTime());
  const weekFollowUps = dealsWithFollowUp
    .filter((d) => getFollowUpUrgency(d.next_follow_up_at!) === "this_week")
    .sort((a, b) => new Date(a.next_follow_up_at!).getTime() - new Date(b.next_follow_up_at!).getTime());
  const dealsClosingThisWeek = deals.filter((d) => {
    if (!d.expected_close_on) return false;
    const closeDate = new Date(d.expected_close_on);
    return closeDate >= todayStart && closeDate < weekEnd;
  });

  const totalPipelineValue = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const weightedPipelineValue = deals.reduce((sum, d) => sum + (d.weighted_amount ?? 0), 0);

  const scored = (scoredDealsResult.data ?? []) as ScoredDeal[];
  const avgDealScore = scored.length > 0
    ? Math.round(scored.reduce((s, d) => s + (d.deal_score ?? 0), 0) / scored.length)
    : null;

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
    briefing: briefingResult.data as { content: string; briefing_date: string } | null,
    scoredDeals: scored,
    anomalyAlerts: (alertsResult.data ?? []) as AnomalyAlert[],
    competitiveMentions: (competitiveResult.data ?? []) as CompetitiveMention[],
    knowledgeGaps: (gapsResult.data ?? []) as KnowledgeGap[],
    avgDealScore,
  };
}

// ─── Metric Card ────────────────────────────────────────────────

function MetricCard({
  label, value, subValue, icon: Icon, href, accent,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  accent?: "orange" | "red" | "green" | "blue" | "purple";
}) {
  const accentColor = {
    orange: "text-qep-orange",
    red: "text-red-400",
    green: "text-emerald-400",
    blue: "text-blue-400",
    purple: "text-violet-400",
  }[accent ?? "orange"];

  const inner = (
    <Card className="group border-border bg-card px-4 py-3.5 transition-all duration-150 hover:shadow-md hover:border-white/20">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${accentColor}`}>{value}</p>
          {subValue && <p className="mt-0.5 text-[11px] text-muted-foreground">{subValue}</p>}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <Icon className={`h-5 w-5 ${accentColor}`} aria-hidden="true" />
        </div>
      </div>
    </Card>
  );

  return href ? <Link to={href} className="block">{inner}</Link> : inner;
}

// ─── Anomaly Alerts Banner ──────────────────────────────────────

function AnomalyAlertsBanner({
  alerts,
  onAcknowledge,
}: {
  alerts: AnomalyAlert[];
  onAcknowledge: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (alerts.length === 0) return null;

  return (
    <section aria-label="AI alerts" className="mb-8">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mb-3 flex w-full items-center gap-2 text-left"
      >
        <AlertTriangle className="h-4 w-4 text-red-400" aria-hidden />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-red-400">
          AI Alerts
        </h2>
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
          {alerts.length}
        </Badge>
        <ChevronDown className={`h-3.5 w-3.5 ml-auto text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-3 rounded-lg border border-border/60 border-l-[3px] px-4 py-3 ${SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.medium}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{alert.title}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize">
                    {alert.alert_type.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-muted-foreground tabular-nums">{timeAgo(alert.created_at)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onAcknowledge(alert.id)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Follow-up Item ─────────────────────────────────────────────

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
    overdue: <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{formatOverdue(hours)}</Badge>,
    today: <Badge variant="warning" className="text-[10px] px-1.5 py-0">Due today</Badge>,
    this_week: <Badge variant="secondary" className="text-[10px] px-1.5 py-0">This week</Badge>,
    upcoming: null,
  };

  return (
    <Link to={`/crm/deals/${deal.id}`} className="block group">
      <div className={`flex items-center gap-3 rounded-lg border border-border/60 border-l-[3px] px-4 py-3 transition-all duration-150 hover:shadow-md hover:border-white/20 ${urgencyStyles[urgency]}`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground group-hover:text-qep-orange transition-colors">{deal.name}</span>
            {urgencyBadge[urgency]}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1"><CircleDot className="h-3 w-3" aria-hidden />{deal.stage_name}</span>
            {deal.amount != null && <span className="tabular-nums">{formatCurrency(deal.amount)}</span>}
            {deal.contactName && <><span className="text-white/20">·</span><span>{deal.contactName}</span></>}
            {deal.companyName && <><span className="text-white/20">·</span><span>{deal.companyName}</span></>}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" aria-hidden />
      </div>
    </Link>
  );
}

// ─── Action Queue ───────────────────────────────────────────────

function ActionQueueSection({
  overdueFollowUps, todayFollowUps, weekFollowUps,
}: {
  overdueFollowUps: EnrichedDeal[];
  todayFollowUps: EnrichedDeal[];
  weekFollowUps: EnrichedDeal[];
}) {
  const totalActions = overdueFollowUps.length + todayFollowUps.length + weekFollowUps.length;

  if (totalActions === 0) {
    return (
      <section aria-label="Follow-up queue">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Target className="h-4 w-4" aria-hidden />Action Queue
        </h2>
        <Card className="border-border bg-card p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
              <Zap className="h-5 w-5 text-emerald-400" aria-hidden />
            </div>
            <p className="text-sm font-medium text-foreground">All clear — no pending follow-ups</p>
            <p className="text-xs text-muted-foreground">Great work. Focus on advancing your active deals.</p>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label="Follow-up queue">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Target className="h-4 w-4" aria-hidden />Action Queue
          <span className="ml-1 text-xs tabular-nums text-qep-orange">({totalActions})</span>
        </h2>
        <Link to="/crm/deals" className="text-xs text-muted-foreground hover:text-qep-orange transition-colors">View pipeline</Link>
      </div>
      <div className="space-y-2">
        {overdueFollowUps.map((d) => <FollowUpItem key={d.id} deal={d} />)}
        {todayFollowUps.map((d) => <FollowUpItem key={d.id} deal={d} />)}
        {weekFollowUps.map((d) => <FollowUpItem key={d.id} deal={d} />)}
      </div>
    </section>
  );
}

// ─── AI Deal Scoreboard ─────────────────────────────────────────

function DealScoreBoard({ deals }: { deals: ScoredDeal[] }) {
  if (deals.length === 0) return null;

  return (
    <section aria-label="AI deal scores">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Brain className="h-4 w-4" aria-hidden />AI Deal Intelligence
        </h2>
        <Link to="/crm/deals" className="text-xs text-muted-foreground hover:text-qep-orange transition-colors">All deals</Link>
      </div>
      <div className="space-y-2">
        {deals.map((deal) => {
          const score = deal.deal_score ?? 0;
          const scoreColor =
            score >= 70 ? "text-emerald-400" :
            score >= 40 ? "text-yellow-400" : "text-red-400";
          const barColor =
            score >= 70 ? "bg-emerald-500" :
            score >= 40 ? "bg-yellow-500" : "bg-red-500";
          const factors = deal.deal_score_factors ?? {};
          const factorEntries = Object.entries(factors).sort(([, a], [, b]) => b - a).slice(0, 3);

          return (
            <Link key={deal.id} to={`/crm/deals/${deal.id}`} className="block group">
              <Card className="border-border bg-card px-4 py-3 transition-all duration-150 hover:shadow-md hover:border-white/20">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground group-hover:text-qep-orange transition-colors truncate">{deal.name}</span>
                      {deal.amount != null && (
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatCurrency(deal.amount)}</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${score}%` }} />
                      </div>
                      <span className={`text-xs font-bold tabular-nums ${scoreColor}`}>{score}</span>
                    </div>
                    {factorEntries.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        {factorEntries.map(([key, val]) => (
                          <span key={key} className="text-[10px] text-muted-foreground">
                            {key.replace(/_/g, " ")}: <span className={val > 0 ? "text-emerald-400" : "text-red-400"}>{val > 0 ? "+" : ""}{val}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ─── Morning Briefing ───────────────────────────────────────────

function MorningBriefingSection({
  briefing, onGenerated,
}: {
  briefing: { content: string; briefing_date: string } | null;
  onGenerated: () => void;
}) {
  const [generating, setGenerating] = useState(false);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/morning-briefing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: "{}",
      });
      onGenerated();
    } catch { /* silent */ } finally {
      setGenerating(false);
    }
  }, [onGenerated]);

  return (
    <section aria-label="Morning briefing">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-4 w-4" aria-hidden />AI Briefing
      </h2>
      {briefing ? (
        <Card className="border-border bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />
            <span className="text-xs font-medium text-qep-orange">
              {new Date(briefing.briefing_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </span>
          </div>
          <div className="prose prose-sm prose-invert max-w-none text-foreground/90 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:text-sm [&_li]:text-sm [&_strong]:text-foreground [&_ul]:pl-4 [&_ol]:pl-4">
            <div dangerouslySetInnerHTML={{ __html: briefing.content.replace(/\n/g, "<br/>") }} />
          </div>
          <div className="mt-4 pt-3 border-t border-white/10">
            <Button size="sm" variant="ghost" onClick={handleGenerate} disabled={generating} className="text-xs text-muted-foreground hover:text-qep-orange">
              {generating
                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Refreshing...</>
                : <><Sparkles className="h-3 w-3 mr-1.5" />Refresh briefing</>}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="border-dashed border-border bg-card p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-qep-orange/10">
              <Sparkles className="h-6 w-6 text-qep-orange" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Your AI briefing is ready to generate</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                Get a personalized summary of your pipeline, priorities, and recommended actions for today.
              </p>
            </div>
            <Button size="sm" onClick={handleGenerate} disabled={generating} className="mt-1">
              {generating
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
                : <><Sparkles className="h-4 w-4 mr-2" />Generate Briefing</>}
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}

// ─── Field Intelligence ─────────────────────────────────────────

function FieldIntelligenceSection({ voiceCaptures }: { voiceCaptures: VoiceCaptureRow[] }) {
  const navigate = useNavigate();

  if (voiceCaptures.length === 0) {
    return (
      <section aria-label="Field intelligence">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Mic className="h-4 w-4" aria-hidden />Field Intelligence
        </h2>
        <Card className="border-border bg-card p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-qep-orange/10">
              <Mic className="h-5 w-5 text-qep-orange" aria-hidden />
            </div>
            <p className="text-sm font-medium text-foreground">No voice captures yet</p>
            <p className="text-xs text-muted-foreground mb-2">Record field visits to build your deal intelligence.</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/voice")}>Record Field Note</Button>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label="Field intelligence">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Mic className="h-4 w-4" aria-hidden />Field Intelligence
        </h2>
        <Link to="/voice/history" className="text-xs text-muted-foreground hover:text-qep-orange transition-colors">All captures</Link>
      </div>
      <div className="space-y-2">
        {voiceCaptures.map((vc) => {
          const extracted = normalizeExtractedDealData(vc.extracted_data);
          const contactName = getExtractedContactLabel(extracted);
          const sentimentInfo = vc.sentiment ? SENTIMENT_BADGE[vc.sentiment] : null;
          const snippet = vc.transcript ? vc.transcript.slice(0, 120) + (vc.transcript.length > 120 ? "..." : "") : null;
          return (
            <Card key={vc.id} className="border-border bg-card px-4 py-3 transition-all duration-150 hover:shadow-md hover:border-white/20">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{contactName ?? "Voice capture"}</span>
                    {sentimentInfo && <Badge variant={sentimentInfo.variant} className="text-[10px] px-1.5 py-0">{sentimentInfo.label}</Badge>}
                    {vc.manager_attention && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Flagged</Badge>}
                  </div>
                  {snippet && <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">"{snippet}"</p>}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{timeAgo(vc.created_at)}</span>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// ─── Competitive Intel ──────────────────────────────────────────

function CompetitiveIntelSection({ mentions }: { mentions: CompetitiveMention[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; latest: CompetitiveMention }>();
    for (const m of mentions) {
      const existing = map.get(m.competitor_name);
      if (!existing || new Date(m.created_at) > new Date(existing.latest.created_at)) {
        map.set(m.competitor_name, { count: (existing?.count ?? 0) + 1, latest: m });
      } else {
        map.set(m.competitor_name, { ...existing, count: existing.count + 1 });
      }
    }
    return [...map.entries()].sort(([, a], [, b]) => b.count - a.count);
  }, [mentions]);

  if (mentions.length === 0) return null;

  return (
    <section aria-label="Competitive intelligence">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Swords className="h-4 w-4" aria-hidden />Competitive Intel
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">7d</Badge>
      </h2>
      <Card className="border-border bg-card divide-y divide-white/5">
        {grouped.map(([name, { count, latest }]) => (
          <div key={name} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">{name}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {count} mention{count > 1 ? "s" : ""}
              </Badge>
            </div>
            {latest.context && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2 italic">"{latest.context}"</p>
            )}
          </div>
        ))}
      </Card>
    </section>
  );
}

// ─── Knowledge Gaps ─────────────────────────────────────────────

function KnowledgeGapsSection({ gaps }: { gaps: KnowledgeGap[] }) {
  if (gaps.length === 0) return null;

  return (
    <section aria-label="Knowledge gaps">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <HelpCircle className="h-4 w-4" aria-hidden />Knowledge Gaps
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{gaps.length}</Badge>
      </h2>
      <Card className="border-border bg-card divide-y divide-white/5">
        {gaps.map((gap) => (
          <div key={gap.id} className="px-4 py-3">
            <p className="text-sm text-foreground">{gap.question}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{timeAgo(gap.created_at)}</p>
          </div>
        ))}
      </Card>
      <Link to="/admin" className="mt-2 inline-block text-xs text-muted-foreground hover:text-qep-orange transition-colors">
        Manage in Admin
      </Link>
    </section>
  );
}

// ─── Quick Actions ──────────────────────────────────────────────

function QuickActionsBar() {
  const navigate = useNavigate();

  const actions = [
    { label: "Record Voice", icon: Mic, path: "/voice", accent: "bg-qep-orange/10 text-qep-orange" },
    { label: "Ask AI", icon: MessageSquare, path: "/chat", accent: "bg-violet-500/10 text-violet-400" },
    { label: "Scan Equipment", icon: Camera, path: "/crm", accent: "bg-blue-400/10 text-blue-400" },
    { label: "View Pipeline", icon: TrendingUp, path: "/crm/deals", accent: "bg-emerald-500/10 text-emerald-400" },
  ];

  return (
    <section aria-label="Quick actions">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Zap className="h-4 w-4" aria-hidden />Quick Actions
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => navigate(a.path)}
            className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-4 py-4 transition-all duration-150 hover:shadow-md hover:border-white/20"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${a.accent}`}>
              <a.icon className="h-5 w-5" aria-hidden />
            </div>
            <span className="text-xs font-medium text-foreground group-hover:text-qep-orange transition-colors">{a.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ─── CRM Navigation ─────────────────────────────────────────────

function CrmNavGrid({ isAdmin }: { isAdmin: boolean }) {
  const sections = [
    { label: "Activities", href: "/crm/activities", icon: "activity" },
    { label: "Deals", href: "/crm/deals", icon: "deals" },
    { label: "Contacts", href: "/crm/contacts", icon: "contacts" },
    { label: "Companies", href: "/crm/companies", icon: "companies" },
  ];

  const adminSections = [
    { label: "Sequences", href: "/crm/sequences" },
    { label: "Templates", href: "/crm/templates" },
    { label: "Duplicates", href: "/crm/duplicates" },
  ];

  return (
    <section aria-label="CRM navigation">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        CRM Modules
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {sections.map((s) => (
          <Link key={s.href} to={s.href} className="group">
            <Card className="flex items-center gap-3 border-border bg-card px-4 py-3 transition-all hover:shadow-md hover:border-white/20">
              <span className="text-sm font-medium text-foreground group-hover:text-qep-orange transition-colors">{s.label}</span>
              <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground group-hover:translate-x-0.5 transition-transform" aria-hidden />
            </Card>
          </Link>
        ))}
      </div>
      {isAdmin && (
        <div className="grid grid-cols-3 gap-3 mt-3">
          {adminSections.map((s) => (
            <Link key={s.href} to={s.href} className="group">
              <Card className="flex items-center gap-3 border-border bg-card px-4 py-2.5 transition-all hover:shadow-md hover:border-white/20">
                <span className="text-xs font-medium text-muted-foreground group-hover:text-qep-orange transition-colors">{s.label}</span>
                <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" aria-hidden />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────

function CommandCenterSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div>
        <div className="h-7 bg-muted rounded w-64 mb-2" />
        <div className="h-4 bg-muted rounded w-96" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="h-2.5 bg-muted rounded w-20" />
            <div className="h-7 bg-muted rounded w-16" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-4 bg-muted rounded w-32 mb-3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="h-4 bg-muted rounded w-48" />
            <div className="h-3 bg-muted rounded w-72" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export function CrmHubPage({ userRole, userId, userName, userEmail }: CrmHubPageProps) {
  const queryClient = useQueryClient();
  const isElevated = ["admin", "manager", "owner"].includes(userRole);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["crm-command-center", userId],
    queryFn: () => fetchCommandCenterData(userId, isElevated),
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
    () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    [],
  );

  const handleAcknowledgeAlert = useCallback(async (alertId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    await db.from("anomaly_alerts").update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
    }).eq("id", alertId);
    void queryClient.invalidateQueries({ queryKey: ["crm-command-center"] });
  }, [userId, queryClient]);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto min-h-full">
        <CommandCenterSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 max-w-6xl mx-auto min-h-full">
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <AlertTriangle className="h-8 w-8 text-qep-orange" />
          <p className="text-sm text-foreground font-medium">Could not load your command center</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  const subtitleColorMap = { urgent: "text-red-400", active: "text-qep-orange", calm: "text-emerald-400" };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto min-h-full">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {greeting}, {firstName}.
          </h1>
          <span className="text-xs text-muted-foreground tabular-nums">{todayFormatted}</span>
        </div>
        {subtitle && (
          <p className={`mt-1.5 text-sm font-medium ${subtitleColorMap[subtitle.tone]}`}>
            {subtitle.text}
          </p>
        )}
      </div>

      {/* ── Metrics ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <MetricCard
          label="Pipeline"
          value={formatCurrency(data.totalPipelineValue)}
          subValue={`${formatCurrency(data.weightedPipelineValue)} weighted`}
          icon={DollarSign}
          href="/crm/deals"
          accent="orange"
        />
        <MetricCard
          label="Open Deals"
          value={String(data.openDealCount)}
          subValue={data.dealsClosingThisWeek.length > 0 ? `${data.dealsClosingThisWeek.length} closing this week` : undefined}
          icon={BarChart3}
          href="/crm/deals"
          accent="blue"
        />
        <MetricCard
          label="Avg AI Score"
          value={data.avgDealScore != null ? String(data.avgDealScore) : "—"}
          subValue={data.scoredDeals.length > 0 ? `${data.scoredDeals.length} deals scored` : "Scoring pending"}
          icon={Brain}
          accent="purple"
        />
        <MetricCard
          label="Activity (7d)"
          value={String(data.activitiesThisWeek)}
          subValue={data.voiceCaptures.length > 0 ? `${data.voiceCaptures.length} voice notes` : undefined}
          icon={BarChart3}
          href="/crm/activities"
          accent="green"
        />
      </div>

      {/* ── Anomaly Alerts ─────────────────────────────────────── */}
      <AnomalyAlertsBanner
        alerts={data.anomalyAlerts}
        onAcknowledge={handleAcknowledgeAlert}
      />

      {/* ── Action Queue ───────────────────────────────────────── */}
      <div className="mb-8">
        <ActionQueueSection
          overdueFollowUps={data.overdueFollowUps}
          todayFollowUps={data.todayFollowUps}
          weekFollowUps={data.weekFollowUps}
        />
      </div>

      {/* ── Two-column: Deal Intelligence + Intelligence Feed ─── */}
      <div className="grid gap-8 lg:grid-cols-2 mb-8">
        <div className="space-y-8">
          <DealScoreBoard deals={data.scoredDeals} />
          <MorningBriefingSection briefing={data.briefing} onGenerated={() => refetch()} />
        </div>
        <div className="space-y-8">
          <FieldIntelligenceSection voiceCaptures={data.voiceCaptures} />
          {isElevated && <CompetitiveIntelSection mentions={data.competitiveMentions} />}
          {isElevated && <KnowledgeGapsSection gaps={data.knowledgeGaps} />}
        </div>
      </div>

      {/* ── Quick Actions ──────────────────────────────────────── */}
      <div className="mb-8">
        <QuickActionsBar />
      </div>

      {/* ── CRM Navigation ─────────────────────────────────────── */}
      <CrmNavGrid isAdmin={isElevated} />
    </div>
  );
}
