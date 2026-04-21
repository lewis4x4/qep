/**
 * NotificationBell — Build Hub v2.1 unseen-events indicator.
 *
 * Mounted in BriefNav. Shows a dot + count when the current user has
 * hub_feedback_events newer than their last_seen_events_at bookmark on any
 * of their own feedback rows. Clicking the bell navigates to /brief/feedback
 * and stamps last_seen_events_at = now() via the hub_feedback_mark_seen RPC.
 *
 * Design:
 *   - Polling every 30 s (useQuery.refetchInterval). Real-time upgrade is
 *     V3.5 in the roadmap; 30 s is plenty for a feedback-reply cadence.
 *   - On click, optimistic dot-clear: we invalidate the unseen query
 *     *after* navigation + stamping, so the dot disappears on the next
 *     tick without the user staring at stale state.
 *   - Theme-token colors throughout. Dark mode works out of the box.
 *   - Accessibility: aria-label reflects count. Keyboard-focusable. Dot is
 *     aria-hidden so the label carries the semantic meaning.
 *
 * Zero-blocking:
 *   - If countUnseenFeedbackEvents errors (e.g., user never submitted
 *     feedback, RLS blocks, network glitch), the bell silently renders as
 *     "no dot" — never hides the nav, never throws.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  countUnseenFeedbackEvents,
  markFeedbackEventsSeen,
} from "../lib/brief-api";

interface NotificationBellProps {
  userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const unseenQuery = useQuery({
    queryKey: ["hub-feedback-unseen", userId],
    queryFn: () => countUnseenFeedbackEvents(userId),
    refetchInterval: 30_000,
    staleTime: 15_000,
    // Silent failure: render as "no dot" if the count errors.
    retry: 1,
  });

  const markSeenMutation = useMutation({
    mutationFn: () => markFeedbackEventsSeen(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-feedback-unseen", userId] });
      queryClient.invalidateQueries({ queryKey: ["hub-feedback"] });
    },
  });

  const total = unseenQuery.data?.total ?? 0;
  const hasUnseen = total > 0;
  const displayCount = total > 99 ? "99+" : String(total);

  const onClick = () => {
    // Navigate first, then stamp. This way the user sees their inbox
    // immediately; the stamp is a background concern.
    navigate("/brief/feedback");
    if (hasUnseen) {
      markSeenMutation.mutate();
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        hasUnseen
          ? `Feedback updates: ${total} unread`
          : "Feedback updates (no unread)"
      }
      className="relative inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-4 w-4" aria-hidden />
      {hasUnseen && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
        >
          {displayCount}
        </span>
      )}
    </button>
  );
}
