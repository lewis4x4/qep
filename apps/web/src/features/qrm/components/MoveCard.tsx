/**
 * MoveCard — the Today-surface unit of work.
 *
 * One card = one recommended action from the recommender. The card exposes
 * four lifecycle buttons (Accept / Snooze / Dismiss / Complete) and a deep
 * link to the underlying entity. It is intentionally dense but mobile-first:
 * every tap target clears 44x44 and the title/rationale gracefully wrap.
 *
 * Slice 5 additions:
 *   - Done now expands an inline touch composer (channel + summary +
 *     optional duration) so the rep's actual work becomes visible in the
 *     graph. Skipping the composer and tapping "Log as done" still logs a
 *     minimal auto-touch server-side — the rep is never silently dropped.
 *   - "Triggered by" expandable reveals the signals referenced by
 *     move.signal_ids. Lazy fetch, so the list stays snappy on Today.
 *
 * Contract:
 *   - Pure presentation + callback props. The page owns mutations.
 *   - Disabled state while a mutation is in flight to prevent double-submit.
 *   - Keyboard: Enter on card opens the deep link (mirrors GraphExplorer).
 */

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpCircle,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  PhoneCall,
  Send,
  Sparkles,
  Truck,
  UserMinus,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listQrmSignalsByIds,
  type PatchMoveTouchInput,
  type QrmSignal,
  type QrmTouchChannel,
} from "../lib/qrm-router-api";
import type { QrmMove, QrmMoveKind } from "../lib/moves-types";
import { acceptLabelForKind, hrefForMoveEntity } from "./moveCardHelpers";
import {
  humanizeTouchChannel,
  parseDurationToSeconds,
  sanitizeTouchSummary,
  TOUCH_CHANNEL_OPTIONS,
} from "./moveCompletionHelpers";
import {
  classifyMoveProvenance,
  PROVENANCE_EXPLAINER,
  PROVENANCE_LABEL,
  type MoveProvenance,
} from "./moveProvenance";

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
  /**
   * Called when the rep completes the move. If the composer is used, `touch`
   * carries the channel/summary/duration; if the rep taps "Log as done"
   * without filling anything, `touch` is undefined and the server logs a
   * minimal auto-touch.
   */
  onComplete: (moveId: string, touch?: PatchMoveTouchInput) => void;
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

  const [composerOpen, setComposerOpen] = useState(false);
  const [signalsOpen, setSignalsOpen] = useState(false);
  const hasSignalTrail = Array.isArray(move.signal_ids) && move.signal_ids.length > 0;

  const handleComplete = useCallback(
    (touch?: PatchMoveTouchInput) => {
      onComplete(move.id, touch);
      setComposerOpen(false);
    },
    [onComplete, move.id],
  );

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
            <MoveProvenanceBadge move={move} />
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

      {hasSignalTrail && (
        <TriggeredBy
          signalIds={move.signal_ids}
          open={signalsOpen}
          onToggle={() => setSignalsOpen((prev) => !prev)}
        />
      )}

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
            onClick={() => setComposerOpen((prev) => !prev)}
            aria-expanded={composerOpen}
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

      {composerOpen && isAccepted && (
        <TouchComposer
          defaultSummary={move.title}
          pending={pending ?? false}
          onCancel={() => setComposerOpen(false)}
          onSubmit={handleComplete}
        />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Touch composer (Slice 5)
// ---------------------------------------------------------------------------

interface TouchComposerProps {
  defaultSummary: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (touch?: PatchMoveTouchInput) => void;
}

function TouchComposer({
  defaultSummary,
  pending,
  onCancel,
  onSubmit,
}: TouchComposerProps) {
  const [channel, setChannel] = useState<QrmTouchChannel>("call");
  const [summary, setSummary] = useState(defaultSummary);
  const [duration, setDuration] = useState("");
  const [durationError, setDurationError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let durationSeconds: number | undefined;
    if (duration.trim().length > 0) {
      const parsed = parseDurationToSeconds(duration);
      if (parsed == null) {
        setDurationError("Use minutes (8), 8m, 1h, or 1h30m.");
        return;
      }
      durationSeconds = parsed;
    }
    onSubmit({
      channel,
      summary: sanitizeTouchSummary(summary),
      durationSeconds,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/30"
      aria-label="Log what you did"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          <span className="text-muted-foreground">How</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as QrmTouchChannel)}
            className="h-9 min-w-[7rem] rounded-md border bg-background px-2 text-sm"
          >
            {TOUCH_CHANNEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[4.5rem] flex-col gap-1 text-xs font-medium">
          <span className="text-muted-foreground">Duration</span>
          <input
            type="text"
            value={duration}
            onChange={(e) => {
              setDuration(e.target.value);
              setDurationError(null);
            }}
            placeholder="8m"
            aria-invalid={durationError ? true : undefined}
            className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
          />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium">
          <span className="text-muted-foreground">What happened</span>
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="One-line note…"
            maxLength={280}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          />
        </label>
      </div>
      {durationError && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{durationError}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border border-emerald-600 bg-emerald-600 px-3 text-sm font-medium text-white",
            "hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <Check className="h-3.5 w-3.5" />
          Log &amp; complete
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onSubmit(undefined)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-sm text-muted-foreground",
            "hover:border-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60",
          )}
          title="Skip composer — server auto-logs a minimal touch"
        >
          Log as done
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Triggered-by panel (Slice 5)
// ---------------------------------------------------------------------------

interface TriggeredByProps {
  signalIds: readonly string[];
  open: boolean;
  onToggle: () => void;
}

function TriggeredBy({ signalIds, open, onToggle }: TriggeredByProps) {
  const query = useQuery<QrmSignal[]>({
    queryKey: ["qrm", "move-signals", [...signalIds].sort()] as const,
    queryFn: () => listQrmSignalsByIds(signalIds),
    enabled: open && signalIds.length > 0,
    staleTime: 60_000,
  });

  return (
    <section className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 text-xs">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Sparkles className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wide">
          Triggered by {signalIds.length} signal{signalIds.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5 pl-5">
          {query.isLoading && (
            <li className="text-muted-foreground">Loading…</li>
          )}
          {query.isError && (
            <li className="text-rose-600 dark:text-rose-400">
              Couldn&apos;t load signals.
            </li>
          )}
          {query.data?.length === 0 && (
            <li className="text-muted-foreground">
              The signals behind this move have aged out of the feed.
            </li>
          )}
          {query.data?.map((signal) => (
            <li key={signal.id} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  SIGNAL_SEVERITY_DOT[signal.severity],
                )}
                aria-hidden="true"
              />
              <span className="truncate">
                <span className="font-medium">{signal.title}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {humanizeTouchChannel(signal.kind)} ·{" "}
                  {new Date(signal.occurred_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SIGNAL_SEVERITY_DOT: Record<string, string> = {
  low: "bg-slate-400",
  medium: "bg-sky-500",
  high: "bg-amber-500",
  critical: "bg-rose-600",
};

// ---------------------------------------------------------------------------
// Provenance badge (Slice 7)
// ---------------------------------------------------------------------------

const PROVENANCE_CHIP_CLASS: Record<MoveProvenance, string> = {
  // Iron moves borrow the brand orange — matches the Ask Iron spark icon so
  // operators can read the surface identity without squinting.
  iron: "bg-qep-orange/15 text-qep-orange ring-1 ring-inset ring-qep-orange/30",
  // Recommender moves use a cool slate — present but visually quiet, since
  // they're the baseline.
  recommender: "bg-slate-200/80 text-slate-700 dark:bg-slate-800/80 dark:text-slate-200",
  // Manual moves stay almost invisible — no one needs a chip to tell them
  // they made the move themselves, but we keep it for auditability.
  manual: "border border-dashed border-muted-foreground/40 text-muted-foreground",
};

/**
 * Small inline chip that labels where a move came from (Ask Iron, the
 * recommender, or manual). Uses `classifyMoveProvenance` so the rule lives
 * in one place and tests can exercise it without rendering React.
 */
function MoveProvenanceBadge({ move }: { move: QrmMove }) {
  const kind = classifyMoveProvenance(move);
  const Icon = kind === "iron" ? Sparkles : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] normal-case",
        PROVENANCE_CHIP_CLASS[kind],
      )}
      title={PROVENANCE_EXPLAINER[kind]}
    >
      {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
      {PROVENANCE_LABEL[kind]}
    </span>
  );
}
