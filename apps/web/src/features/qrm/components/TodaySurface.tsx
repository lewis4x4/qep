/**
 * TodaySurface — the "one list of moves" surface in the 4-surface shell.
 *
 * The rep opens the app and sees: "Here are the plays you should run today."
 * No inbox, no tabs, no pipelines to hunt through. Just a ranked list of
 * recommended moves with one-tap acceptance.
 *
 * This component is feature-flagged via shell_v2 and rendered on
 * /qrm/activities when the flag is on. When off, the legacy TodayFeedPage
 * is kept in place.
 *
 * Data contract:
 *   - Pulls moves from /qrm/moves (default: rep's own active queue).
 *   - Mutates via PATCH /qrm/moves/:id with optimistic UI.
 *   - Elevated callers can toggle "All reps" to inspect the team queue.
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  listQrmMoves,
  patchQrmMove,
  type PatchMoveTouchInput,
  type QrmMove,
  type QrmMoveAction,
} from "../lib/qrm-router-api";
import { MoveCard } from "./MoveCard";

type Scope = "mine" | "team";

interface TodaySurfaceProps {
  /** Initial scope. Defaults to "mine". */
  defaultScope?: Scope;
  className?: string;
}

export function TodaySurface({ defaultScope = "mine", className }: TodaySurfaceProps) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  const userId = profile?.id ?? null;
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const isElevated = role === "admin" || role === "manager" || role === "owner";

  const queryKey = useMemo(
    () => ["qrm", "today-moves", scope, userId ?? "anon"] as const,
    [scope, userId],
  );

  const movesQuery = useQuery<QrmMove[]>({
    queryKey,
    queryFn: () =>
      listQrmMoves({
        statuses: ["suggested", "accepted"],
        // When the rep picks "team", drop the rep scope so elevated callers
        // see everyone; otherwise let the backend default (rep → own).
        assignedRepId: scope === "team" && isElevated ? null : undefined,
        limit: 100,
      }),
    staleTime: 30_000,
  });

  const moves = movesQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: async ({
      moveId,
      action,
      snoozedUntil,
      touch,
    }: {
      moveId: string;
      action: QrmMoveAction;
      snoozedUntil?: string;
      touch?: PatchMoveTouchInput;
    }) => patchQrmMove(moveId, { action, snoozedUntil, touch }),
    onMutate: async ({ moveId }) => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(moveId);
        return next;
      });
    },
    onSettled: async (_result, _err, vars) => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(vars.moveId);
        return next;
      });
      // When a move completes, the server may have suppressed Pulse signals.
      // Invalidate signal queries so PulseSurface reflects the cool-off
      // without a manual refresh.
      await queryClient.invalidateQueries({ queryKey });
      if (vars.action === "complete") {
        await queryClient.invalidateQueries({ queryKey: ["qrm", "signals"] });
        await queryClient.invalidateQueries({ queryKey: ["qrm", "move-signals"] });
      }
    },
  });

  const handleAccept = useCallback(
    (moveId: string) => mutation.mutate({ moveId, action: "accept" }),
    [mutation],
  );

  const handleSnooze = useCallback(
    (moveId: string) => {
      // Default snooze: 2 hours. A future ticket adds a picker.
      const snoozedUntil = new Date(Date.now() + 2 * 3_600_000).toISOString();
      mutation.mutate({ moveId, action: "snooze", snoozedUntil });
    },
    [mutation],
  );

  const handleDismiss = useCallback(
    (moveId: string) => mutation.mutate({ moveId, action: "dismiss" }),
    [mutation],
  );

  const handleComplete = useCallback(
    (moveId: string, touch?: PatchMoveTouchInput) =>
      mutation.mutate({ moveId, action: "complete", touch }),
    [mutation],
  );

  // Group: accepted moves ("in flight") first, then suggestions ranked by
  // priority. The recommender already returns them priority-desc, so we only
  // need a stable partition here.
  const inFlight = moves.filter((m) => m.status === "accepted");
  const suggestions = moves.filter((m) => m.status === "suggested");

  return (
    <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6", className)}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          </div>
          {isElevated && (
            <nav
              aria-label="Today scope"
              className="inline-flex items-center gap-1 rounded-full border bg-card p-0.5 text-xs"
            >
              <ScopeButton active={scope === "mine"} onClick={() => setScope("mine")}>
                My queue
              </ScopeButton>
              <ScopeButton active={scope === "team"} onClick={() => setScope("team")}>
                <Users className="h-3 w-3" />
                Team
              </ScopeButton>
            </nav>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Ranked plays pulled from your signals and deal state. Accept to pick one up; snooze to
          revisit later.
        </p>
      </header>

      {movesQuery.isLoading && (
        <EmptyState
          title="Loading your queue…"
          body="Pulling signals and scoring the next-best moves."
        />
      )}

      {movesQuery.isError && (
        <EmptyState
          title="Couldn't load Today"
          body={
            movesQuery.error instanceof Error
              ? movesQuery.error.message
              : "Something went wrong reaching the move feed."
          }
        />
      )}

      {!movesQuery.isLoading && !movesQuery.isError && moves.length === 0 && (
        <EmptyState
          title="Nothing pressing right now."
          body="The recommender is quiet. Log an activity or wait for the next signal sweep."
        />
      )}

      {inFlight.length > 0 && (
        <Section title="In flight" count={inFlight.length}>
          {inFlight.map((move) => (
            <MoveCard
              key={move.id}
              move={move}
              pending={pendingIds.has(move.id)}
              onAccept={handleAccept}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
              onComplete={handleComplete}
            />
          ))}
        </Section>
      )}

      {suggestions.length > 0 && (
        <Section title="Suggested" count={suggestions.length}>
          {suggestions.map((move) => (
            <MoveCard
              key={move.id}
              move={move}
              pending={pendingIds.has(move.id)}
              onAccept={handleAccept}
              onSnooze={handleSnooze}
              onDismiss={handleDismiss}
              onComplete={handleComplete}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium">{count}</span>
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border bg-card px-6 py-10 text-sm">
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground">{body}</span>
    </div>
  );
}
