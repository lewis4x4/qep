/**
 * AdvisorActionCards — rich 02-Action cards for the iron_advisor home.
 *
 * Replaces the generic three-tile RoleAction strip when the role is
 * iron_advisor. Composes counts + urgency text from the same data
 * sources already in use by ActionItemsWidget (follow_up_touchpoints
 * → cadences → qrm_deals) and MyQuotesByStatusWidget (qrm_deals
 * filtered to assigned_rep_id = me) — no new tables, no new edge
 * functions, no new seed.
 *
 * Three cards, exactly per the role-home spec:
 *   1. TODAY'S FOLLOW-UPS — orange hero, count + overdue/due-today
 *      urgency + tied-up deal $.
 *   2. NEW QUOTE — pure action, no hero number, "Start from voice or
 *      scenario" subtext.
 *   3. MY PIPELINE — count of active deals, total $ value,
 *      "{n} at decision stage" urgency.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  FileText,
  Mic,
  Target,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

interface FollowUpStats {
  dueTodayCount: number;
  overdueCount: number;
  tiedUpValueCents: number;
  stalest: { customer: string; daysStale: number } | null;
}

interface PipelineStats {
  activeDealCount: number;
  totalValueCents: number;
  decisionCount: number;
}

function formatUsd(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "$0";
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${Math.round(dollars).toLocaleString()}`;
}

async function fetchFollowUpStats(userId: string): Promise<FollowUpStats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const { data, error } = await supabase
    .from("follow_up_touchpoints")
    .select(
      `
      id, scheduled_date, status,
      cadence:follow_up_cadences!inner (
        deal_id, assigned_to,
        deal:qrm_deals (
          id, name, amount,
          company:qrm_companies ( name, dba )
        )
      )
    `,
    )
    .in("status", ["pending", "scheduled"])
    .eq("cadence.assigned_to", userId)
    .limit(80);

  if (error) throw new Error(error.message);

  const now = Date.now();
  let dueToday = 0;
  let overdue = 0;
  let tiedUp = 0;
  let stalest: FollowUpStats["stalest"] = null;

  for (const row of normalizeFollowUpRows(data ?? [])) {
    const scheduledMs = new Date(row.scheduledDate).getTime();

    if (scheduledMs < todayStart.getTime()) {
      overdue += 1;
      const daysStale = Math.floor((now - scheduledMs) / 86_400_000);
      if (!stalest || daysStale > stalest.daysStale) stalest = { customer: row.customer, daysStale };
    } else if (scheduledMs < tomorrowStart.getTime()) {
      dueToday += 1;
    }
    tiedUp += row.amountCents;
  }

  return {
    dueTodayCount: dueToday,
    overdueCount: overdue,
    tiedUpValueCents: tiedUp,
    stalest,
  };
}

interface NormalizedFollowUpRow {
  scheduledDate: string;
  amountCents: number;
  customer: string;
}

function normalizeFollowUpRows(rows: unknown[]): NormalizedFollowUpRow[] {
  return rows.map(normalizeFollowUpRow).filter((row): row is NormalizedFollowUpRow => row !== null);
}

function normalizeFollowUpRow(row: unknown): NormalizedFollowUpRow | null {
  if (!isRecord(row)) return null;
  const scheduledDate = nullableString(row.scheduled_date);
  if (!scheduledDate || !Number.isFinite(new Date(scheduledDate).getTime())) return null;
  const cadence = firstRecord(row.cadence);
  const deal = firstRecord(cadence?.deal);
  const company = firstRecord(deal?.company);
  const customer = nullableString(company?.dba) ?? nullableString(company?.name) ?? nullableString(deal?.name) ?? "Customer";
  return {
    scheduledDate,
    amountCents: parseAmountCents(deal?.amount),
    customer,
  };
}

function parseAmountCents(value: unknown): number {
  if (value == null) return 0;
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DECISION_STAGE_PATTERN = /(decision|negotiat|proposal|quote)/i;

async function fetchPipelineStats(userId: string): Promise<PipelineStats> {
  const [stagesRes, dealsRes] = await Promise.all([
    supabase.from("qrm_deal_stages").select("id, name"),
    supabase
      .from("qrm_deals")
      .select("id, amount, stage_id, closed_at")
      .eq("assigned_rep_id", userId)
      .is("deleted_at", null)
      .is("closed_at", null),
  ]);

  if (stagesRes.error) throw new Error(stagesRes.error.message);
  if (dealsRes.error) throw new Error(dealsRes.error.message);

  const decisionStageIds = new Set(
    (stagesRes.data ?? [])
      .filter((stage) => DECISION_STAGE_PATTERN.test(String(stage.name ?? "")))
      .map((stage) => stage.id)
      .filter((stageId): stageId is string => typeof stageId === "string"),
  );

  let totalCents = 0;
  let decisionCount = 0;
  for (const row of dealsRes.data ?? []) {
    totalCents += Math.round(Number(row.amount ?? 0) * 100);
    if (typeof row.stage_id === "string" && decisionStageIds.has(row.stage_id)) {
      decisionCount += 1;
    }
  }

  return {
    activeDealCount: (dealsRes.data ?? []).length,
    totalValueCents: totalCents,
    decisionCount,
  };
}

export function AdvisorActionCards() {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const followUps = useQuery({
    queryKey: ["floor", "advisor-actions", "follow-ups", userId],
    queryFn: () => fetchFollowUpStats(userId),
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const pipeline = useQuery({
    queryKey: ["floor", "advisor-actions", "pipeline", userId],
    queryFn: () => fetchPipelineStats(userId),
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const fu = followUps.data;
  const pl = pipeline.data;

  const followUpHero =
    fu == null ? "—" : String(fu.dueTodayCount + fu.overdueCount);
  const followUpUrgency =
    fu == null
      ? "Loading touchpoints…"
      : fu.overdueCount > 0
        ? `${fu.overdueCount} overdue · ${fu.dueTodayCount} due today`
        : fu.dueTodayCount > 0
          ? `${fu.dueTodayCount} due today`
          : "Caught up — no touchpoints due";

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {/* Card 1 — TODAY'S FOLLOW-UPS (orange hero) */}
      <Link
        to="/qrm/my/reality"
        className="group relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-[#f28a07]/45 bg-[#f28a07]/10 p-5 transition-all hover:border-[#f28a07]/65 hover:bg-[#f28a07]/15"
        aria-label="Today's follow-ups"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f28a07] text-[#15100a]">
              <Target className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#f6a53a]">
              Today's follow-ups
            </span>
          </span>
          <ArrowRight
            className="h-4 w-4 text-[#f6a53a] transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span className="font-kpi text-5xl font-extrabold leading-none tabular-nums text-white">
            {followUpHero}
          </span>
          {fu && fu.tiedUpValueCents > 0 ? (
            <span className="pb-1 font-kpi text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f6a53a]">
              {formatUsd(fu.tiedUpValueCents)} tied up
            </span>
          ) : null}
        </div>
        <p className="text-xs text-slate-200">{followUpUrgency}</p>
        {fu?.stalest ? (
          <p className="mt-auto inline-flex items-center gap-1 text-[11px] text-amber-300">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {fu.stalest.customer} · {fu.stalest.daysStale}d stale
          </p>
        ) : null}
      </Link>

      {/* Card 2 — NEW QUOTE (pure action) */}
      <Link
        to="/quote-v2"
        className="group flex flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:border-white/20 hover:bg-white/[0.07]"
        aria-label="New quote"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/25 text-slate-200">
              <FileText className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
              New quote
            </span>
          </span>
          <ArrowRight
            className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#f28a07]"
            aria-hidden="true"
          />
        </div>
        <p className="mt-3 text-sm text-slate-200">Start from voice or scenario</p>
        <p className="mt-auto inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Mic className="h-3 w-3" aria-hidden="true" />
          Dictate instead → /voice-quote
        </p>
      </Link>

      {/* Card 3 — MY PIPELINE */}
      <Link
        to="/qrm/deals?assigned_to=me"
        className="group flex flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:border-white/20 hover:bg-white/[0.07]"
        aria-label="My pipeline"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/25 text-slate-200">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
              My pipeline
            </span>
          </span>
          <ArrowRight
            className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#f28a07]"
            aria-hidden="true"
          />
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span className="font-kpi text-3xl font-extrabold leading-none tabular-nums text-white">
            {pl == null ? "—" : pl.activeDealCount}
          </span>
          <span className="pb-1 text-xs font-semibold text-slate-400">deals</span>
        </div>
        <p className="font-kpi text-base font-extrabold text-[#f6a53a]">
          {pl == null ? "—" : formatUsd(pl.totalValueCents)}{" "}
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            open value
          </span>
        </p>
        <p className="mt-auto text-[11px] text-amber-300">
          {pl && pl.decisionCount > 0
            ? `${pl.decisionCount} at decision stage`
            : "Pipeline steady — no decision-stage pressure"}
        </p>
      </Link>
    </div>
  );
}
