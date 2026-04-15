import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  DollarSign,
  Package,
  Zap,
  Clock,
  Sparkles,
  RefreshCw,
  Target,
  Flame,
  Skull,
  ArrowDownRight,
  ArrowUpRight,
  Activity,
} from "lucide-react";
import {
  fetchIntelligenceSummary,
  runEmbedBackfill,
  runSeededForecast,
  type DeadCapitalRow,
  type HotMoverRow,
  type IntelligenceSummary,
  type MarginErosionRow,
  type StockoutRow,
} from "../lib/intelligence-api";

// ── Tokens ─────────────────────────────────────────────────

const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  cardHover: "#182A44",
  border: "#1F3254",
  borderSoft: "#18263F",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  orangeDeep: "rgba(232,119,34,0.35)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  danger: "#EF4444",
  dangerBg: "rgba(239,68,68,0.12)",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.12)",
  info: "#3B82F6",
  infoBg: "rgba(59,130,246,0.12)",
  purple: "#A855F7",
  purpleBg: "rgba(168,85,247,0.14)",
} as const;

// ── Helpers ────────────────────────────────────────────────

function formatInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function formatCurrency(n: number | null | undefined, fractionDigits = 0): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function stockoutColor(risk: string): { bg: string; fg: string } {
  switch (risk) {
    case "stocked_out": return { bg: T.dangerBg, fg: T.danger };
    case "critical":    return { bg: T.dangerBg, fg: T.danger };
    case "high":        return { bg: T.warningBg, fg: T.warning };
    case "medium":      return { bg: T.warningBg, fg: T.warning };
    case "at_reorder":  return { bg: T.infoBg, fg: T.info };
    case "healthy":     return { bg: T.successBg, fg: T.success };
    default:            return { bg: T.borderSoft, fg: T.textMuted };
  }
}

// ── Main ───────────────────────────────────────────────────

export function IntelligencePage() {
  const queryClient = useQueryClient();
  const [recomputing, setRecomputing] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [lastComputeResult, setLastComputeResult] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<IntelligenceSummary>({
    queryKey: ["parts-intelligence-summary"],
    queryFn: fetchIntelligenceSummary,
    refetchInterval: 60000,
  });

  const handleRecompute = async () => {
    setRecomputing(true);
    setLastComputeResult(null);
    try {
      const r = await runSeededForecast(3);
      setLastComputeResult(`Wrote ${r.forecasts_written} forecasts in ${r.elapsed_ms.toFixed(0)}ms`);
      await queryClient.invalidateQueries({ queryKey: ["parts-intelligence-summary"] });
    } catch (err) {
      setLastComputeResult(`Failed: ${(err as Error).message}`);
    } finally {
      setRecomputing(false);
    }
  };

  const handleEmbedBackfill = async () => {
    setEmbedding(true);
    setLastComputeResult(null);
    try {
      const r = await runEmbedBackfill(100);
      setLastComputeResult(
        `Embedded ${r.rows_embedded} part${r.rows_embedded === 1 ? "" : "s"} in ${r.batches} batch${r.batches === 1 ? "" : "es"} (${r.elapsed_ms.toFixed(0)}ms). ${r.rows_remaining ?? 0} remaining.`,
      );
    } catch (err) {
      setLastComputeResult(`Embedding backfill failed: ${(err as Error).message}`);
    } finally {
      setEmbedding(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto px-4 md:px-10 py-8" style={{ background: T.bg, color: T.text }}>
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, rgba(168,85,247,0.2) 0%, rgba(232,119,34,0.15) 100%)",
                  boxShadow: "0 0 32px rgba(168,85,247,0.25)",
                }}
              >
                <Brain size={22} color={T.purple} />
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Parts Intelligence
              </h1>
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: T.orangeGlow, color: T.orange, border: `1px solid ${T.orange}` }}
              >
                Phase 2
              </span>
            </div>
            <p className="text-sm md:text-base max-w-2xl" style={{ color: T.textMuted }}>
              Every part, classified by velocity. Every stockout, projected before it happens.
              Every margin, measured against supplier list. Seeded from 24 months of DMS history.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleEmbedBackfill}
              disabled={embedding}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-60"
              style={{
                background: embedding ? T.bgElevated : `linear-gradient(135deg, #22C55E 0%, #16A34A 100%)`,
                color: "#fff",
                boxShadow: embedding ? "none" : "0 6px 16px rgba(34,197,94,0.35)",
              }}
              title="Embed all parts for semantic search (Slice 3.1 backfill)"
            >
              {embedding ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Embedding parts…
                </>
              ) : (
                <>
                  <Brain size={14} />
                  Rebuild embeddings
                </>
              )}
            </button>

            <button
              onClick={handleRecompute}
              disabled={recomputing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-60"
              style={{
                background: recomputing ? T.bgElevated : `linear-gradient(135deg, ${T.purple} 0%, #7c3aed 100%)`,
                color: "#fff",
                boxShadow: recomputing ? "none" : "0 6px 16px rgba(168,85,247,0.35)",
              }}
            >
              {recomputing ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Recomputing forecasts…
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Recompute forecasts
                </>
              )}
            </button>
          </div>
        </header>

        {lastComputeResult && (
          <div
            className="mb-6 p-3 rounded-lg flex items-center gap-2 text-sm"
            style={{ background: T.purpleBg, color: T.purple, border: `1px solid ${T.purple}` }}
          >
            <Sparkles size={14} />
            {lastComputeResult}
          </div>
        )}

        {/* KPI row */}
        {data?.kpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 md:gap-4 mb-8">
            <KpiCard
              icon={Package}
              label="Parts"
              value={formatInt(data.kpis.total_parts)}
              tone="neutral"
            />
            <KpiCard
              icon={Flame}
              label="Hot Movers"
              value={formatInt(data.kpis.hot_parts)}
              tone="success"
              detail="≥6 active months + 2× YoY"
            />
            <KpiCard
              icon={Skull}
              label="Dead Stock"
              value={formatInt(data.kpis.dead_parts)}
              tone="danger"
              detail="12+ months no sales"
            />
            <KpiCard
              icon={AlertTriangle}
              label="Stockout Risk"
              value={formatInt(data.kpis.stockout_critical)}
              tone="warning"
              detail="Critical or empty"
            />
            <KpiCard
              icon={DollarSign}
              label="Dead Capital"
              value={formatCurrency(data.kpis.dead_capital_usd)}
              tone="danger"
            />
            <KpiCard
              icon={TrendingDown}
              label="Margin Erosion"
              value={formatInt(data.kpis.margin_erosion_parts)}
              tone="warning"
              detail="Vendor cost > sell / 1.05"
            />
            <KpiCard
              icon={Target}
              label="Forecast Coverage"
              value={formatInt(data.kpis.forecast_coverage)}
              tone="info"
              detail="parts w/ forward forecast"
            />
          </div>
        )}

        {isLoading && (
          <div
            className="rounded-2xl p-16 text-center"
            style={{ background: T.card, border: `1px solid ${T.border}` }}
          >
            <div
              className="w-10 h-10 border-3 rounded-full animate-spin mx-auto mb-3"
              style={{ borderColor: T.border, borderTopColor: T.purple }}
            />
            <div className="text-sm" style={{ color: T.textMuted }}>
              Computing intelligence across all parts…
            </div>
          </div>
        )}

        {error && (
          <div
            className="rounded-2xl p-6"
            style={{ background: T.dangerBg, border: `1px solid ${T.danger}` }}
          >
            <div className="text-sm" style={{ color: T.danger }}>
              Failed to load: {(error as Error).message}. Run `bun run parts:hydrate` first.
            </div>
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Stockout Heat */}
            <Panel
              icon={AlertTriangle}
              title="Stockout risk"
              tone="warning"
              subtitle={`${data.stockout_heat.length} parts needing attention`}
              count={data.kpis.stockout_critical}
            >
              <StockoutList rows={data.stockout_heat} />
            </Panel>

            {/* Hot Movers */}
            <Panel
              icon={Flame}
              title="Hot movers"
              tone="success"
              subtitle="Growing demand · stock up"
              count={data.kpis.hot_parts}
            >
              <HotMoverList rows={data.hot_movers} />
            </Panel>

            {/* Dead Capital */}
            <Panel
              icon={Skull}
              title="Dead capital"
              tone="danger"
              subtitle="Return · transfer · clearance"
              count={data.kpis.dead_parts}
              totalUsd={data.kpis.dead_capital_usd}
            >
              <DeadCapitalList rows={data.dead_capital} />
            </Panel>

            {/* Margin Erosion */}
            <Panel
              icon={TrendingDown}
              title="Margin erosion"
              tone="warning"
              subtitle="Vendor cost creeping up"
              count={data.kpis.margin_erosion_parts}
            >
              <MarginErosionList rows={data.margin_erosion} />
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

// ── KPI Card ───────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Brain;
  label: string;
  value: string;
  detail?: string;
  tone: "neutral" | "success" | "danger" | "warning" | "info";
}) {
  const toneMap = {
    neutral: { bg: T.borderSoft, fg: T.textMuted },
    success: { bg: T.successBg, fg: T.success },
    danger: { bg: T.dangerBg, fg: T.danger },
    warning: { bg: T.warningBg, fg: T.warning },
    info: { bg: T.infoBg, fg: T.info },
  } as const;
  const c = toneMap[tone];
  return (
    <div
      className="rounded-2xl p-3.5 md:p-4"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: c.bg }}
        >
          <Icon size={13} color={c.fg} />
        </div>
        <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: T.textMuted }}>
          {label}
        </div>
      </div>
      <div className="text-xl md:text-2xl font-bold tracking-tight" style={{ color: c.fg }}>
        {value}
      </div>
      {detail && (
        <div className="text-[10px] mt-1" style={{ color: T.textDim }}>
          {detail}
        </div>
      )}
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────

function Panel({
  icon: Icon,
  title,
  subtitle,
  children,
  tone,
  count,
  totalUsd,
}: {
  icon: typeof Brain;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tone: "success" | "danger" | "warning" | "info";
  count?: number;
  totalUsd?: number;
}) {
  const toneFg = {
    success: T.success,
    danger: T.danger,
    warning: T.warning,
    info: T.info,
  }[tone];
  const toneBg = {
    success: T.successBg,
    danger: T.dangerBg,
    warning: T.warningBg,
    info: T.infoBg,
  }[tone];
  return (
    <section
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <header
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: `1px solid ${T.borderSoft}` }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: toneBg }}
        >
          <Icon size={16} color={toneFg} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            {count != null && (
              <div className="text-xs font-medium" style={{ color: toneFg }}>
                {formatInt(count)}
              </div>
            )}
          </div>
          {subtitle && (
            <div className="text-xs" style={{ color: T.textDim }}>
              {subtitle}
            </div>
          )}
        </div>
        {totalUsd != null && totalUsd > 0 && (
          <div className="text-right">
            <div className="text-lg font-bold" style={{ color: toneFg }}>
              {formatCurrency(totalUsd)}
            </div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: T.textMuted }}>
              tied up
            </div>
          </div>
        )}
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

// ── Row lists ──────────────────────────────────────────────

function StockoutList({ rows }: { rows: StockoutRow[] }) {
  if (rows.length === 0) return <EmptyRow label="All parts healthy" />;
  return (
    <div className="divide-y" style={{ borderColor: T.borderSoft }}>
      {rows.map((r, i) => {
        const style = stockoutColor(r.stockout_risk);
        return (
          <div
            key={`${r.part_number}-${r.branch_code}-${i}`}
            className="flex items-center gap-3 px-5 py-3"
            style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderSoft}` }}
          >
            <div
              className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide flex-shrink-0"
              style={{ background: style.bg, color: style.fg }}
            >
              {r.stockout_risk.replace("_", " ")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm truncate">{r.part_number}</div>
              <div className="text-xs truncate" style={{ color: T.textDim }}>
                {r.description ?? "—"}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-sm font-medium">
                {formatInt(r.on_hand)} <span style={{ color: T.textDim }} className="text-xs">on hand</span>
              </div>
              <div className="text-xs" style={{ color: T.textDim }}>
                {r.days_of_stock != null ? `${r.days_of_stock.toFixed(0)}d left` : "no velocity"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HotMoverList({ rows }: { rows: HotMoverRow[] }) {
  if (rows.length === 0) return <EmptyRow label="No hot movers detected yet" />;
  return (
    <div>
      {rows.map((r, i) => (
        <div
          key={`${r.part_number}-${r.branch_code}-${i}`}
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderSoft}` }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: T.successBg }}
          >
            <ArrowUpRight size={14} color={T.success} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm truncate">{r.part_number}</div>
            <div className="text-xs truncate" style={{ color: T.textDim }}>{r.description ?? "—"}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-medium" style={{ color: T.success }}>
              {formatPct(r.yoy_growth_pct)}
            </div>
            <div className="text-xs" style={{ color: T.textDim }}>
              {formatInt(r.history_12mo_sales)} sold / 12mo
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeadCapitalList({ rows }: { rows: DeadCapitalRow[] }) {
  if (rows.length === 0) return <EmptyRow label="No dead capital detected" />;
  return (
    <div>
      {rows.map((r, i) => (
        <div
          key={`${r.part_number}-${r.branch_code}-${i}`}
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderSoft}` }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: r.dead_pattern === "truly_dead" ? T.dangerBg : T.warningBg }}
          >
            <ArrowDownRight size={14} color={r.dead_pattern === "truly_dead" ? T.danger : T.warning} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm truncate">{r.part_number}</div>
            <div className="text-xs truncate" style={{ color: T.textDim }}>
              {r.description ?? "—"}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-medium" style={{ color: T.danger }}>
              {formatCurrency(r.capital_on_hand)}
            </div>
            <div className="text-xs" style={{ color: T.textDim }}>
              {formatInt(r.on_hand)} × {formatCurrency(r.cost_price, 2)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MarginErosionList({ rows }: { rows: MarginErosionRow[] }) {
  if (rows.length === 0) return <EmptyRow label="Margins healthy" />;
  return (
    <div>
      {rows.map((r, i) => (
        <div
          key={`${r.part_number}-${r.branch_code}-${i}`}
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderSoft}` }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: T.warningBg }}
          >
            <TrendingDown size={14} color={T.warning} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm truncate">{r.part_number}</div>
            <div className="text-xs flex gap-2" style={{ color: T.textDim }}>
              <span>sell {formatCurrency(r.list_price, 2)}</span>
              <span>·</span>
              <span>cost {formatCurrency(r.cost_price, 2)}</span>
              {r.vendor_list_price != null && (
                <>
                  <span>·</span>
                  <span style={{ color: T.warning }}>vendor {formatCurrency(r.vendor_list_price, 2)}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-medium" style={{ color: r.margin_pct_on_cost != null && r.margin_pct_on_cost < 10 ? T.danger : T.warning }}>
              {formatPct(r.margin_pct_on_cost)}
            </div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: T.textDim }}>
              margin
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <div className="text-sm" style={{ color: T.textMuted }}>
        {label}
      </div>
    </div>
  );
}
