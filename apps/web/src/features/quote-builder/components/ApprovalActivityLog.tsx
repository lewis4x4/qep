/**
 * Phase 2B — Approval Activity Log.
 *
 * Compact vertical timeline that renders the full chronological story
 * of a quote's approval journey: submission, routing, decision, and
 * post-approval auto-send. Shared by both rep and manager views so
 * everyone sees the same audit trail with the same visual weight.
 *
 * The component is purely presentational. All data flows in via props
 * (approvalCase + optional conditions + optional autoSend); fetching is
 * the parent's job.
 *
 * Visual contract:
 *  - Vertical 2px line on the left, with status-tinted circular dots
 *  - Each row: icon + bold title + relative time + actor in muted text
 *  - Notes (submission/decision) indent under the row at muted weight
 *  - Conditions render as small pills below the decided event
 *  - Mobile-first; works inside QuoteReviewWorkflowPanels' bottom-sheet
 */

import { useMemo } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  RefreshCw,
  Send,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  QuoteApprovalCaseSummary,
  QuoteApprovalCondition,
  QuoteApprovalConditionDraft,
  QuoteApprovalConditionType,
  QuoteAutoSendResult,
} from "../../../../../../shared/qep-moonshot-contracts";

// ─── Public surface ────────────────────────────────────────────────────────

/**
 * Accept either the normalized contract shape or a draft (manager
 * dialog state) so the same log component renders before, during, and
 * after a decision without forking.
 */
export type ApprovalActivityLogCondition =
  | QuoteApprovalCondition
  | QuoteApprovalConditionDraft;

export interface ApprovalActivityLogProps {
  approvalCase: QuoteApprovalCaseSummary;
  conditions?: ApprovalActivityLogCondition[];
  /**
   * Post-approval auto-send outcome (when the policy auto-routes the
   * quote to the customer immediately after approval). When provided
   * AND attempted, renders a final "Auto-sent" event in the timeline.
   */
  autoSend?: QuoteAutoSendResult | null;
  /**
   * Caller-supplied display names keyed by user id. Overrides the
   * embedded submittedByName / decidedByName when present. Useful when
   * the parent already has a profiles map cached.
   */
  actorNames?: Record<string, string>;
  className?: string;
}

// ─── Internal types ────────────────────────────────────────────────────────

type DotTone =
  | "muted"
  | "info"
  | "emerald"
  | "amber"
  | "rose"
  | "orange";

interface TimelineEvent {
  key: string;
  title: string;
  actor: string | null;
  at: string | null;
  note: string | null;
  icon: LucideIcon;
  tone: DotTone;
  conditions?: ApprovalActivityLogCondition[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const DOT_TONE: Record<DotTone, { dot: string; ring: string; icon: string }> = {
  muted:   { dot: "bg-muted-foreground/40", ring: "ring-muted-foreground/15", icon: "text-muted-foreground" },
  info:    { dot: "bg-sky-400",             ring: "ring-sky-400/20",          icon: "text-sky-300" },
  emerald: { dot: "bg-emerald-400",         ring: "ring-emerald-400/20",      icon: "text-emerald-300" },
  amber:   { dot: "bg-amber-400",           ring: "ring-amber-400/20",        icon: "text-amber-300" },
  rose:    { dot: "bg-rose-400",            ring: "ring-rose-400/20",         icon: "text-rose-300" },
  orange:  { dot: "bg-qep-orange",          ring: "ring-qep-orange/20",       icon: "text-qep-orange" },
};

function prettyRouteLabel(role: string | null, routeMode: string): string {
  const normalized = (role ?? routeMode).toString().toLowerCase();
  if (normalized.includes("owner")) return "Owner";
  if (normalized.includes("admin")) return "Admin";
  if (normalized.includes("general")) return "Branch General Manager";
  if (normalized.includes("sales")) return "Branch Sales Manager";
  if (normalized.includes("manager")) return "Manager";
  // Fall back to spaced version of the raw role.
  return (role ?? routeMode).toString().replace(/_/g, " ");
}

function decisionLabelForStatus(status: string): { title: string; tone: DotTone; icon: LucideIcon } {
  switch (status) {
    case "approved":
      return { title: "Approved", tone: "emerald", icon: CheckCircle2 };
    case "approved_with_conditions":
      return { title: "Approved with conditions", tone: "emerald", icon: ShieldCheck };
    case "changes_requested":
      return { title: "Changes requested", tone: "amber", icon: RefreshCw };
    case "rejected":
      return { title: "Rejected", tone: "rose", icon: XCircle };
    case "escalated":
      return { title: "Escalated", tone: "orange", icon: ArrowRight };
    case "superseded":
      return { title: "Superseded by new version", tone: "muted", icon: CircleDashed };
    case "cancelled":
      return { title: "Cancelled", tone: "muted", icon: CircleDashed };
    case "expired":
      return { title: "Expired", tone: "muted", icon: CircleAlert };
    default:
      return { title: "Decided", tone: "info", icon: CheckCircle2 };
  }
}

/**
 * Render a condition_payload_json into a short human label.
 * Falls back to the condition_type if no specific key is recognized.
 */
function prettyConditionLabel(
  type: QuoteApprovalConditionType,
  payload: Record<string, unknown>,
): string {
  const num = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const str = (value: unknown): string | null => {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  const moneyShort = (value: number): string => {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
    return `$${Math.round(value)}`;
  };

  switch (type) {
    case "min_margin_pct": {
      const v = num(payload.min_margin_pct);
      return v != null ? `Min margin ${v}%` : "Min margin";
    }
    case "max_trade_allowance": {
      const v = num(payload.max_trade_allowance);
      return v != null ? `Max trade ${moneyShort(v)}` : "Max trade";
    }
    case "required_cash_down": {
      const v = num(payload.required_cash_down ?? payload.amount);
      return v != null ? `Cash down ${moneyShort(v)}` : "Cash down required";
    }
    case "required_finance_scenario": {
      const v = str(payload.required_finance_scenario);
      return v ? `Finance: ${v}` : "Finance scenario required";
    }
    case "remove_attachment": {
      const v = str(payload.attachment_title);
      return v ? `Remove: ${v}` : "Remove attachment";
    }
    case "expiry_hours": {
      const v = num(payload.expiry_hours);
      return v != null ? `Expires in ${v}h` : "Expiry window";
    }
    default:
      return String(type).replace(/_/g, " ");
  }
}

function getConditionPayload(condition: ApprovalActivityLogCondition): Record<string, unknown> {
  // Contract uses `conditionPayload`; some legacy callers may still
  // hand us snake_case. Accept both for forward-compat.
  // deno-lint-ignore no-explicit-any
  const anyCond = condition as any;
  if (anyCond.conditionPayload && typeof anyCond.conditionPayload === "object") {
    return anyCond.conditionPayload as Record<string, unknown>;
  }
  if (anyCond.condition_payload && typeof anyCond.condition_payload === "object") {
    return anyCond.condition_payload as Record<string, unknown>;
  }
  return {};
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  if (ms < 0) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 14) return `${days}d ago`;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return `${days}d ago`;
  }
}

function formatExactTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function resolveActorName(
  fallbackName: string | null,
  userId: string | null,
  actorNames: Record<string, string> | undefined,
): string | null {
  if (userId && actorNames && actorNames[userId]) return actorNames[userId];
  if (fallbackName && fallbackName.trim() !== "") return fallbackName.trim();
  return null;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ApprovalActivityLog({
  approvalCase,
  conditions,
  autoSend,
  actorNames,
  className,
}: ApprovalActivityLogProps) {
  const events = useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];

    // 1. Submitted
    const submittedByName = resolveActorName(
      approvalCase.submittedByName,
      approvalCase.submittedBy,
      actorNames,
    );
    list.push({
      key: "submitted",
      title: "Submitted for approval",
      actor: submittedByName,
      at: approvalCase.submittedAt,
      note: approvalCase.submissionNote ?? null,
      icon: Upload,
      tone: "info",
    });

    // 2. Routed (informational) — only when there's a meaningful target.
    const routedTo = prettyRouteLabel(approvalCase.assignedRole, approvalCase.routeMode);
    const assignedName = resolveActorName(
      approvalCase.assignedToName,
      approvalCase.assignedTo,
      actorNames,
    );
    if (routedTo && routedTo.trim() !== "") {
      list.push({
        key: "routed",
        title: `Routed to ${routedTo}`,
        actor: assignedName,
        // No discrete route timestamp on the schema; the submission
        // event timestamp doubles as the routed timestamp because they
        // happen in the same transaction. Leaving it null keeps the
        // row visually muted — the position in the timeline tells the
        // story without competing for the eye against real timestamps.
        at: null,
        note: null,
        icon: ArrowRight,
        tone: "muted",
      });
    }

    // 3. Decided
    if (approvalCase.decidedAt) {
      const decisionMeta = decisionLabelForStatus(approvalCase.status);
      const decidedByName = resolveActorName(
        approvalCase.decidedByName,
        approvalCase.decidedBy,
        actorNames,
      );
      list.push({
        key: "decided",
        title: decisionMeta.title,
        actor: decidedByName,
        at: approvalCase.decidedAt,
        note: approvalCase.decisionNote ?? null,
        icon: decisionMeta.icon,
        tone: decisionMeta.tone,
        conditions: conditions && conditions.length > 0
          ? conditions
          : approvalCase.conditions,
      });
    }

    // 4. Auto-sent to customer (only when policy auto-send actually fired).
    if (autoSend?.attempted) {
      list.push({
        key: "auto-sent",
        title: autoSend.sent ? "Auto-sent to customer" : "Auto-send attempted",
        actor: null,
        at: null,
        note: autoSend.sent
          ? null
          : (autoSend.error ?? autoSend.reason ?? "Auto-send did not complete."),
        icon: Send,
        tone: autoSend.sent ? "emerald" : "amber",
      });
    }

    return list;
  }, [approvalCase, conditions, autoSend, actorNames]);

  const isPending = approvalCase.status === "pending"
    || approvalCase.status === "escalated" && !approvalCase.decidedAt;
  const waitingFor = prettyRouteLabel(approvalCase.assignedRole, approvalCase.routeMode);

  return (
    <section
      className={cn(
        "rounded-lg border border-border/60 bg-background/40 p-3",
        className,
      )}
      data-testid="approval-activity-log"
      aria-label="Approval activity log"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.16em]">
          Approval Activity
        </span>
      </div>

      <ol className="relative space-y-3 pl-1">
        {events.map((event, index) => {
          const isLast = index === events.length - 1;
          const tone = DOT_TONE[event.tone];
          const Icon = event.icon;
          return (
            <li
              key={event.key}
              className="relative flex gap-3"
              data-testid={`approval-activity-event-${event.key}`}
            >
              {/* Dot + connector */}
              <div className="relative w-3 shrink-0">
                <span
                  className={cn(
                    "absolute left-0 top-[6px] inline-flex h-2.5 w-2.5 rounded-full ring-4",
                    tone.dot,
                    tone.ring,
                  )}
                  aria-hidden="true"
                />
                {!isLast && (
                  <span
                    className="absolute left-[5px] top-[18px] w-px h-[calc(100%+12px)] bg-border/70"
                    aria-hidden="true"
                  />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold text-foreground")}>
                    <Icon className={cn("h-3.5 w-3.5", tone.icon)} aria-hidden="true" />
                    {event.title}
                  </span>
                  {event.at && (
                    <span
                      className="text-[11px] text-muted-foreground tabular-nums"
                      title={formatExactTime(event.at) || undefined}
                    >
                      {formatRelativeTime(event.at)}
                    </span>
                  )}
                </div>
                {event.actor && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    by <span className="text-foreground/80">{event.actor}</span>
                  </p>
                )}
                {event.note && (
                  <p className="mt-1.5 rounded border border-border/60 bg-card/40 px-2.5 py-1.5 text-xs leading-snug text-muted-foreground">
                    {event.note}
                  </p>
                )}
                {event.conditions && event.conditions.length > 0 && (
                  <div
                    className="mt-1.5 flex flex-wrap gap-1"
                    data-testid="approval-activity-conditions"
                  >
                    {event.conditions.map((condition, conditionIndex) => (
                      <span
                        key={`${event.key}-cond-${conditionIndex}`}
                        className="inline-flex items-center rounded-full border border-border/60 bg-card/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {prettyConditionLabel(
                          condition.conditionType,
                          getConditionPayload(condition),
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {isPending && (
        <p
          className="mt-3 pl-4 text-[11px] text-muted-foreground"
          data-testid="approval-activity-waiting"
        >
          Waiting for {waitingFor || "approver"} decision…
        </p>
      )}
    </section>
  );
}

export default ApprovalActivityLog;
