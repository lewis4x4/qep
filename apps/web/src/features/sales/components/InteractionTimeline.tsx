import { Clock, Phone, Mail, MessageSquare, FileText, Users } from "lucide-react";
import type { CustomerActivity } from "../lib/types";

const ACTIVITY_ICONS: Record<string, typeof Clock> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: FileText,
  sms: MessageSquare,
  task: Clock,
};

const ACTIVITY_COLORS: Record<string, string> = {
  call: "text-blue-500 bg-blue-50",
  email: "text-purple-500 bg-purple-50",
  meeting: "text-emerald-500 bg-emerald-50",
  note: "text-slate-500 bg-slate-50",
  sms: "text-cyan-500 bg-cyan-50",
  task: "text-amber-500 bg-amber-50",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function InteractionTimeline({
  activities,
}: {
  activities: CustomerActivity[];
}) {
  if (activities.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Clock className="w-4 h-4" />
        Recent Activity
      </h2>

      <div className="space-y-1">
        {activities.map((act) => {
          const Icon =
            ACTIVITY_ICONS[act.activity_type] ?? FileText;
          const color =
            ACTIVITY_COLORS[act.activity_type] ?? "text-slate-500 bg-slate-50";

          return (
            <div
              key={act.id}
              className="flex items-start gap-3 py-2"
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${color}`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600 capitalize">
                    {act.activity_type}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {timeAgo(act.occurred_at)}
                  </span>
                </div>
                {act.body && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                    {act.body}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
