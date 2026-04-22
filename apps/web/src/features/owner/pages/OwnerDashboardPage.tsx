/**
 * Owner Dashboard — the cockpit page.
 *
 * Landing surface for role=owner. Five tiers stacked on one scrollable page:
 *   T1  Hero: Ownership Health Score dial + AI Owner Brief
 *   T2  Ask Anything bar (full width)
 *   T3  6-card premium KPI grid
 *   T4  Predictive Intervention panel
 *   T5  Branch Stack heatmap + Team Signals grid
 *
 * Data sources: owner_dashboard_summary, compute_ownership_health_score,
 * owner-morning-brief, owner-ask-anything, owner-predictive-interventions.
 */
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  DollarSign,
  LineChart,
  Target,
  Wrench,
} from "lucide-react";
import {
  fetchOwnerDashboardSummary,
  type OwnerDashboardSummary,
} from "../lib/owner-api";
import { OwnerKpiTile, type Tone } from "../components/OwnerKpiTile";
import { OwnershipHealthDial } from "../components/OwnershipHealthDial";
import { OwnerBriefCard } from "../components/OwnerBriefCard";
import { AskAnythingBar } from "../components/AskAnythingBar";
import { PredictiveInterventionPanel } from "../components/PredictiveInterventionPanel";
import { BranchStackHeatmap } from "../components/BranchStackHeatmap";
import { TeamSignalsGrid } from "../components/TeamSignalsGrid";
import { useDashboardRealtime } from "@/features/dashboards/hooks/useDashboardRealtime";

function fmtUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (opts.compact && Math.abs(n) >= 1000) {
    const units = [
      { v: 1_000_000_000, s: "B" },
      { v: 1_000_000, s: "M" },
      { v: 1_000, s: "K" },
    ];
    for (const u of units) {
      if (Math.abs(n) >= u.v) {
        return `$${(n / u.v).toFixed(n / u.v >= 10 ? 0 : 1)}${u.s}`;
      }
    }
  }
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

export function OwnerDashboardPage() {
  const navigate = useNavigate();

  const summaryQuery = useQuery<OwnerDashboardSummary>({
    queryKey: ["owner", "dashboard-summary"],
    queryFn: fetchOwnerDashboardSummary,
    refetchInterval: 90_000,
  });

  // Live-invalidate the summary when underlying tables fire realtime events.
  useDashboardRealtime("iron_manager", ["owner", "dashboard-summary"]);

  const tiles = useMemo(() => buildTiles(summaryQuery.data, navigate), [
    summaryQuery.data,
    navigate,
  ]);

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(249,115,22,0.18),transparent_50%),linear-gradient(180deg,#05060a_0%,#0a0d14_100%)] text-slate-100">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-qep-orange/90">
              Owner Cockpit
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Today at QEP
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              One screen for the whole business. Refreshes every 90 seconds and on live events.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/executive/data-miner")}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.12]"
            >
              <LineChart className="h-3.5 w-3.5" />
              Data Miner Equivalents
            </button>
            {summaryQuery.data?.generated_at && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300">
                <Activity className="mr-1 inline h-3 w-3 text-qep-orange" />
                refreshed {new Date(summaryQuery.data.generated_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
        </header>

        {/* TIER 1 — Hero: Health Score + Owner Brief ──────────────────── */}
        <section className="grid gap-5 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <OwnershipHealthDial />
          </div>
          <div className="lg:col-span-3">
            <OwnerBriefCard />
          </div>
        </section>

        {/* TIER 2 — Ask Anything bar ──────────────────────────────────── */}
        <section className="mt-5">
          <AskAnythingBar />
        </section>

        {/* TIER 3 — 6 premium KPI cards ──────────────────────────────── */}
        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
              Live Business Signals
            </h2>
            {summaryQuery.isError && (
              <span className="text-xs text-rose-300">
                Summary failed: {(summaryQuery.error as Error).message}
              </span>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((t) => (
              <OwnerKpiTile key={t.label} {...t} />
            ))}
          </div>
        </section>

        {/* TIER 4 — Predictive Interventions ─────────────────────────── */}
        <section className="mt-6">
          <PredictiveInterventionPanel />
        </section>

        {/* TIER 5 — Branch Stack + Team Signals ──────────────────────── */}
        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          <BranchStackHeatmap />
          <TeamSignalsGrid />
        </section>
      </div>
    </div>
  );
}

// Builder for the Tier 3 KPI grid — derives tones + copy from live summary.
function buildTiles(
  summary: OwnerDashboardSummary | undefined,
  navigate: (to: string) => void,
) {
  const r = summary?.revenue;
  const p = summary?.parts;
  const pl = summary?.pipeline;
  const f = summary?.finance;

  const stockTone: Tone = (p?.stockout_critical ?? 0) > 100
    ? "critical"
    : (p?.stockout_critical ?? 0) > 25
    ? "warning"
    : "good";
  const arTone: Tone = (f?.ar_aged_90_plus ?? 0) > 50_000
    ? "critical"
    : (f?.ar_aged_90_plus ?? 0) > 10_000
    ? "warning"
    : "good";

  return [
    {
      eyebrow: "Revenue",
      label: "Today's Revenue",
      hero: fmtUsd(r?.today),
      subline: `MTD ${fmtUsd(r?.mtd, { compact: true })} · prior ${fmtUsd(r?.prev_month_same_day, { compact: true })}`,
      delta: { pct: r?.mtd_vs_prev_pct ?? null, label: "MTD vs prior month" },
      icon: DollarSign,
      tone: "neutral" as Tone,
      onDrill: () => navigate("/executive"),
    },
    {
      eyebrow: "Pipeline",
      label: "Pipeline Weighted Value",
      hero: fmtUsd(pl?.weighted_total, { compact: true }),
      subline: `${fmtInt(pl?.at_risk_count)} deals stalled >14 days`,
      icon: LineChart,
      tone: (pl?.at_risk_count ?? 0) > 5 ? ("warning" as Tone) : ("neutral" as Tone),
      onDrill: () => navigate("/qrm/deals"),
    },
    {
      eyebrow: "Parts Capital",
      label: "Parts Capital at Play",
      hero: fmtUsd(p?.dead_capital_usd, { compact: true }),
      subline: `${fmtInt(p?.predictive_open_plays)} predictive plays · ${fmtUsd(
        p?.predictive_revenue_open,
        { compact: true },
      )} forward revenue`,
      icon: Boxes,
      tone: "warning" as Tone,
      onDrill: () => navigate("/parts/companion/intelligence"),
      drillLabel: "Intelligence",
    },
    {
      eyebrow: "Parts Ops",
      label: "Critical Stockouts",
      hero: fmtInt(p?.stockout_critical),
      subline: `${fmtInt(p?.replenish_pending)} in replenish queue · ${fmtInt(
        p?.margin_erosion_flags,
      )} margin flags`,
      icon: AlertTriangle,
      tone: stockTone,
      onDrill: () => navigate("/parts/companion/replenish"),
      drillLabel: "Replenish queue",
    },
    {
      eyebrow: "Service",
      label: "Service Backlog",
      hero: "—",
      subline: "Wire-up lands in Slice F with service_dashboard_rollup",
      icon: Wrench,
      tone: "neutral" as Tone,
      onDrill: () => navigate("/service"),
    },
    {
      eyebrow: "Cash + AR",
      label: "AR Aged 90+ Days",
      hero: fmtUsd(f?.ar_aged_90_plus, { compact: true }),
      subline: `Last import ${
        p?.last_import_at
          ? new Date(p.last_import_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : "—"
      }`,
      icon: Target,
      tone: arTone,
      onDrill: () => navigate("/qrm/command/approvals"),
    },
  ];
}
