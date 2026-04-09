/**
 * Quote Velocity Center — Track 1, Slice 1.3.
 *
 * Dedicated drill-down page at /qrm/command/quotes. Shows quote creation
 * velocity, aging pressure, conversion momentum, and an actionable table
 * of every active quote_package.
 *
 * First drill-down page in the command center — sets the pattern for
 * all future Dealer Reality Grid tile drill-downs.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock4,
  DollarSign,
  FileText,
  Loader2,
  Percent,
  Timer,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuoteVelocity } from "../hooks/useQuoteVelocity";
import { computeQuoteVelocity, type QuoteVelocityRow, type StatusBucket } from "../lib/quoteVelocity";

// ─── Helpers ───────────────────────────────────────────────────────────────

import { formatCurrency } from "@/lib/format";

// ─── KPI Card ──────────────────────────────────────────────────────────────

type Tone = "neutral" | "ready" | "risk" | "warn";

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-white/[0.06] bg-white/[0.02]",
  ready: "border-emerald-500/30 bg-emerald-500/[0.04]",
  risk: "border-rose-500/30 bg-rose-500/[0.04]",
  warn: "border-amber-500/30 bg-amber-500/[0.04]",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-white",
  ready: "text-emerald-400",
  risk: "text-rose-400",
  warn: "text-amber-400",
};

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: LucideIcon; tone: Tone }) {
  return (
    <div className={cn("rounded-xl border p-4 transition-colors", TONE_BORDER[tone])}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", TONE_TEXT[tone])} />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">{label}</span>
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", TONE_TEXT[tone])}>{value}</div>
    </div>
  );
}

// ─── Status Distribution Bar ───────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-500",
  sent: "bg-blue-500",
  expiring: "bg-amber-500",
  signed: "bg-emerald-500",
  expired: "bg-rose-500",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  expiring: "Expiring",
  signed: "Signed",
  expired: "Expired",
};

function StatusDistributionBar({ buckets }: { buckets: StatusBucket[] }) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {buckets.map((b) => (
          <div
            key={b.status}
            className={cn("transition-all", STATUS_COLORS[b.status] ?? "bg-slate-500")}
            style={{ width: `${(b.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {buckets.map((b) => (
          <div key={b.status} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <div className={cn("h-2 w-2 rounded-full", STATUS_COLORS[b.status] ?? "bg-slate-500")} />
            <span>{STATUS_LABELS[b.status] ?? b.status} ({b.count})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Quote Table Row ───────────────────────────────────────────────────────

const rowVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" as const } },
};

function urgencyBorder(row: QuoteVelocityRow): string {
  if (row.isAging) return "border-l-2 border-l-amber-500";
  if (row.isExpiringSoon) return "border-l-2 border-l-rose-500";
  if (row.isSigned) return "border-l-2 border-l-emerald-500";
  return "border-l-2 border-l-transparent";
}

function QuoteTableRow({ row }: { row: QuoteVelocityRow }) {
  return (
    <motion.tr
      variants={rowVariants}
      className={cn("border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]", urgencyBorder(row))}
    >
      <td className="py-3 pl-3 pr-2">
        <div>
          <Link
            to={row.dealId ? `/qrm/deals/${row.dealId}` : "#"}
            className="text-sm font-medium text-white hover:text-qep-orange transition-colors"
          >
            {row.dealName}
          </Link>
          <p className="text-[11px] text-slate-500 mt-0.5">{row.contactName}</p>
        </div>
      </td>
      <td className="py-3 px-2 text-right">
        <span className="text-sm tabular-nums text-white">{formatCurrency(row.netTotal)}</span>
      </td>
      <td className="py-3 px-2 text-right hidden sm:table-cell">
        <span className={cn("text-sm tabular-nums", row.marginPct !== null && row.marginPct < 10 ? "text-rose-400" : "text-white/70")}>
          {row.marginPct !== null ? `${row.marginPct.toFixed(1)}%` : "—"}
        </span>
      </td>
      <td className="py-3 px-2 text-center">
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] uppercase tracking-wider px-1.5",
            row.effectiveStatus === "signed" && "border-emerald-500/30 text-emerald-400",
            row.effectiveStatus === "expiring" && "border-rose-500/30 text-rose-400",
            row.effectiveStatus === "expired" && "border-rose-500/30 text-rose-400/60",
            row.effectiveStatus === "sent" && "border-blue-500/30 text-blue-400",
            row.effectiveStatus === "draft" && "border-white/10 text-white/40",
          )}
        >
          {row.effectiveStatus}
        </Badge>
      </td>
      <td className="py-3 px-2 text-right hidden md:table-cell">
        <span className={cn("text-sm tabular-nums", row.ageDays > 14 ? "text-amber-400" : "text-white/60")}>
          {row.ageDays}d
        </span>
      </td>
      <td className="py-3 px-2 text-right hidden lg:table-cell">
        {row.daysUntilExpiry !== null ? (
          <span className={cn("text-sm tabular-nums", row.daysUntilExpiry <= 7 ? "text-rose-400" : "text-white/60")}>
            {row.daysUntilExpiry <= 0 ? "Expired" : `${row.daysUntilExpiry}d`}
          </span>
        ) : (
          <span className="text-sm text-white/20">—</span>
        )}
      </td>
      <td className="py-3 pl-2 pr-3">
        {row.dealId && (
          <Link
            to={`/qrm/deals/${row.dealId}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-qep-orange hover:text-qep-orange/80 min-h-[44px] min-w-[44px] justify-center"
          >
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </td>
    </motion.tr>
  );
}

// ─── Container animation ───────────────────────────────────────────────────

const tableVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

// ─── Page component ────────────────────────────────────────────────────────

export function QuoteVelocityCenterPage() {
  const { data, isLoading, isError, error } = useQuoteVelocity();

  const computed = useMemo(() => {
    if (!data) return null;
    return computeQuoteVelocity(data.packages, data.signatures, Date.now());
  }, [data]);

  // Loading
  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <GlassPanel className="flex items-center justify-center gap-3 py-20 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-qep-orange" />
          Loading Quote Velocity Center...
        </GlassPanel>
      </div>
    );
  }

  // Error
  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <GlassPanel className="flex flex-col items-center gap-3 py-20 text-sm text-red-400">
          <AlertTriangle className="h-5 w-5" />
          <p>Could not load quote data</p>
          <p className="text-xs text-red-400/60">{error instanceof Error ? error.message : "Unknown error"}</p>
        </GlassPanel>
      </div>
    );
  }

  const { metrics, rows } = computed ?? { metrics: null, rows: [] };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Back link */}
      <Link
        to="/qrm"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Command Center
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-qep-orange" />
            <h1 className="text-3xl font-display font-medium tracking-tight text-white">Quote Velocity Center</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">Creation speed, aging pressure, conversion momentum</p>
        </div>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px] uppercase tracking-wider self-start">
          Live
        </Badge>
      </div>

      {/* KPI strip */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Active"
            value={String(metrics.activeCount)}
            icon={FileText}
            tone="neutral"
          />
          <MetricCard
            label="Exposure"
            value={formatCurrency(metrics.totalExposure)}
            icon={DollarSign}
            tone="neutral"
          />
          <MetricCard
            label="Avg Draft"
            value={`${metrics.avgDaysInDraft}d`}
            icon={Timer}
            tone={metrics.avgDaysInDraft > 7 ? "warn" : "neutral"}
          />
          <MetricCard
            label="Aging"
            value={String(metrics.agingCount)}
            icon={Clock4}
            tone={metrics.agingCount > 0 ? "warn" : "neutral"}
          />
          <MetricCard
            label="Expiring"
            value={String(metrics.expiringSoonCount)}
            icon={AlertTriangle}
            tone={metrics.expiringSoonCount > 0 ? "risk" : "neutral"}
          />
          <MetricCard
            label="Convert"
            value={`${Math.round(metrics.conversionRate * 100)}%`}
            icon={metrics.conversionRate >= 0.5 ? CheckCircle2 : Percent}
            tone={metrics.conversionRate >= 0.5 ? "ready" : metrics.conversionRate > 0 ? "warn" : "neutral"}
          />
        </div>
      )}

      {/* Status distribution */}
      {metrics && metrics.statusDistribution.length > 0 && (
        <GlassPanel className="p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50 mb-3">Status Distribution</p>
          <StatusDistributionBar buckets={metrics.statusDistribution} />
        </GlassPanel>
      )}

      {/* Quote table */}
      {rows.length > 0 ? (
        <GlassPanel className="p-0 overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-qep-orange" />
              <h2 className="text-sm font-semibold text-white">All Quotes</h2>
              <span className="text-[11px] text-slate-500">{rows.length} packages</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="py-2 pl-3 pr-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Deal</th>
                  <th className="py-2 px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 text-right">Value</th>
                  <th className="py-2 px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 text-right hidden sm:table-cell">Margin</th>
                  <th className="py-2 px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 text-center">Status</th>
                  <th className="py-2 px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 text-right hidden md:table-cell">Age</th>
                  <th className="py-2 px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 text-right hidden lg:table-cell">Expires</th>
                  <th className="py-2 pl-2 pr-3 w-12" />
                </tr>
              </thead>
              <motion.tbody variants={tableVariants} initial="hidden" animate="visible">
                {rows.map((row) => (
                  <QuoteTableRow key={row.id} row={row} />
                ))}
              </motion.tbody>
            </table>
          </div>
        </GlassPanel>
      ) : (
        <GlassPanel className="py-16 text-center">
          <FileText className="h-8 w-8 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No quote packages in your workspace yet</p>
          <Link
            to="/quote-v2"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-qep-orange hover:text-qep-orange/80"
          >
            Create your first quote <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </GlassPanel>
      )}
    </div>
  );
}

export default QuoteVelocityCenterPage;
