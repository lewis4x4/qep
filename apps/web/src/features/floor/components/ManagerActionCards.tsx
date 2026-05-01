/**
 * ManagerActionCards — rich 02-Action cards for the iron_manager home.
 *
 * Replaces the generic three-tile RoleAction strip when the role is
 * iron_manager. Composes counts + urgency text from the same data
 * already returned by useIronManagerData (demos, trade_valuations,
 * crm_deals margin flags, pipelineDeals) — no new tables, no new edge
 * functions, no new seed.
 *
 * Three cards, mirroring the AdvisorActionCards pattern:
 *   1. OPEN APPROVALS — orange hero, count + total trade $ + high-
 *      value urgency + over-48h urgency.
 *   2. NEW QUOTE — pure action, ⌘N hint.
 *   3. NUDGE REP — stalled-deal count + $ at risk + reps with idle
 *      pipeline >= 5 days.
 */
import { Link } from "react-router-dom";
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  FileText,
  Mic,
  Users,
} from "lucide-react";
import { useIronManagerData } from "@/features/dashboards/hooks/useDashboardData";

const HIGH_VALUE_THRESHOLD_CENTS = 250_000_00;
const STALE_DAY_THRESHOLD = 5;
const OVER_48H_MS = 48 * 60 * 60 * 1000;

function formatUsd(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "$0";
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${Math.round(dollars).toLocaleString()}`;
}

function dollarsToCents(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

interface ApprovalStats {
  count: number;
  totalCents: number;
  highValueCount: number;
  over48hCount: number;
}

interface NudgeStats {
  stalledCount: number;
  atRiskCents: number;
  repsAffected: number;
}

type PendingDemoRow = {
  id: string;
  created_at: string | null;
};

type PendingTradeRow = {
  id: string;
  preliminary_value: number | null;
};

type MarginFlagRow = {
  id: string;
};

type NudgeDealRow = {
  assigned_rep_id: string | null;
  amount: number | string | null;
  last_activity_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePendingDemos(rows: unknown): PendingDemoRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePendingDemo).filter((row): row is PendingDemoRow => row !== null);
}

function normalizePendingDemo(value: unknown): PendingDemoRow | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    created_at: nullableString(value.created_at),
  };
}

function normalizePendingTrades(rows: unknown): PendingTradeRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePendingTrade).filter((row): row is PendingTradeRow => row !== null);
}

function normalizePendingTrade(value: unknown): PendingTradeRow | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    preliminary_value: numberValue(value.preliminary_value),
  };
}

function normalizeMarginFlags(rows: unknown): MarginFlagRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeMarginFlag).filter((row): row is MarginFlagRow => row !== null);
}

function normalizeMarginFlag(value: unknown): MarginFlagRow | null {
  return isRecord(value) && typeof value.id === "string" ? { id: value.id } : null;
}

function normalizeNudgeDeals(rows: unknown): NudgeDealRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeNudgeDeal).filter((row): row is NudgeDealRow => row !== null);
}

function normalizeNudgeDeal(value: unknown): NudgeDealRow | null {
  if (!isRecord(value)) return null;
  return {
    assigned_rep_id: nullableString(value.assigned_rep_id),
    amount:
      typeof value.amount === "string"
        ? value.amount
        : numberValue(value.amount),
    last_activity_at: nullableString(value.last_activity_at),
  };
}

export function ManagerActionCards() {
  const { data, isLoading, isError } = useIronManagerData();

  const approvalStats: ApprovalStats = useMemo(() => {
    const demos = normalizePendingDemos(data?.pendingDemos ?? []);
    const trades = normalizePendingTrades(data?.pendingTrades ?? []);
    const margins = normalizeMarginFlags(data?.marginFlags ?? []);

    const count = demos.length + trades.length + margins.length;

    let totalCents = 0;
    let highValueCount = 0;
    for (const trade of trades) {
      const cents = dollarsToCents(trade.preliminary_value);
      totalCents += cents;
      if (cents >= HIGH_VALUE_THRESHOLD_CENTS) highValueCount += 1;
    }

    const now = Date.now();
    let over48hCount = 0;
    for (const demo of demos) {
      if (!demo.created_at) continue;
      const t = new Date(demo.created_at).getTime();
      if (Number.isFinite(t) && now - t >= OVER_48H_MS) over48hCount += 1;
    }

    return { count, totalCents, highValueCount, over48hCount };
  }, [data]);

  const nudgeStats: NudgeStats = useMemo(() => {
    const deals = normalizeNudgeDeals(data?.pipelineDeals ?? []);
    const cutoff = Date.now() - STALE_DAY_THRESHOLD * 86_400_000;
    let stalledCount = 0;
    let atRiskCents = 0;
    const stalledReps = new Set<string>();
    for (const deal of deals) {
      const last = deal.last_activity_at
        ? new Date(deal.last_activity_at).getTime()
        : 0;
      if (!Number.isFinite(last) || last >= cutoff) continue;
      stalledCount += 1;
      atRiskCents += dollarsToCents(deal.amount);
      if (deal.assigned_rep_id) stalledReps.add(deal.assigned_rep_id);
    }
    return {
      stalledCount,
      atRiskCents,
      repsAffected: stalledReps.size,
    };
  }, [data]);

  const approvalsHero = isLoading
    ? "—"
    : isError
      ? "!"
      : String(approvalStats.count);

  const approvalUrgency = isLoading
    ? "Loading approvals…"
    : isError
      ? "Couldn't load approvals."
      : approvalStats.highValueCount > 0 || approvalStats.over48hCount > 0
        ? [
            approvalStats.highValueCount > 0
              ? `${approvalStats.highValueCount} high-value`
              : null,
            approvalStats.over48hCount > 0
              ? `${approvalStats.over48hCount} over 48h`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : approvalStats.count > 0
          ? "Inside SLA — clear them while it's calm"
          : "Queue empty — nothing waiting on you";

  const nudgeHero = isLoading
    ? "—"
    : isError
      ? "!"
      : String(nudgeStats.stalledCount);

  const nudgeUrgency = isLoading
    ? "Loading pipeline…"
    : isError
      ? "Couldn't load deal pressure."
      : nudgeStats.stalledCount > 0
        ? `${nudgeStats.repsAffected} rep${nudgeStats.repsAffected === 1 ? "" : "s"} with deals idle ${STALE_DAY_THRESHOLD}+d`
        : "No reps drifting — pipeline is moving";

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {/* Card 1 — OPEN APPROVALS (orange hero) */}
      <Link
        to="/qrm/approvals"
        className="group relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-[#f28a07]/45 bg-[#f28a07]/10 p-5 transition-all hover:border-[#f28a07]/65 hover:bg-[#f28a07]/15"
        aria-label="Open approvals"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f28a07] text-[#15100a]">
              <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#f6a53a]">
              Open approvals
            </span>
          </span>
          <ArrowRight
            className="h-4 w-4 text-[#f6a53a] transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span className="font-kpi text-5xl font-extrabold leading-none tabular-nums text-white">
            {approvalsHero}
          </span>
          {approvalStats.totalCents > 0 ? (
            <span className="pb-1 font-kpi text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f6a53a]">
              {formatUsd(approvalStats.totalCents)} on trades
            </span>
          ) : null}
        </div>
        <p className="text-xs text-slate-200">{approvalUrgency}</p>
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
        <p className="mt-3 text-sm text-slate-200">Cover for a rep or build manager-led</p>
        <p className="mt-auto inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Mic className="h-3 w-3" aria-hidden="true" />
          Dictate instead → /voice-quote
        </p>
      </Link>

      {/* Card 3 — NUDGE REP */}
      <Link
        to="/qrm/deals?stalled=true"
        className="group flex flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:border-white/20 hover:bg-white/[0.07]"
        aria-label="Nudge rep"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/25 text-slate-200">
              <Users className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
              Nudge rep
            </span>
          </span>
          <ArrowRight
            className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#f28a07]"
            aria-hidden="true"
          />
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span className="font-kpi text-3xl font-extrabold leading-none tabular-nums text-white">
            {nudgeHero}
          </span>
          <span className="pb-1 text-xs font-semibold text-slate-400">stalled deals</span>
        </div>
        <p className="font-kpi text-base font-extrabold text-[#f6a53a]">
          {nudgeStats.atRiskCents > 0 ? formatUsd(nudgeStats.atRiskCents) : "$0"}{" "}
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            at risk
          </span>
        </p>
        <p className="mt-auto inline-flex items-center gap-1 text-[11px] text-amber-300">
          {nudgeStats.stalledCount > 0 ? (
            <>
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {nudgeUrgency}
            </>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <Activity className="h-3 w-3" aria-hidden="true" /> {nudgeUrgency}
            </span>
          )}
        </p>
      </Link>
    </div>
  );
}
