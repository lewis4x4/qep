/**
 * MoveCard — the Today-surface unit of work.
 *
 * One card = one recommended action from the recommender. The card exposes
 * four lifecycle buttons (Accept / Snooze / Dismiss / Complete) and a deep
 * link to the underlying entity. It is intentionally dense but mobile-first:
 * every tap target clears 44x44 and the title/rationale gracefully wrap.
 *
 * Contract:
 *   - Pure presentation + callback props. The page owns mutations.
 *   - Disabled state while a mutation is in flight to prevent double-submit.
 *   - Keyboard: Enter on card opens the deep link (mirrors GraphExplorer).
 */

import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpCircle,
  Calendar,
  Check,
  Clock,
  FileText,
  PhoneCall,
  Send,
  Truck,
  UserMinus,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { QrmMove, QrmMoveKind } from "../lib/moves-types";
import { acceptLabelForKind, hrefForMoveEntity } from "./moveCardHelpers";

const MOVE_ICON: Record<QrmMoveKind, typeof PhoneCall> = {
  call_now: PhoneCall,
  send_quote: FileText,
  send_follow_up: Send,
  schedule_meeting: Calendar,
  escalate: ArrowUpCircle,
  drop_deal: X,
  reassign: UserMinus,
  field_visit: Truck,
  send_proposal: FileText,
  pricing_review: AlertTriangle,
  inventory_reserve: Truck,
  service_escalate: Wrench,
  rescue_offer: AlertTriangle,
  other: Clock,
};

const MOVE_INTENT_BG: Record<QrmMoveKind, string> = {
  call_now: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  send_quote: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  send_follow_up: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  schedule_meeting: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  escalate: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  drop_deal: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
  reassign: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
  field_visit: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  send_proposal: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  pricing_review: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  inventory_reserve: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  service_escalate: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  rescue_offer: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  other: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

interface MoveCardProps {
  move: QrmMove;
  pending?: boolean;
  onAccept: (moveId: string) => void;
  onSnooze: (moveId: string) => void;
  onDismiss: (moveId: string) => void;
  onComplete: (moveId: string) => void;
}

export function MoveCard({
  move,
  pending,
  onAccept,
  onSnooze,
  onDismiss,
  onComplete,
}: MoveCardProps) {
  const Icon = MOVE_ICON[move.kind];
  const href = hrefForMoveEntity(move);
  const isAccepted = move.status === "accepted";

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm transition",
        pending && "opacity-60",
      )}
      aria-labelledby={`move-${move.id}-title`}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            MOVE_INTENT_BG[move.kind],
          )}
        >
          <Icon className="h-5 w-5" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3
            id={`move-${move.id}-title`}
            className="truncate text-sm font-semibold tracking-tight"
          >
            {move.title}
          </h3>
          {move.rationale && (
            <p className="text-sm text-muted-foreground">{move.rationale}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className={cn("rounded-full px-2 py-0.5", MOVE_INTENT_BG[move.kind])}>
              {move.kind.replace(/_/g, " ")}
            </span>
            {typeof move.confidence === "number" && (
              <span>{Math.round(move.confidence * 100)}% confident</span>
            )}
            <span>priority {move.priority}</span>
            {isAccepted && <span className="text-emerald-600 dark:text-emerald-400">accepted</span>}
            {move.due_at && (
              <span>
                due {new Date(move.due_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
        </div>
      </header>

      <footer className="flex flex-wrap items-center gap-2">
        {!isAccepted ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAccept(move.id)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground",
              "hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <Check className="h-3.5 w-3.5" />
            {acceptLabelForKind(move.kind)}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => onComplete(move.id)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border border-emerald-600 bg-emerald-600 px-3 text-sm font-medium text-white",
              "hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <Check className="h-3.5 w-3.5" />
            Done
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => onSnooze(move.id)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-sm text-muted-foreground",
            "hover:border-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          Snooze
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={() => onDismiss(move.id)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-sm text-muted-foreground",
            "hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <X className="h-3.5 w-3.5" />
          Dismiss
        </button>

        {href && (
          <Link
            to={href}
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            Open {move.entity_type} →
          </Link>
        )}
      </footer>
    </article>
  );
}
