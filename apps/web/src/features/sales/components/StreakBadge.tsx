import { Flame } from "lucide-react";

export interface StreakBadgeProps {
  currentStreak: number;
  longestStreak: number;
  /** ISO timestamp of the rep's most recent activity. Drives cold-start copy. */
  lastActiveAt?: string | null;
  isLoading?: boolean;
}

function daysSince(iso: string): number | null {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  const ms = Date.now() - ts;
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export function StreakBadge({
  currentStreak,
  longestStreak,
  lastActiveAt,
  isLoading,
}: StreakBadgeProps) {
  if (isLoading) {
    return (
      <div
        data-testid="streak-badge-loading"
        className="w-full sm:inline-flex h-9 rounded-full bg-card border border-white/[0.06] animate-pulse"
        aria-hidden="true"
      />
    );
  }

  const isPersonalBest = currentStreak > 0 && currentStreak >= longestStreak;
  const isOneFromRecord =
    currentStreak > 0 &&
    longestStreak > 0 &&
    currentStreak === longestStreak - 1;

  if (currentStreak === 0) {
    const days = lastActiveAt ? daysSince(lastActiveAt) : null;
    const hasHistory = longestStreak > 0 || (days !== null && days >= 0);
    const copy = hasHistory && days !== null
      ? `${days === 0 ? "Active today" : days === 1 ? "1 day since last touch" : `${days} days since last touch`}${longestStreak > 0 ? ` · ${longestStreak}-day record` : ""}`
      : "Log a visit today to start a streak";
    return (
      <div
        data-testid="streak-badge"
        data-state={hasHistory ? "broken" : "empty"}
        className="w-full sm:inline-flex flex items-center gap-2 px-3.5 py-2 rounded-full bg-card border border-white/[0.06] text-muted-foreground"
      >
        <Flame
          className={`w-3.5 h-3.5 shrink-0 ${hasHistory ? "text-amber-400/80" : "text-muted-foreground/60"}`}
          aria-hidden="true"
        />
        <span className="text-[12.5px] font-medium">{copy}</span>
      </div>
    );
  }

  const label = `${currentStreak}-day streak`;
  const subtitle = isPersonalBest
    ? "personal best"
    : isOneFromRecord
      ? "1 from your record"
      : null;

  return (
    <div
      data-testid="streak-badge"
      data-state={isPersonalBest ? "personal-best" : isOneFromRecord ? "one-from-record" : "active"}
      className="w-full sm:inline-flex flex items-center gap-2 px-3.5 py-2 rounded-full bg-card border border-white/[0.06]"
    >
      <Flame
        className="w-3.5 h-3.5 shrink-0 text-qep-orange"
        aria-hidden="true"
      />
      <span className="text-[12.5px] font-semibold text-foreground tabular-nums">
        {label}
      </span>
      {subtitle && (
        <span className="text-[11.5px] text-muted-foreground">
          · {subtitle}
        </span>
      )}
    </div>
  );
}
