/**
 * AdvisorActionCards — quote-first action surface for the iron_advisor home.
 *
 * The advisor home must make quote launch unmistakably primary while keeping
 * follow-ups and pipeline visible as secondary selling signals. This is the
 * CTA / quick-tool surface (quote, voice quote, voice note, service request,
 * add customer), not the `sales.action-items` widget. Stats come from the
 * shared QRM-backed advisor-home-stats module so future briefing surfaces
 * can reuse the same source of truth without duplicating Supabase logic.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  FileText,
  MapPinned,
  Mic,
  PlusCircle,
  Radio,
  Wrench,
  Target,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchAdvisorFollowUpStats,
  fetchAdvisorPipelineStats,
  formatCompactUsd,
} from "../lib/advisor-home-stats";

export function AdvisorActionCards() {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const followUps = useQuery({
    queryKey: ["floor", "advisor-actions", "follow-ups", userId],
    queryFn: () => fetchAdvisorFollowUpStats(userId),
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const pipeline = useQuery({
    queryKey: ["floor", "advisor-actions", "pipeline", userId],
    queryFn: () => fetchAdvisorPipelineStats(userId),
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const fu = followUps.data;
  const pl = pipeline.data;

  const followUpHero = fu == null ? "—" : String(fu.dueTodayCount + fu.overdueCount);
  const followUpUrgency =
    fu == null
      ? "Loading touchpoints…"
      : fu.overdueCount > 0
        ? `${fu.overdueCount} overdue · ${fu.dueTodayCount} due today`
        : fu.dueTodayCount > 0
          ? `${fu.dueTodayCount} due today`
          : "Caught up — no touchpoints due";

  const pipelineDecisionText =
    pl && pl.decisionCount > 0
      ? `${pl.decisionCount} at decision stage`
      : "Pipeline steady — no decision-stage pressure";

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.85fr)]">
      {/* Primary — START A QUOTE */}
      <section
        className="relative isolate overflow-hidden rounded-3xl border border-[#f28a07]/60 bg-gradient-to-br from-[#f28a07] via-[#c86708] to-[#251306] p-5 text-white shadow-[0_24px_80px_rgba(242,138,7,0.22)] lg:row-span-2 lg:p-6"
        aria-labelledby="advisor-start-quote-title"
      >
        <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-28 w-48 rounded-tl-full bg-black/20" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/80 via-black/60 to-black/35" />

        <div className="relative flex h-full flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/45 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-white shadow-sm">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Quote Builder
            </span>
            <span className="rounded-full bg-[#f8f2e7] px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-[#15100a] shadow-sm">
              Primary action
            </span>
          </div>

          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-white">Start here</p>
            <h2 id="advisor-start-quote-title" className="mt-2 text-3xl font-black leading-none text-white sm:text-4xl lg:text-5xl">
              Start a quote
            </h2>
            <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-white/95">
              Turn the next customer conversation into a guided quote package with pricing, terms, and handoff steps in one motion.
            </p>
          </div>

          <div className="relative mt-auto grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <Link
              to="/sales/quotes/new"
              className="group inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-[#15100a] shadow-xl shadow-black/25 transition-all hover:-translate-y-0.5 hover:bg-white/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#15100a]"
              aria-label="Start a new quote in Quote Builder"
            >
              Start new quote
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            <Link
              to="/voice-quote"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/45 bg-black/45 px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-white transition-all hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#15100a]"
              aria-label="Open Voice Quote"
            >
              <Mic className="h-4 w-4" aria-hidden="true" />
              Voice quote
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {/* Secondary — TODAY'S FOLLOW-UPS */}
        <Link
          to="/qrm/my/reality"
          className="group relative flex min-h-[170px] flex-col gap-2 overflow-hidden rounded-2xl border border-[#f28a07]/30 bg-[#f28a07]/10 p-5 transition-all hover:border-[#f28a07]/55 hover:bg-[#f28a07]/15"
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
            <span className="font-kpi text-4xl font-extrabold leading-none tabular-nums text-white">
              {followUpHero}
            </span>
            {fu && fu.tiedUpValueCents > 0 ? (
              <span className="pb-1 font-kpi text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f6a53a]">
                {formatCompactUsd(fu.tiedUpValueCents)} tied up
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

        {/* Secondary — MY PIPELINE */}
        <Link
          to="/qrm/deals?assigned_to=me"
          className="group flex min-h-[170px] flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:border-white/20 hover:bg-white/[0.07]"
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
            {pl == null ? "—" : formatCompactUsd(pl.totalValueCents)}{" "}
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              open value
            </span>
          </p>
          <p className="mt-auto text-[11px] text-amber-300">{pipelineDecisionText}</p>
        </Link>
      </div>

      {/* Supporting launchpad — the fastest actions advisors asked for on /floor */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:col-span-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300">
          Advisor quick tools
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <QuickToolLink
            to="/voice"
            label="Voice note starter"
            subLabel="Capture field context fast"
            icon={<Radio className="h-3.5 w-3.5" aria-hidden="true" />}
          />
          <QuickToolLink
            to="/qrm/opportunity-map"
            label="Prospecting map"
            subLabel="Upload UCC CSV and route the next stop"
            icon={<MapPinned className="h-3.5 w-3.5" aria-hidden="true" />}
          />
          <QuickToolLink
            to="/service/intake"
            label="Submit service request"
            subLabel="Open intake without leaving floor"
            icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
          />
          <QuickToolLink
            to="/qrm/companies?new=1"
            label="Add customer"
            subLabel="Create or find an account"
            icon={<PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />}
          />
        </div>
      </section>
    </div>
  );
}

function QuickToolLink({
  to,
  label,
  subLabel,
  icon,
}: {
  to: string;
  label: string;
  subLabel: string;
  icon: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 transition-all hover:border-[#f28a07]/45 hover:bg-[#f28a07]/10"
      aria-label={label}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f28a07]/15 text-[#f6a53a]">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-white">{label}</span>
          <span className="block truncate text-[11px] text-slate-400">{subLabel}</span>
        </span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-[#f28a07]" aria-hidden="true" />
    </Link>
  );
}
