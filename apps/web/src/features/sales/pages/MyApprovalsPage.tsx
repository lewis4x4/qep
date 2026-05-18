/**
 * MyApprovalsPage — single dedicated surface for a rep's submitted quote
 * approvals. Lives at /sales/my-approvals.
 *
 * Layout (mobile-first, matches CustomerListPage / PipelineBoardPage tokens):
 *   [Back · Title]
 *   [Status chips: All · Pending · Changes Requested · Decided]
 *   [List of approval rows]
 *
 * Each row:
 *   - Customer name (bold) + quote number
 *   - Total amount + margin %
 *   - Color-coded status badge
 *   - Time-ago label ("Submitted Xh ago" while pending, else "Decided Xh ago")
 *   - Manager attribution (assigned manager when pending, decider when decided)
 *   - Optional submission note (rep's justification, italic muted)
 *   - Optional decision note (manager's reply, attributed)
 *   - Tap navigates to /sales/quotes/:quote_package_id (Quote Builder)
 */
import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Mic,
  MoreHorizontal,
} from "lucide-react";
import {
  useMyApprovals,
  type MyApprovalRow,
  type MyApprovalStatus,
} from "../hooks/useMyApprovals";
import { withdrawApprovalCase } from "@/features/quote-builder/lib/quote-api";
import { toast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type FilterKey = "all" | "pending" | "changes_requested" | "decided";

interface StatusBadgeStyle {
  bg: string;
  border: string;
  text: string;
  label: string;
}

const STATUS_STYLE: Record<MyApprovalStatus, StatusBadgeStyle> = {
  pending: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-300",
    label: "Pending",
  },
  escalated: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-300",
    label: "Escalated",
  },
  approved: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-300",
    label: "Approved",
  },
  approved_with_conditions: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-300",
    label: "Approved w/ Conditions",
  },
  changes_requested: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-300",
    label: "Changes Requested",
  },
  rejected: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-300",
    label: "Rejected",
  },
  cancelled: {
    bg: "bg-white/[0.04]",
    border: "border-white/[0.08]",
    text: "text-muted-foreground",
    label: "Cancelled",
  },
  superseded: {
    bg: "bg-white/[0.04]",
    border: "border-white/[0.08]",
    text: "text-muted-foreground",
    label: "Superseded",
  },
  expired: {
    bg: "bg-white/[0.04]",
    border: "border-white/[0.08]",
    text: "text-muted-foreground",
    label: "Expired",
  },
};

const PENDING_SET = new Set<MyApprovalStatus>(["pending", "escalated"]);
const DECIDED_SET = new Set<MyApprovalStatus>([
  "approved",
  "approved_with_conditions",
  "rejected",
]);

export function MyApprovalsPage() {
  const navigate = useNavigate();
  const {
    approvals,
    pendingCount,
    decidedCount,
    changesRequestedCount,
    isLoading,
  } = useMyApprovals();
  const [filter, setFilter] = useState<FilterKey>("all");

  const visible = useMemo(() => {
    if (filter === "all") return approvals;
    if (filter === "pending")
      return approvals.filter((a) => PENDING_SET.has(a.status));
    if (filter === "decided")
      return approvals.filter((a) => DECIDED_SET.has(a.status));
    return approvals.filter((a) => a.status === "changes_requested");
  }, [approvals, filter]);

  const filterOptions: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: approvals.length },
    { key: "pending", label: "Pending", count: pendingCount },
    {
      key: "changes_requested",
      label: "Changes Requested",
      count: changesRequestedCount,
    },
    { key: "decided", label: "Decided", count: decidedCount },
  ];

  return (
    <div className="flex flex-col pb-20 max-w-lg mx-auto">
      {/* Header */}
      <div
        className="px-4 pt-3.5 pb-3 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => navigate("/sales/today")}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to Sales"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Sales
          </button>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-0.5">
              Submitted Approvals
            </p>
            <h1 className="text-[22px] font-black text-foreground tracking-[-0.02em]">
              My Approvals
            </h1>
          </div>
          {!isLoading && approvals.length > 0 && pendingCount > 0 && (
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.08em]">
                Pending
              </p>
              <p className="text-[15px] font-extrabold text-qep-orange">
                {pendingCount}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Filter chips — only when there's content to filter */}
      {!isLoading && approvals.length > 0 && (
        <div className="px-4 pt-2.5 pb-2 flex gap-1.5 overflow-x-auto scrollbar-none">
          {filterOptions.map((opt) => {
            const active = filter === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-bold transition-colors ${
                  active
                    ? "bg-qep-orange text-white"
                    : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.07]"
                }`}
                aria-pressed={active}
              >
                <span>{opt.label}</span>
                <span
                  className={`tabular-nums text-[10.5px] ${
                    active ? "text-white/85" : "text-muted-foreground/60"
                  }`}
                >
                  ({opt.count})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div className="px-4 py-3">
        {isLoading ? (
          <ApprovalsListSkeleton />
        ) : approvals.length === 0 ? (
          <EmptyApprovalsState />
        ) : visible.length === 0 ? (
          <p className="text-center text-[12px] text-muted-foreground/70 py-10">
            No approvals match this filter.
          </p>
        ) : (
          <ul role="list" className="flex flex-col gap-2.5">
            {visible.map((a) => (
              <li key={a.id}>
                <ApprovalRow approval={a} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── Row ───────────────────────────────────────────────── */

function ApprovalRow({ approval }: { approval: MyApprovalRow }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const style = STATUS_STYLE[approval.status];
  const isPending = PENDING_SET.has(approval.status);
  const isDecided = DECIDED_SET.has(approval.status);

  // Phase 3B quote-approval feedback loop — let the rep recall a pending
  // submission directly from the My Approvals list. Hidden for any case
  // that's already past pending/escalated so we don't flash an
  // affordance the server will reject anyway. The mutation lives on the
  // row (not the page) so concurrent withdrawals on multiple rows each
  // get their own pending state.
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const withdrawMutation = useMutation({
    mutationFn: ({ reason }: { reason: string | null }) =>
      withdrawApprovalCase(approval.id, reason),
    onSuccess: () => {
      toast({
        title: "Approval withdrawn",
        description: "Your quote is back in draft. Edit anything you need, then submit again.",
      });
      void queryClient.invalidateQueries({ queryKey: ["sales", "my-approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["sales", "qb-notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["quote-builder", "approval-case"] });
      void queryClient.invalidateQueries({
        queryKey: ["quote-builder", "approval-case", approval.quote_package_id],
      });
      setWithdrawOpen(false);
      setWithdrawReason("");
    },
    onError: (error) => {
      toast({
        title: "Couldn't withdraw approval",
        description: error instanceof Error ? error.message : "Try refreshing and withdrawing again.",
        variant: "destructive",
      });
    },
  });
  const canWithdraw = isPending && approval.decided_at === null;

  const customerLabel =
    approval.customer_name ||
    approval.customer_company ||
    "Untitled customer";

  const timeAgo = isDecided && approval.decided_at
    ? `Decided ${formatRelative(approval.decided_at)}`
    : `Submitted ${formatRelative(approval.submitted_at)}`;

  const manager = isPending
    ? approval.assigned_to_name
    : approval.decided_by_name;
  const managerLabel = isPending
    ? manager
      ? `Awaiting ${manager}`
      : approval.assigned_role
        ? `Awaiting ${humanizeRole(approval.assigned_role)}`
        : null
    : manager
      ? `Decided by ${manager}`
      : null;

  return (
    <div
      className="group relative bg-[hsl(var(--card))] border border-white/[0.06] rounded-2xl hover:bg-white/[0.03] transition-colors"
    >
      <button
        type="button"
        onClick={() => navigate(`/sales/quotes/${approval.quote_package_id}`)}
        className="block w-full text-left px-3.5 py-3 active:scale-[0.995] transition-transform"
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-foreground leading-tight truncate">
              {customerLabel}
            </p>
            <p className="text-[11px] text-muted-foreground/80 leading-snug mt-0.5 truncate">
              {approval.quote_number ?? "No quote number"}
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              {formatCurrency(approval.total_amount)}
              {approval.margin_pct !== null && (
                <>
                  <span className="mx-1.5 text-muted-foreground/40">·</span>
                  <span
                    className={
                      approval.margin_pct < 8 ? "text-amber-300" : "text-muted-foreground/80"
                    }
                  >
                    {approval.margin_pct.toFixed(1)}% margin
                  </span>
                </>
              )}
            </p>
          </div>
          <span
            className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${style.bg} ${style.border} ${style.text}`}
          >
            {style.label}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground/70">
          <span className="truncate">{timeAgo}</span>
          {managerLabel && (
            <span className="truncate text-right">{managerLabel}</span>
          )}
        </div>

        {approval.submission_note && (
          <p className="mt-2 text-[11.5px] italic text-muted-foreground/75 leading-snug line-clamp-2">
            &ldquo;{approval.submission_note}&rdquo;
          </p>
        )}

        {approval.decision_note && (
          <div className="mt-2 px-2.5 py-1.5 rounded-[10px] bg-white/[0.03] border border-white/[0.05]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60 mb-0.5">
              {approval.decided_by_name
                ? `${approval.decided_by_name} replied`
                : "Manager replied"}
            </p>
            <p className="text-[12px] text-foreground/85 leading-snug">
              {approval.decision_note}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end mt-1.5 text-qep-orange/70 group-hover:text-qep-orange transition-colors">
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </button>

      {/* Phase 3B quote-approval feedback loop — overflow menu with
          Withdraw for any case still pending/escalated. Pinned to the
          top-right of the row so the row body stays tappable. Hidden
          entirely for already-decided cases. */}
      {canWithdraw && (
        <div className="absolute top-1.5 right-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Approval actions"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/70 hover:bg-white/[0.05] hover:text-foreground transition-colors"
                data-testid={`my-approvals-row-menu-${approval.id}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setWithdrawReason("");
                  setWithdrawOpen(true);
                }}
                data-testid={`my-approvals-row-withdraw-${approval.id}`}
              >
                Withdraw submission
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {canWithdraw && (
        <Dialog
          open={withdrawOpen}
          onOpenChange={(open) => {
            if (!open) setWithdrawReason("");
            setWithdrawOpen(open);
          }}
        >
          <DialogContent className="max-w-md" data-testid={`my-approvals-withdraw-dialog-${approval.id}`}>
            <DialogHeader>
              <DialogTitle>Withdraw this approval submission?</DialogTitle>
              <DialogDescription>
                The quote will return to draft and the manager will no longer see it. You can edit anything you need and submit it again.
              </DialogDescription>
            </DialogHeader>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Reason (optional)</span>
              <textarea
                value={withdrawReason}
                onChange={(event) => setWithdrawReason(event.target.value.slice(0, 1000))}
                rows={3}
                className="w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
                placeholder="What changed? Helps the audit log explain why this case closed."
              />
            </label>
            <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setWithdrawOpen(false)}
                disabled={withdrawMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() =>
                  withdrawMutation.mutate({ reason: withdrawReason.trim() || null })
                }
                disabled={withdrawMutation.isPending}
              >
                {withdrawMutation.isPending ? "Withdrawing…" : "Withdraw submission"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ── Empty + loading ───────────────────────────────────── */

function ApprovalsListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-[hsl(var(--card))] border border-white/[0.06] rounded-2xl px-3.5 py-3"
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="space-y-1.5 flex-1">
              <div className="h-3 w-2/3 bg-white/[0.08] rounded" />
              <div className="h-2.5 w-1/2 bg-white/[0.05] rounded" />
            </div>
            <div className="h-4 w-16 bg-white/[0.06] rounded-full" />
          </div>
          <div className="h-2.5 w-3/4 bg-white/[0.04] rounded" />
        </div>
      ))}
    </div>
  );
}

function EmptyApprovalsState() {
  const navigate = useNavigate();
  return (
    <div className="px-1 pt-1 pb-4">
      <div
        className="relative overflow-hidden rounded-2xl px-5 pt-6 pb-5 mb-4"
        style={{
          background:
            "linear-gradient(135deg, #E87722 0%, #F29556 40%, #D86420 100%)",
          boxShadow:
            "0 8px 32px rgba(232,119,34,0.25), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/[0.08] blur-[40px]" />
        <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-white/[0.05] blur-[36px]" />

        <div className="relative flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0 border border-white/20">
            <ClipboardCheck className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-extrabold text-white/80 uppercase tracking-[0.14em] mb-1">
              Manager approvals
            </p>
            <h2 className="text-[19px] font-black text-white leading-[1.15] mb-2 tracking-[-0.01em]">
              No approvals submitted yet.
            </h2>
            <p className="text-[13px] text-white/85 leading-snug">
              When you submit a quote for manager approval, it&apos;ll appear
              here with status, decision notes, and a tap-through to the quote.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate("/sales/quotes/new")}
          className="group w-full flex items-center gap-3 px-3.5 py-3 rounded-[14px] border border-qep-orange/40 bg-qep-orange/10 hover:bg-qep-orange/15 text-left transition-all active:scale-[0.985]"
        >
          <div className="w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0 bg-qep-orange/20 text-qep-orange">
            <FileText className="w-[18px] h-[18px]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold leading-tight text-qep-orange">
              Draft a Quote
            </p>
            <p className="text-[11.5px] text-muted-foreground/80 leading-snug mt-0.5">
              Build a quote in the Quote Builder. Submit it for approval when
              it crosses margin or amount thresholds.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0 text-qep-orange transition-transform group-active:translate-x-0.5" />
        </button>

        <Link
          to="/sales/capture"
          className="group w-full flex items-center gap-3 px-3.5 py-3 rounded-[14px] border border-white/[0.07] bg-[hsl(var(--card))] hover:bg-white/[0.04] text-left transition-all active:scale-[0.985]"
        >
          <div className="w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0 bg-white/[0.05] text-foreground/80">
            <Mic className="w-[18px] h-[18px]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold leading-tight text-foreground">
              Capture a Visit
            </p>
            <p className="text-[11.5px] text-muted-foreground/80 leading-snug mt-0.5">
              Voice-capture the deal, then turn it into a quote when ready.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground/60 transition-transform group-active:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}

/* ── Formatters ────────────────────────────────────────── */

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function humanizeRole(role: string): string {
  switch (role) {
    case "manager":
      return "Manager";
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "branch_sales_manager":
      return "Branch Sales Manager";
    case "branch_general_manager":
      return "Branch GM";
    default:
      return role.replace(/_/g, " ");
  }
}
