/**
 * Blocker Board — Track 1, Slice 1.5.
 *
 * Dedicated page at /qrm/command/blockers. Shows every deal blocked from
 * progressing, grouped by blocker type, with one-click resolver actions.
 *
 * Fulfills the "blocked deals" half of the Iron Manager promise.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  DollarSign,
  Eye,
  Loader2,
  Lock,
  Scale,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useBlockers, useAcknowledgeAnomaly } from "../hooks/useBlockers";
import { useApproveMargin, useVerifyDeposit } from "../hooks/useApprovals";
import { groupBlockedDeals, type BlockedDeal, type BlockerCategory, type BlockerGroup } from "../lib/blockerTypes";

// ─── Constants ─────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  if (amount > 0) return `$${Math.round(amount)}`;
  return "$0";
}

const CATEGORY_CONFIG: Record<BlockerCategory, { icon: LucideIcon; color: string; bg: string; border: string; label: string; actionLabel: string }> = {
  deposit_missing: { icon: Wallet, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/25", label: "Deposit Missing", actionLabel: "Verify Deposit" },
  margin_flagged: { icon: Scale, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25", label: "Margin Flagged", actionLabel: "Approve Margin" },
  anomaly_critical: { icon: ShieldAlert, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/25", label: "Critical Anomaly", actionLabel: "Acknowledge" },
};

// ─── KPI Card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: LucideIcon; tone: string }) {
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

// ─── Deal Row ──────────────────────────────────────────────────────────────

const rowVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" as const } },
  exit: { opacity: 0, x: 60, transition: { duration: 0.25, ease: "easeIn" as const } },
};

function BlockerDealRow({
  deal,
  onResolve,
  isResolving,
}: {
  deal: BlockedDeal;
  onResolve: () => void;
  isResolving: boolean;
}) {
  const config = CATEGORY_CONFIG[deal.category];

  return (
    <motion.div
      layout
      variants={rowVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/qrm/deals/${deal.dealId}`}
            className="text-sm font-medium text-white hover:text-qep-orange transition-colors"
          >
            {deal.dealName}
          </Link>
          {deal.companyName !== "—" && (
            <span className="text-[11px] text-slate-500">{deal.companyName}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-slate-400">
          <span className="font-medium tabular-nums text-white/70">{formatCurrency(deal.amount)}</span>
          <span>{deal.stageName}</span>
          <span>{deal.detail}</span>
          {deal.daysBlocked > 0 && (
            <span className={deal.daysBlocked > 7 ? "text-rose-400" : "text-amber-400"}>
              {deal.daysBlocked}d blocked
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={`/qrm/deals/${deal.dealId}`}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-white transition-colors min-h-[44px] px-2"
        >
          <Eye className="h-3 w-3" /> View
        </Link>
        <Button
          size="sm"
          onClick={onResolve}
          disabled={isResolving}
          className="rounded-full bg-qep-orange hover:bg-qep-orange/80 text-white min-h-[44px] px-4 text-xs font-semibold"
        >
          {isResolving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Check className="h-3.5 w-3.5 mr-1" />
              {config.actionLabel}
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Blocker Group Section ─────────────────────────────────────────────────

function BlockerGroupSection({
  group,
  onResolve,
  resolvingIds,
}: {
  group: BlockerGroup;
  onResolve: (deal: BlockedDeal) => void;
  resolvingIds: Set<string>;
}) {
  const config = CATEGORY_CONFIG[group.category];
  const Icon = config.icon;

  return (
    <div className="space-y-3">
      {/* Group header */}
      <div className={cn("flex items-center justify-between rounded-xl border p-3", config.border, config.bg)}>
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", config.color)} />
          <span className={cn("text-xs font-bold uppercase tracking-[0.15em]", config.color)}>
            {group.label}
          </span>
          <Badge variant="outline" className={cn("text-[9px] px-1.5", config.border, config.color)}>
            {group.deals.length} deal{group.deals.length !== 1 ? "s" : ""}
          </Badge>
          {group.category === "deposit_missing" && (
            <Badge variant="outline" className="text-[9px] px-1.5 border-rose-500/30 text-rose-300">
              HARD GATE
            </Badge>
          )}
        </div>
        {group.totalValue > 0 && (
          <span className={cn("text-xs font-medium tabular-nums", config.color)}>
            {formatCurrency(group.totalValue)} blocked
          </span>
        )}
      </div>

      {/* Deal rows */}
      <AnimatePresence mode="popLayout">
        {group.deals.map((deal) => (
          <BlockerDealRow
            key={deal.id}
            deal={deal}
            onResolve={() => onResolve(deal)}
            isResolving={resolvingIds.has(deal.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function BlockerBoardPage() {
  const { data, isLoading, isError, error } = useBlockers();
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const approveMargin = useApproveMargin();
  const verifyDeposit = useVerifyDeposit();
  const acknowledgeAnomaly = useAcknowledgeAnomaly();

  const { groups, totalBlocked, totalRevenue } = useMemo(() => {
    if (!data) return { groups: [], totalBlocked: 0, totalRevenue: 0 };
    return groupBlockedDeals(data.deals, data.deposits, data.anomalies);
  }, [data]);

  const depositCount = groups.find((g) => g.category === "deposit_missing")?.deals.length ?? 0;
  const anomalyCount = groups.find((g) => g.category === "anomaly_critical")?.deals.length ?? 0;

  function handleResolve(deal: BlockedDeal) {
    setResolvingIds((prev) => new Set(prev).add(deal.id));
    const onError = () => {
      setResolvingIds((prev) => {
        const next = new Set(prev);
        next.delete(deal.id);
        return next;
      });
    };

    switch (deal.category) {
      case "deposit_missing":
        if (deal.depositId) {
          verifyDeposit.mutate(deal.depositId, { onError });
        }
        break;
      case "margin_flagged":
        approveMargin.mutate(deal.dealId, { onError });
        break;
      case "anomaly_critical":
        if (deal.anomalyId) {
          acknowledgeAnomaly.mutate(deal.anomalyId, { onError });
        }
        break;
    }
  }

  // Loading
  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <GlassPanel className="flex items-center justify-center gap-3 py-20 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-qep-orange" />
          Loading Blocker Board...
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
          <p>Could not load blocker data</p>
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
            <Lock className="h-5 w-5 text-qep-orange" />
            <h1 className="text-3xl font-display font-medium tracking-tight text-white">Blocker Board</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">Every obstacle between your pipeline and revenue.</p>
        </div>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px] uppercase tracking-wider self-start">
          Live
        </Badge>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Blocked Deals"
          value={String(totalBlocked)}
          icon={Lock}
          tone={totalBlocked > 0 ? "border-rose-500/20 bg-rose-500/[0.04] text-rose-400" : "border-white/[0.06] bg-white/[0.02] text-white/50"}
        />
        <MetricCard
          label="Revenue Blocked"
          value={formatCurrency(totalRevenue)}
          icon={DollarSign}
          tone={totalRevenue > 0 ? "border-qep-orange/30 bg-qep-orange/[0.04] text-qep-orange" : "border-white/[0.06] bg-white/[0.02] text-white/50"}
        />
        <MetricCard
          label="Deposit Gates"
          value={String(depositCount)}
          icon={Wallet}
          tone={depositCount > 0 ? "border-rose-500/20 bg-rose-500/[0.04] text-rose-400" : "border-white/[0.06] bg-white/[0.02] text-white/50"}
        />
        <MetricCard
          label="Critical Anomalies"
          value={String(anomalyCount)}
          icon={ShieldAlert}
          tone={anomalyCount > 0 ? "border-violet-500/20 bg-violet-500/[0.04] text-violet-400" : "border-white/[0.06] bg-white/[0.02] text-white/50"}
        />
      </div>

      {/* Blocker groups */}
      {groups.length > 0 ? (
        <div className="space-y-6">
          {groups.map((group) => (
            <BlockerGroupSection
              key={group.category}
              group={group}
              onResolve={handleResolve}
              resolvingIds={resolvingIds}
            />
          ))}
        </div>
      ) : (
        <GlassPanel className="py-16 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-3" />
          <p className="text-sm text-white font-medium">No blocked deals</p>
          <p className="text-xs text-slate-500 mt-1">Clear pipeline — every deal can progress.</p>
          <Link
            to="/qrm"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-qep-orange hover:text-qep-orange/80"
          >
            Back to Command Center <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </GlassPanel>
      )}
    </div>
  );
}

export default BlockerBoardPage;
