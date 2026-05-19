import { Flame } from "lucide-react";

export interface StreakBadgeProps {
  currentStreak: number;
  longestStreak: number;
  isLoading?: boolean;
}

export function StreakBadge({
  currentStreak,
  longestStreak,
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
    return (
      <div
        data-testid="streak-badge"
        data-state="empty"
        className="w-full sm:inline-flex flex items-center gap-2 px-3.5 py-2 rounded-full bg-card border border-white/[0.06] text-muted-foreground"
      >
        <Flame
          className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60"
          aria-hidden="true"
        />
        <span className="text-[12.5px] font-medium">
          Log a visit today to start a streak
        </span>
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
