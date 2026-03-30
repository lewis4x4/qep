import { CalendarClock, Mail, MessageSquareText, Phone, StickyNote, ClipboardList } from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CrmActivityItem, CrmActivityType } from "../lib/types";

interface CrmActivityTimelineProps {
  activities: CrmActivityItem[];
  onLogActivity: () => void;
  entityLabel: string;
  showEntityLabel?: boolean;
}

const TYPE_STYLE: Record<CrmActivityType, { icon: ComponentType<{ className?: string }>; badge: string; label: string }> = {
  call: { icon: Phone, badge: "bg-green-100 text-green-900", label: "Call" },
  email: { icon: Mail, badge: "bg-blue-100 text-blue-900", label: "Email" },
  meeting: { icon: CalendarClock, badge: "bg-violet-100 text-violet-900", label: "Meeting" },
  note: { icon: StickyNote, badge: "bg-slate-100 text-slate-900", label: "Note" },
  task: { icon: ClipboardList, badge: "bg-amber-100 text-amber-900", label: "Task" },
  sms: { icon: MessageSquareText, badge: "bg-cyan-100 text-cyan-900", label: "SMS" },
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CrmActivityTimeline({
  activities,
  onLogActivity,
  entityLabel,
  showEntityLabel = true,
}: CrmActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-white p-6 text-center">
        <p className="text-sm text-[#334155]">No activities yet. Keep momentum and capture the first touchpoint.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="sm" onClick={onLogActivity}>
            Log a call
          </Button>
          <Button size="sm" variant="outline" onClick={onLogActivity}>
            Add a note
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => {
        const typeMeta = TYPE_STYLE[activity.activityType];
        const Icon = typeMeta.icon;

        return (
          <article
            key={activity.id}
            className={cn(
              "rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm",
              activity.isOptimistic && "opacity-70"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold", typeMeta.badge)}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {typeMeta.label}
                </span>
                {showEntityLabel && <span className="text-xs text-[#475569]">{entityLabel}</span>}
              </div>
              <time className="text-xs text-[#475569]" dateTime={activity.occurredAt}>
                {formatTimestamp(activity.occurredAt)}
              </time>
            </div>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#0F172A]">
              {activity.body ?? "No details provided."}
            </p>
          </article>
        );
      })}
    </div>
  );
}
