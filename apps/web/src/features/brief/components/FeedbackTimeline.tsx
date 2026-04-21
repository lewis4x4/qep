/**
 * FeedbackTimeline — Build Hub v2.1 inline event ledger.
 *
 * Renders the ordered list of hub_feedback_events for a single feedback
 * row, newest first. Each step shows:
 *   - status badge (colored by event type)
 *   - relative timestamp
 *   - actor role (client / admin / service)
 *   - artifact chips (PR link, merge SHA, etc.)
 *
 * Design goals:
 *   - "Heard" tenet: the stakeholder sees *something happened* at a glance.
 *     The timeline is never empty — migration 321 backfills a 'submitted'
 *     event for every pre-existing row.
 *   - Lazy-expand: card closed = summary ("triaged 3m ago · pr_opened now"),
 *     card open = full list. Keeps the inbox scannable.
 *   - Theme-token colors only. Dark mode works without overrides.
 */
import { useQuery } from "@tanstack/react-query";
import {
  CircleDashed,
  CircleDot,
  ExternalLink,
  GitPullRequest,
  Link2,
  Loader2,
  PlayCircle,
  Rocket,
  ShieldOff,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  listFeedbackEvents,
  type FeedbackEventType,
  type HubFeedbackEventRow,
} from "../lib/brief-api";

interface FeedbackTimelineProps {
  feedbackId: string;
  /** If true, only show the 3 most recent events. Used in collapsed cards. */
  compact?: boolean;
  /** Polling interval in ms. 0 disables. Default 30_000 matches the inbox. */
  refetchInterval?: number;
}

const EVENT_LABEL: Record<FeedbackEventType, string> = {
  submitted: "Submitted",
  triaged: "Triaged by Claude",
  drafting_started: "Draft started",
  pr_opened: "Draft PR opened",
  awaiting_merge: "Awaiting merge",
  merged: "Merged to main",
  shipped: "Shipped",
  wont_fix: "Won't fix",
  reopened: "Reopened",
  admin_note: "Admin note",
  duplicate_linked: "Linked to existing",
  preview_ready: "Preview live",
};

const EVENT_TONE: Record<FeedbackEventType, string> = {
  submitted: "bg-muted text-foreground",
  triaged: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  drafting_started: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  pr_opened: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  awaiting_merge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  merged: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  shipped: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  wont_fix: "bg-muted text-muted-foreground line-through",
  reopened: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  admin_note: "bg-muted text-muted-foreground",
  duplicate_linked: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  preview_ready: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

function eventIcon(kind: FeedbackEventType): ReactNode {
  switch (kind) {
    case "submitted":
      return <CircleDashed className="h-3.5 w-3.5" aria-hidden />;
    case "triaged":
      return <Sparkles className="h-3.5 w-3.5" aria-hidden />;
    case "drafting_started":
      return <CircleDot className="h-3.5 w-3.5" aria-hidden />;
    case "pr_opened":
    case "awaiting_merge":
      return <GitPullRequest className="h-3.5 w-3.5" aria-hidden />;
    case "merged":
    case "shipped":
      return <Rocket className="h-3.5 w-3.5" aria-hidden />;
    case "wont_fix":
      return <ShieldOff className="h-3.5 w-3.5" aria-hidden />;
    case "reopened":
      return <Undo2 className="h-3.5 w-3.5" aria-hidden />;
    case "duplicate_linked":
      return <Link2 className="h-3.5 w-3.5" aria-hidden />;
    case "preview_ready":
      return <PlayCircle className="h-3.5 w-3.5" aria-hidden />;
    default:
      return <CircleDashed className="h-3.5 w-3.5" aria-hidden />;
  }
}

export function FeedbackTimeline({
  feedbackId,
  compact = false,
  refetchInterval = 30_000,
}: FeedbackTimelineProps) {
  const eventsQuery = useQuery({
    queryKey: ["hub-feedback-events", feedbackId],
    queryFn: () => listFeedbackEvents(feedbackId, 50),
    refetchInterval: refetchInterval > 0 ? refetchInterval : false,
    staleTime: 10_000,
  });

  if (eventsQuery.isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading timeline…
      </div>
    );
  }

  if (eventsQuery.error) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Couldn't load timeline: {(eventsQuery.error as Error).message}
      </p>
    );
  }

  const events = eventsQuery.data ?? [];
  if (events.length === 0) return null;

  // Render oldest → newest top-to-bottom for timeline readability (reverse
  // the DB's DESC ordering).
  const chrono = [...events].reverse();
  const visible = compact ? chrono.slice(-3) : chrono;

  return (
    <ol
      aria-label="Feedback timeline"
      className="mt-3 space-y-1.5 border-t border-border pt-3"
    >
      {visible.map((ev) => (
        <TimelineStep key={ev.id} event={ev} />
      ))}
    </ol>
  );
}

function TimelineStep({ event }: { event: HubFeedbackEventRow }) {
  const label = EVENT_LABEL[event.event_type] ?? event.event_type;
  const tone = EVENT_TONE[event.event_type] ?? "bg-muted text-muted-foreground";
  const when = safeRelativeTime(event.created_at);
  const prUrl =
    (event.payload?.claude_pr_url as string | undefined)
    ?? null;
  const priority = (event.payload?.priority as string | undefined) ?? null;
  const aiSummary = (event.payload?.ai_summary as string | undefined) ?? null;

  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${tone}`}
      >
        {eventIcon(event.event_type)}
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground">
          {when}
          {event.actor_role && event.actor_role !== "service" && (
            <> · {event.actor_role}</>
          )}
          {event.event_type === "triaged" && priority && (
            <> · priority {priority}</>
          )}
        </p>
        {event.event_type === "triaged" && aiSummary && (
          <p className="mt-0.5 truncate text-foreground">{aiSummary}</p>
        )}
        {prUrl && (event.event_type === "pr_opened" || event.event_type === "shipped") && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-0.5 inline-flex items-center text-sky-600 hover:underline dark:text-sky-400"
          >
            View PR
            <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
          </a>
        )}
        {event.event_type === "preview_ready" && (() => {
          // v3.1: link straight to the Netlify preview so the timeline
          // step is actionable, not just informational. The poll fn
          // stashes the URL under `claude_preview_url` in the payload.
          const previewUrl =
            (event.payload?.claude_preview_url as string | undefined) ?? null;
          return previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-0.5 inline-flex items-center font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Open preview
              <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
            </a>
          ) : null;
        })()}
      </div>
    </li>
  );
}

function safeRelativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diffMs)) return iso;
    const absSec = Math.max(1, Math.floor(Math.abs(diffMs) / 1000));
    if (absSec < 60) return `${absSec}s ago`;
    const min = Math.floor(absSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    const wk = Math.floor(day / 7);
    if (wk < 5) return `${wk}w ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
