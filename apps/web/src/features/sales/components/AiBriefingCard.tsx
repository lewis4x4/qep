import { Zap } from "lucide-react";

interface AiBriefingCardProps {
  firstName: string;
  timeOfDay: "morning" | "afternoon" | "evening";
  pipelineValue: number;
  closingSoonCount: number;
  priorityCount: number;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

export function AiBriefingCard({
  firstName,
  timeOfDay,
  pipelineValue,
  closingSoonCount,
  priorityCount,
}: AiBriefingCardProps) {
  const label =
    timeOfDay === "morning"
      ? "Morning Briefing"
      : timeOfDay === "afternoon"
        ? "Afternoon Briefing"
        : "Evening Briefing";

  const greeting = `Good ${timeOfDay}${firstName ? `, ${firstName}` : ""}`;

  const parts: string[] = [];
  if (pipelineValue > 0)
    parts.push(`${formatCurrency(pipelineValue)} in active pipeline`);
  if (closingSoonCount > 0)
    parts.push(
      `${closingSoonCount} deal${closingSoonCount === 1 ? "" : "s"} closing this week`,
    );
  if (priorityCount > 0 && closingSoonCount === 0)
    parts.push(
      `${priorityCount} ${priorityCount === 1 ? "priority" : "priorities"} today`,
    );
  const summary = parts.length > 0 ? parts.join(". ") + "." : "";

  return (
    <div
      className="rounded-2xl px-5 py-5 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #E87722 0%, #F29556 40%, #D86420 100%)",
        boxShadow:
          "0 8px 32px rgba(232,119,34,0.25), inset 0 1px 0 rgba(255,255,255,0.2)",
      }}
    >
      {/* Decorative glow */}
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/[0.08] blur-[40px] pointer-events-none" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-3.5 h-3.5 text-white/90" />
          <span className="text-[11px] font-bold text-white/90 uppercase tracking-[0.1em]">
            {label}
          </span>
        </div>
        <p className="text-xl font-extrabold text-white leading-snug tracking-tight">
          {greeting}
        </p>
        {summary && (
          <p className="text-sm font-medium text-white/[0.92] leading-relaxed mt-1.5">
            {summary}
          </p>
        )}
      </div>
    </div>
  );
}
