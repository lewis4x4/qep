import { useEffect, useState } from "react";

interface SlaCountdownProps {
  deadline: string | null;
  className?: string;
}

function getTimeRemaining(deadline: string) {
  const now = Date.now();
  const end = new Date(deadline).getTime();
  const diff = end - now;
  return diff;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "OVERDUE";
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getColorClass(ms: number, totalMs: number): string {
  if (ms <= 0) return "text-red-500 font-bold animate-pulse";
  const ratio = ms / totalMs;
  if (ratio <= 0.25) return "text-red-400 font-semibold";
  if (ratio <= 0.5) return "text-amber-400";
  return "text-emerald-400";
}

/**
 * Real-time SLA countdown timer for deal cards.
 * Color-coded: green → yellow → red → OVERDUE (pulsing).
 */
export function SlaCountdown({ deadline, className = "" }: SlaCountdownProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) return;

    const update = () => setRemaining(getTimeRemaining(deadline));
    update();
    const interval = setInterval(update, 15_000); // Update every 15 seconds
    return () => clearInterval(interval);
  }, [deadline]);

  if (!deadline || remaining === null) return null;

  // Estimate total SLA duration (from when it was set)
  // Use a reasonable default of 60 minutes if we can't calculate
  const totalMs = Math.max(remaining + 60_000, 60 * 60_000);
  const colorClass = getColorClass(remaining, totalMs);
  const display = formatCountdown(remaining);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-card/50 px-1.5 py-0.5 text-[10px] tabular-nums ${colorClass} ${className}`}
      title={`SLA deadline: ${new Date(deadline).toLocaleString()}`}
    >
      <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {display}
    </span>
  );
}
