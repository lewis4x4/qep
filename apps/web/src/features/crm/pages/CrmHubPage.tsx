import { useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Brain,
  Building2,
  Camera,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Flame,
  HelpCircle,
  LayoutGrid,
  MessageSquare,
  Mic,
  Snowflake,
  Swords,
  ThermometerSun,
  TrendingUp,
  UsersRound,
  Zap,
  MessageCircleMore,
  Activity,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { crmSupabase } from "../lib/crm-supabase";
import type { UserRole } from "@/lib/database.types";
import { CrmPageHeader } from "../components/CrmPageHeader";
import { getIronRole } from "../lib/iron-roles";

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

interface CrmStats {
  openDeals: number;
  contacts: number;
  companies: number;
  recentActivities: number;
}

interface CrmIntelData {
  stats: CrmStats;
  deals: EnrichedDeal[];
  totalPipelineValue: number;
  weightedPipelineValue: number;
  scoredDeals: ScoredDeal[];
  avgDealScore: number | null;
  anomalyAlerts: AnomalyAlert[];
  competitiveMentions: CompetitiveMention[];
  knowledgeGaps: KnowledgeGap[];
  hotDeals: number;
  warmDeals: number;
  coldDeals: number;
  atRiskDeals: number;
}

// ─── Helpers ────────────────────────────────────────────────────

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

const HEAT_CONFIG = {
  hot: { label: "Hot", icon: Flame, color: "text-orange-400", bg: "bg-orange-500/15 border-orange-500/30" },
  warm: { label: "Warm", icon: ThermometerSun, color: "text-yellow-400", bg: "bg-yellow-500/15 border-yellow-500/30" },
  cold: { label: "Cold", icon: Snowflake, color: "text-blue-400", bg: "bg-blue-400/15 border-blue-400/30" },
  at_risk: { label: "At Risk", icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/15 border-red-500/30" },
} as const;

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-l-red-500 bg-red-500/5",
  high: "border-l-orange-500 bg-orange-500/5",
  medium: "border-l-yellow-500 bg-yellow-500/5",
  low: "border-l-blue-400 bg-blue-400/5",
};

// ─── Data Fetching ──────────────────────────────────────────────

async function fetchCrmIntelData(isElevated: boolean): Promise<CrmIntelData> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const db = supabase;

  const [
    dealsResult,
    contactsCount,
    companiesCount,
    activitiesCount,
    alertsResult,
    scoredDealsResult,
    competitiveResult,
    gapsResult,
  ] = await Promise.all([
    crmSupabase
      .from("crm_deals_weighted")
      .select("id, name, stage_name, stage_probability, amount, weighted_amount, primary_contact_id, company_id, expected_close_on, next_follow_up_at, last_activity_at, created_at")
      .is("closed_at", null),
    crmSupabase.from("crm_contacts").select("id", { count: "exact", head: true }),
    crmSupabase.from("crm_companies").select("id", { count: "exact", head: true }),
    crmSupabase
      .from("crm_activities")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("occurred_at", weekAgo.toISOString()),
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

  // Enrich deals with contact/company names
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

  const totalPipelineValue = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const weightedPipelineValue = deals.reduce((sum, d) => sum + (d.weighted_amount ?? 0), 0);

  const scored = (scoredDealsResult.data ?? []) as ScoredDeal[];
  const avgDealScore = scored.length > 0
    ? Math.round(scored.reduce((s, d) => s + (d.deal_score ?? 0), 0) / scored.length)
    : null;

  const heatCounts = { hot: 0, warm: 0, cold: 0, at_risk: 0 };
  for (const d of deals) heatCounts[d.heat]++;

  return {
    stats: {
      openDeals: deals.length,
      contacts: contactsCount.count ?? 0,
      companies: companiesCount.count ?? 0,
      recentActivities: activitiesCount.count ?? 0,
    },
    deals,
    totalPipelineValue,
    weightedPipelineValue,
    scoredDeals: scored,
    avgDealScore,
    anomalyAlerts: (alertsResult.data ?? []) as AnomalyAlert[],
    competitiveMentions: (competitiveResult.data ?? []) as CompetitiveMention[],
    knowledgeGaps: (gapsResult.data ?? []) as KnowledgeGap[],
    ...heatCounts,
    hotDeals: heatCounts.hot,
    warmDeals: heatCounts.warm,
    coldDeals: heatCounts.cold,
    atRiskDeals: heatCounts.at_risk,
  };
}

// ─── Stat Card ──────────────────────────────────────────────────

function StatCard({ label, value, href, icon: Icon, accent }: {
  label: string;
  value: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <Link to={href} className="group">
      <Card className="border-border bg-card px-4 py-3 transition-all duration-150 group-hover:shadow-md group-hover:border-white/20">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ?? "text-qep-orange"}`}>{value}</p>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
            <Icon className={`h-5 w-5 ${accent ?? "text-qep-orange"}`} aria-hidden />
          </div>
        </div>
      </Card>
    </Link>
  );
}

// ─── Pipeline Health Bar ────────────────────────────────────────

function PipelineHealthBar({ hot, warm, cold, atRisk, total }: {
  hot: number; warm: number; cold: number; atRisk: number; total: number;
}) {
  if (total === 0) return null;
  const pct = (n: number) => Math.max(0, Math.round((n / total) * 100));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline Health</h3>
        <span className="text-xs text-muted-foreground">{total} deals</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-white/5">
        {hot > 0 && <div className="bg-orange-500 transition-all" style={{ width: `${pct(hot)}%` }} />}
        {warm > 0 && <div className="bg-yellow-500 transition-all" style={{ width: `${pct(warm)}%` }} />}
        {cold > 0 && <div className="bg-blue-400 transition-all" style={{ width: `${pct(cold)}%` }} />}
        {atRisk > 0 && <div className="bg-red-500 transition-all" style={{ width: `${pct(atRisk)}%` }} />}
      </div>
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        {[
          { label: "Hot", count: hot, color: "bg-orange-500" },
          { label: "Warm", count: warm, color: "bg-yellow-500" },
          { label: "Cold", count: cold, color: "bg-blue-400" },
          { label: "At Risk", count: atRisk, color: "bg-red-500" },
        ].filter((s) => s.count > 0).map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${s.color}`} />
            {s.label} ({s.count})
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Anomaly Alerts ─────────────────────────────────────────────

function AnomalyAlertsBanner({
  alerts, onAcknowledge,
}: {
  alerts: AnomalyAlert[];
  onAcknowledge: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (alerts.length === 0) return null;

  return (
    <section aria-label="AI alerts">
      <button onClick={() => setExpanded((v) => !v)} className="mb-3 flex w-full items-center gap-2 text-left">
        <AlertTriangle className="h-4 w-4 text-red-400" aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-red-400">AI Alerts</h2>
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">{alerts.length}</Badge>
        <ChevronDown className={`h-3.5 w-3.5 ml-auto text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div key={alert.id} className={`flex items-start gap-3 rounded-lg border border-border/60 border-l-[3px] px-4 py-3 ${SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.medium}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{alert.title}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize">{alert.alert_type.replace(/_/g, " ")}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-muted-foreground tabular-nums">{timeAgo(alert.created_at)}</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => onAcknowledge(alert.id)}>
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

// ─── AI Deal Scoreboard ─────────────────────────────────────────

function DealScoreBoard({ deals }: { deals: ScoredDeal[] }) {
  if (deals.length === 0) {
    return (
      <section aria-label="AI deal scores">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Brain className="h-4 w-4" aria-hidden />AI Deal Scores
        </h2>
        <Card className="border-dashed border-border bg-card p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/10">
              <Brain className="h-5 w-5 text-violet-400" aria-hidden />
            </div>
            <p className="text-sm font-medium text-foreground">Deal scoring pending</p>
            <p className="text-xs text-muted-foreground">AI analyzes activity, stage velocity, and patterns to score your deals.</p>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label="AI deal scores">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Brain className="h-4 w-4" aria-hidden />AI Deal Scores
        </h2>
        <Link to="/crm/deals" className="text-xs text-muted-foreground hover:text-qep-orange transition-colors">View all</Link>
      </div>
      <div className="space-y-2">
        {deals.map((deal) => {
          const score = deal.deal_score ?? 0;
          const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-yellow-400" : "text-red-400";
          const barColor = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-yellow-500" : "bg-red-500";
          const factors = deal.deal_score_factors ?? {};
          const factorEntries = Object.entries(factors).sort(([, a], [, b]) => b - a).slice(0, 3);

          return (
            <Link key={deal.id} to={`/crm/deals/${deal.id}`} className="block group">
              <Card className="border-border bg-card px-4 py-3 transition-all duration-150 hover:shadow-md hover:border-white/20">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground group-hover:text-qep-orange transition-colors truncate">{deal.name}</span>
                      {deal.amount != null && <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatCurrency(deal.amount)}</span>}
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

// ─── Deal Momentum (Top Deals by Value + Heat) ──────────────────

const CRM_MOMENTUM_PEEK = 4;

function DealMomentumSection({ deals }: { deals: EnrichedDeal[] }) {
  const [showAll, setShowAll] = useState(false);

  const topDeals = useMemo(
    () => [...deals].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 8),
    [deals],
  );
  if (topDeals.length === 0) return null;

  const visibleDeals = showAll ? topDeals : topDeals.slice(0, CRM_MOMENTUM_PEEK);
  const hasMore = topDeals.length > CRM_MOMENTUM_PEEK;

  return (
    <section aria-label="Deal momentum">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-4 w-4" aria-hidden />Deal Momentum
        </h2>
        <Link to="/crm/deals" className="text-xs text-muted-foreground hover:text-qep-orange transition-colors">All deals</Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {visibleDeals.map((deal) => {
          const heatCfg = HEAT_CONFIG[deal.heat];
          const HeatIcon = heatCfg.icon;
          return (
            <Link key={deal.id} to={`/crm/deals/${deal.id}`} className="group">
              <Card className="h-full border-border bg-card p-4 transition-all duration-150 hover:shadow-md hover:border-white/20">
                <div className="flex items-start justify-between mb-2">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${heatCfg.bg} ${heatCfg.color}`}>
                    <HeatIcon className="h-3 w-3" aria-hidden />{heatCfg.label}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-sm font-semibold text-foreground truncate group-hover:text-qep-orange transition-colors">{deal.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground truncate">
                  {deal.stage_name}{deal.contactName ? ` · ${deal.contactName}` : ""}
                </p>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-lg font-bold tabular-nums text-foreground">
                    {deal.amount != null ? formatCurrency(deal.amount) : "—"}
                  </span>
                  {deal.last_activity_at && <span className="text-[10px] text-muted-foreground">{timeAgo(deal.last_activity_at)}</span>}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
      {hasMore && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/40 bg-white/[0.02] px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-white/20"
        >
          {showAll ? "Show less" : `Show ${topDeals.length - CRM_MOMENTUM_PEEK} more deals`}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
        </button>
      )}
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
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Swords className="h-4 w-4" aria-hidden />Competitive Intel
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">7d</Badge>
      </h2>
      <Card className="border-border bg-card divide-y divide-white/5">
        {grouped.map(([name, { count, latest }]) => (
          <div key={name} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">{name}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{count} mention{count > 1 ? "s" : ""}</Badge>
            </div>
            {latest.context && <p className="mt-1 text-xs text-muted-foreground line-clamp-2 italic">"{latest.context}"</p>}
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
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
      <Link to="/admin" className="mt-2 inline-block text-xs text-muted-foreground hover:text-qep-orange transition-colors">Manage in Admin</Link>
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
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Actions</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {actions.map((a) => (
          <button key={a.label} onClick={() => navigate(a.path)} className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-4 py-4 transition-all duration-150 hover:shadow-md hover:border-white/20">
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

// ─── QRM Navigation ─────────────────────────────────────────────

interface SectionCardDef {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PRIMARY_SECTIONS: SectionCardDef[] = [
  { label: "Activities", description: "Track calls, emails, tasks, and follow-ups.", href: "/crm/activities", icon: MessageCircleMore },
  { label: "Deals", description: "View pipeline, stages, and weighted revenue.", href: "/crm/deals", icon: LayoutGrid },
  { label: "Contacts", description: "Manage customer contacts and relationships.", href: "/crm/contacts", icon: UsersRound },
  { label: "Companies", description: "Organize accounts and company records.", href: "/crm/companies", icon: Building2 },
];


function CrmNavGrid() {
  return (
    <section aria-label="QRM modules">
      <div className="grid gap-3 sm:grid-cols-2">
        {PRIMARY_SECTIONS.map((s) => (
          <Link key={s.href} to={s.href} className="group">
            <Card className="flex items-center gap-4 border-border bg-card px-5 py-4 transition-shadow duration-150 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-qep-orange min-h-[72px]">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-qep-orange/10">
                <s.icon className="h-5 w-5 text-qep-orange" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{s.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{s.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────

function CrmSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div>
        <div className="h-7 bg-muted rounded w-40 mb-2" />
        <div className="h-4 bg-muted rounded w-80" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="h-2.5 bg-muted rounded w-20" />
            <div className="h-7 bg-muted rounded w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-32 mb-3" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="h-4 bg-muted rounded w-48" />
              <div className="h-2 bg-muted rounded w-full" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-32 mb-3" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="h-4 bg-muted rounded w-40" />
              <div className="h-3 bg-muted rounded w-56" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export function CrmHubPage({ userRole, userId }: CrmHubPageProps) {
  const queryClient = useQueryClient();
  const isElevated = ["admin", "manager", "owner"].includes(userRole);
  const ironRole = getIronRole(userRole);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["crm-intel", userId],
    queryFn: () => fetchCrmIntelData(isElevated),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const handleAcknowledgeAlert = useCallback(async (alertId: string) => {
    const db = supabase;
    await db.from("anomaly_alerts").update({
      acknowledged: true,
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
    }).eq("id", alertId);
    void queryClient.invalidateQueries({ queryKey: ["crm-intel"] });
  }, [userId, queryClient]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        <CrmSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <AlertTriangle className="h-8 w-8 text-qep-orange" />
          <p className="text-sm text-foreground font-medium">Could not load QRM intelligence</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <CrmPageHeader
          title="QRM Intelligence"
          subtitle="AI-powered pipeline analytics, deal scoring, and competitive intelligence"
        />
        <Badge variant="outline" className="shrink-0 border-qep-orange/30 text-qep-orange">
          {ironRole.display}
        </Badge>
      </div>

      {/* ── Pipeline Stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Pipeline" value={formatCurrency(data.totalPipelineValue)} href="/crm/deals" icon={DollarSign} accent="text-qep-orange" />
        <StatCard label="Open Deals" value={String(data.stats.openDeals)} href="/crm/deals" icon={BarChart3} accent="text-blue-400" />
        <StatCard label="Avg AI Score" value={data.avgDealScore != null ? String(data.avgDealScore) : "—"} href="/crm/deals" icon={Brain} accent="text-violet-400" />
        <StatCard label="Activity (7d)" value={String(data.stats.recentActivities)} href="/crm/activities" icon={Activity} accent="text-emerald-400" />
      </div>

      {/* ── Pipeline Health Bar ─────────────────────────────────── */}
      <PipelineHealthBar
        hot={data.hotDeals}
        warm={data.warmDeals}
        cold={data.coldDeals}
        atRisk={data.atRiskDeals}
        total={data.stats.openDeals}
      />

      {/* ── Anomaly Alerts ─────────────────────────────────────── */}
      {data.anomalyAlerts.length > 0 && (
        <AnomalyAlertsBanner alerts={data.anomalyAlerts} onAcknowledge={handleAcknowledgeAlert} />
      )}

      {/* ── Quick Actions ──────────────────────────────────────── */}
      <QuickActionsBar />

      {/* ── Two-column: AI Scores + Intelligence ───────────────── */}
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-8">
          <DealScoreBoard deals={data.scoredDeals} />
        </div>
        <div className="space-y-8">
          {isElevated && <CompetitiveIntelSection mentions={data.competitiveMentions} />}
          {isElevated && <KnowledgeGapsSection gaps={data.knowledgeGaps} />}
        </div>
      </div>

      {/* ── QRM Navigation ─────────────────────────────────────── */}
      <CrmNavGrid />

      {/* ── Deal Momentum ──────────────────────────────────────── */}
      <DealMomentumSection deals={data.deals} />
    </div>
  );
}
