import { Clock } from "lucide-react";
import type { CustomerActivity } from "../lib/types";

/* ── Activity type → timeline color ─────────────────────── */
const ACTIVITY_COLORS: Record<string, string> = {
  call: "bg-emerald-400",
  email: "bg-blue-400",
  meeting: "bg-purple-400",
  note: "bg-muted-foreground",
  sms: "bg-cyan-400",
  task: "bg-amber-400",
  visit: "bg-emerald-400",
  quote: "bg-blue-400",
};

function getActivityColor(type: string): string {
  return ACTIVITY_COLORS[type] ?? "bg-muted-foreground/50";
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function InteractionTimeline({
  activities,
}: {
  activities: CustomerActivity[];
}) {
  if (activities.length === 0) return null;

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.1em]">
          Recent Activity
        </span>
      </div>

      <div className="bg-[hsl(var(--card))] rounded-[14px] border border-white/[0.06] py-1">
        {activities.slice(0, 8).map((act, i, arr) => {
          const dotColor = getActivityColor(act.activity_type);
          return (
            <div
              key={act.id}
              className="flex gap-2.5 px-3.5 py-2.5 items-start"
            >
              {/* Date column */}
              <div className="w-[52px] shrink-0 text-[11px] text-muted-foreground/60 font-semibold pt-[1px]">
                {formatDate(act.occurred_at)}
              </div>

              {/* Timeline connector */}
              <div className="relative w-[2px] self-stretch shrink-0 bg-white/[0.06]">
                <div
                  className={`absolute top-1 -left-[3px] w-2 h-2 rounded-full ${dotColor}`}
                />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 text-[13px] text-foreground leading-snug">
                {act.body ?? (
                  <span className="capitalize text-muted-foreground">
                    {act.activity_type}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
