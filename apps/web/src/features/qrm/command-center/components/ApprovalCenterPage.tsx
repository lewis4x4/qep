/**
 * Approval Center — Track 1, Slice 1.4.
 *
 * Dedicated page at /qrm/command/approvals. One-click approve/deny for
 * margin flags, deposit verifications, trade reviews, and demo requests.
 * Manager-gated — reps cannot access this page.
 *
 * Fulfills the Iron Manager promise: "approvals waiting on you."
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { DashboardPivotToggle } from "@/components/primitives";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  DollarSign,
  GitCompare,
  Loader2,
  MonitorPlay,
  Scale,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useApprovals,
  useApproveMargin,
  useVerifyDeposit,
  useApproveTrade,
  useApproveDemo,
} from "../hooks/useApprovals";
import { normalizeApprovals, type ApprovalItem, type ApprovalType } from "../lib/approvalTypes";

// ─── Constants ─────────────────────────────────────────────────────────────

type FilterKey = "all" | ApprovalType;

const PIVOTS = [
  { key: "all" as const, label: "All" },
  { key: "margin" as const, label: "Margin" },
  { key: "deposit" as const, label: "Deposits" },
  { key: "trade" as const, label: "Trades" },
  { key: "demo" as const, label: "Demos" },
];

const TYPE_CONFIG: Record<ApprovalType, { icon: LucideIcon; color: string; bg: string; border: string; label: string; actionLabel: string }> = {
  margin: { icon: Scale, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Margin", actionLabel: "Approve Margin" },
  deposit: { icon: Wallet, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Deposit", actionLabel: "Verify Deposit" },
  trade: { icon: GitCompare, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", label: "Trade", actionLabel: "Approve Trade" },
  demo: { icon: MonitorPlay, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Demo", actionLabel: "Approve Demo" },
};

import { formatCurrency } from "@/lib/format";

function timeAgo(isoDate: string): string {
  const ms = Date.now() - Date.parse(isoDate);
  if (ms < 0) return "just now";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── KPI Card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: string }) {
  return (
    <div className={cn("rounded-xl border p-4 transition-colors", tone)}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

// ─── Approval Card ─────────────────────────────────────────────────────────

const cardVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" as const } },
  exit: { opacity: 0, x: 80, transition: { duration: 0.3, ease: "easeIn" as const } },
};

function ApprovalCard({
  item,
  onApprove,
  isApproving,
}: {
  item: ApprovalItem;
  onApprove: () => void;
  isApproving: boolean;
}) {
  const config = TYPE_CONFIG[item.type];
  const Icon = config.icon;
  const valueLabel = item.amount > 0 ? formatCurrency(item.amount) : null;

  return (
    <motion.div
      layout
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn(
        "group rounded-2xl border p-4 transition-colors",
        "bg-white/[0.02] hover:bg-white/[0.04]",
        item.urgency === "high" ? "border-rose-500/20" : "border-white/[0.06]",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: type badge + context */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cn("text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md", config.bg, config.color, config.border)}>
              <Icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            {item.urgency === "high" && (
              <Badge variant="outline" className="border-rose-500/30 text-rose-400 text-[9px]">
                Overdue
              </Badge>
            )}
            <span className="text-[11px] text-slate-500">{timeAgo(item.createdAt)}</span>
          </div>

          <div className="mt-2">
            <Link
              to={item.dealId ? `/qrm/deals/${item.dealId}` : "#"}
              className="text-sm font-medium text-white hover:text-qep-orange transition-colors"
            >
              {item.dealName}
            </Link>
            {item.contactName !== "—" && (
              <span className="text-sm text-slate-500 ml-2">{item.contactName}</span>
            )}
          </div>

          <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
            {valueLabel && (
              <span className="font-medium tabular-nums text-white/70">{valueLabel}</span>
            )}
            <span>{item.detail}</span>
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2 shrink-0 sm:ml-4">
          {item.dealId && (
            <Link
              to={`/qrm/deals/${item.dealId}`}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-white transition-colors min-h-[44px] px-2"
            >
              View <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          <Button
            size="sm"
            onClick={onApprove}
            disabled={isApproving}
            aria-label={`${config.actionLabel} for ${item.dealName}`}
            className="rounded-full bg-qep-orange hover:bg-qep-orange/80 text-white min-h-[44px] px-4 text-xs font-semibold"
          >
            {isApproving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Check className="h-3.5 w-3.5 mr-1" />
                {config.actionLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Container animation ───────────────────────────────────────────────────

const listVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

// ─── Page ──────────────────────────────────────────────────────────────────

export function ApprovalCenterPage() {
  const { data, isLoading, isError, error } = useApprovals();
  const [filter, setFilter] = useState<FilterKey>("all");

  const approveMargin = useApproveMargin();
  const verifyDeposit = useVerifyDeposit();
  const approveTrade = useApproveTrade();
  const approveDemo = useApproveDemo();

  // Pending mutation IDs for optimistic fade-out
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const items = useMemo(() => {
    if (!data) return [];
    return normalizeApprovals(data.margin, data.deposits, data.trades, data.demos);
  }, [data]);

  const filtered = useMemo(() => {
    if (filter === "all") return items.filter((i) => !pendingIds.has(i.id));
    return items.filter((i) => i.type === filter && !pendingIds.has(i.id));
  }, [items, filter, pendingIds]);

  const counts = useMemo(() => ({
    total: items.length,
    margin: items.filter((i) => i.type === "margin").length,
    deposit: items.filter((i) => i.type === "deposit").length,
    trade: items.filter((i) => i.type === "trade").length,
    demo: items.filter((i) => i.type === "demo").length,
  }), [items]);

  function handleApprove(item: ApprovalItem) {
    setPendingIds((prev) => new Set(prev).add(item.id));

    const onError = () => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    };

    switch (item.type) {
      case "margin":
        approveMargin.mutate(item.id, { onError });
        break;
      case "deposit":
        verifyDeposit.mutate(item.id, { onError });
        break;
      case "trade":
        approveTrade.mutate({ tradeId: item.id }, { onError });
        break;
      case "demo":
        approveDemo.mutate(item.id, { onError });
        break;
    }
  }

  const isApprovingItem = (id: string) => pendingIds.has(id);

  // Loading
  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <GlassPanel className="flex items-center justify-center gap-3 py-20 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-qep-orange" />
          Loading Approval Center...
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
          <p>Could not load approval data</p>
          <p className="text-xs text-red-400/60">{error instanceof Error ? error.message : "Unknown error"}</p>
        </GlassPanel>
      </div>
    );
  }

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
            <ShieldCheck className="h-5 w-5 text-qep-orange" />
            <h1 className="text-3xl font-display font-medium tracking-tight text-white">Approval Center</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">One-click decisions. Every approval has a path to action.</p>
        </div>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px] uppercase tracking-wider self-start">
          Live
        </Badge>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          label="Total Pending"
          value={counts.total}
          icon={AlertTriangle}
          tone={counts.total > 0 ? "border-qep-orange/30 bg-qep-orange/[0.04] text-qep-orange" : "border-white/[0.06] bg-white/[0.02] text-white/50"}
        />
        <MetricCard label="Margin" value={counts.margin} icon={Scale} tone="border-rose-500/20 bg-rose-500/[0.04] text-rose-400" />
        <MetricCard label="Deposits" value={counts.deposit} icon={Wallet} tone="border-amber-500/20 bg-amber-500/[0.04] text-amber-400" />
        <MetricCard label="Trades" value={counts.trade} icon={GitCompare} tone="border-violet-500/20 bg-violet-500/[0.04] text-violet-400" />
        <MetricCard label="Demos" value={counts.demo} icon={MonitorPlay} tone="border-blue-500/20 bg-blue-500/[0.04] text-blue-400" />
      </div>

      {/* Filter toggle */}
      <DashboardPivotToggle
        value={filter}
        onChange={(v) => setFilter(v as FilterKey)}
        pivots={PIVOTS}
      />

      {/* Approval list */}
      {filtered.length > 0 ? (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="visible"
          className="space-y-3"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((item) => (
              <ApprovalCard
                key={`${item.type}-${item.id}`}
                item={item}
                onApprove={() => handleApprove(item)}
                isApproving={isApprovingItem(item.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <GlassPanel className="py-16 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-3" />
          <p className="text-sm text-white font-medium">No approvals waiting</p>
          <p className="text-xs text-slate-500 mt-1">You're caught up. Nice work.</p>
        </GlassPanel>
      )}
    </div>
  );
}

export default ApprovalCenterPage;
