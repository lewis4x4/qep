import { CalendarClock, Mail, MessageSquareText, Phone, StickyNote, ClipboardList } from "lucide-react";
import { useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toDateTimeLocalValue, toIsoOrNull } from "../lib/deal-date";
import type { CrmActivityItem, CrmActivityType, CrmTaskMetadata } from "../lib/types";

interface CrmActivityTimelineProps {
  activities: CrmActivityItem[];
  onLogActivity: () => void;
  entityLabel: string;
  showEntityLabel?: boolean;
  onPatchTask?: (activity: CrmActivityItem, task: CrmTaskMetadata) => Promise<void>;
  onToggleTaskStatus?: (activity: CrmActivityItem, nextStatus: "open" | "completed") => Promise<void>;
  pendingTaskId?: string | null;
}

const TYPE_STYLE: Record<CrmActivityType, { icon: ComponentType<{ className?: string }>; badge: string; label: string }> = {
  call: { icon: Phone, badge: "bg-green-100 text-green-900", label: "Call" },
  email: { icon: Mail, badge: "bg-blue-100 text-blue-900", label: "Email" },
  meeting: { icon: CalendarClock, badge: "bg-violet-100 text-violet-900", label: "Meeting" },
  note: { icon: StickyNote, badge: "bg-slate-100 text-slate-900", label: "Note" },
  task: { icon: ClipboardList, badge: "bg-amber-100 text-amber-900", label: "Task" },
  sms: { icon: MessageSquareText, badge: "bg-cyan-100 text-cyan-900", label: "SMS" },
};

interface CommunicationDeliveryMetadata {
  status?: string;
  mode?: string;
  provider?: string;
  reasonCode?: string;
  message?: string;
  destination?: string;
}

function readCommunicationDelivery(activity: CrmActivityItem): CommunicationDeliveryMetadata | null {
  if (activity.activityType !== "email" && activity.activityType !== "sms") return null;
  const metadata = activity.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const communication = (metadata as Record<string, unknown>).communication;
  if (!communication || typeof communication !== "object") return null;
  return communication as CommunicationDeliveryMetadata;
}

function deliveryTone(status: string | undefined): string {
  if (status === "sent") return "text-[#166534]";
  if (status === "failed") return "text-[#B91C1C]";
  return "text-[#475569]";
}

function deliveryLabel(delivery: CommunicationDeliveryMetadata): string {
  if (delivery.status === "sent") {
    return `Sent via ${delivery.provider === "twilio" ? "Twilio" : "SendGrid"}`;
  }
  if (delivery.status === "failed") {
    return `Delivery failed${delivery.message ? `: ${delivery.message}` : ""}`;
  }
  if (delivery.mode === "manual") {
    return delivery.message || "Saved as manual log only.";
  }
  return "Delivery status unavailable.";
}

function readTaskMetadata(activity: CrmActivityItem): CrmTaskMetadata | null {
  if (activity.activityType !== "task") return null;
  const metadata = activity.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const task = (metadata as Record<string, unknown>).task;
  if (!task || typeof task !== "object") return null;
  return task as CrmTaskMetadata;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTaskDueLabel(value: string | null | undefined): string {
  if (!value) {
    return "Due not scheduled";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Due date needs review";
  }

  return `Due ${formatTimestamp(new Date(timestamp).toISOString())}`;
}

function taskStatusTone(status: CrmTaskMetadata["status"]): string {
  return status === "completed"
    ? "bg-emerald-100 text-emerald-900"
    : "bg-amber-100 text-amber-900";
}

function taskDueTone(dueAt: string | null | undefined, status: CrmTaskMetadata["status"]): string {
  if (status === "completed") return "text-[#475569]";
  if (!dueAt) return "text-[#475569]";
  const dueTime = Date.parse(dueAt);
  if (!Number.isFinite(dueTime)) return "text-[#B91C1C]";
  if (dueTime < Date.now()) return "text-[#B91C1C]";
  return "text-[#475569]";
}

export function CrmActivityTimeline({
  activities,
  onLogActivity,
  entityLabel,
  showEntityLabel = true,
  onPatchTask,
  onToggleTaskStatus,
  pendingTaskId = null,
}: CrmActivityTimelineProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [dueAtInput, setDueAtInput] = useState("");
  const [dueAtError, setDueAtError] = useState<string | null>(null);

  function startTaskEditor(activity: CrmActivityItem, task: CrmTaskMetadata): void {
    setEditingTaskId(activity.id);
    setDueAtInput(toDateTimeLocalValue(task.dueAt ?? null));
    setDueAtError(null);
  }

  function closeTaskEditor(): void {
    setEditingTaskId(null);
    setDueAtInput("");
    setDueAtError(null);
  }

  async function saveTaskDueAt(activity: CrmActivityItem, task: CrmTaskMetadata): Promise<void> {
    if (!onPatchTask) return;

    const nextDueAt = dueAtInput.trim() ? toIsoOrNull(dueAtInput) : null;
    if (dueAtInput.trim() && !nextDueAt) {
      setDueAtError("Enter a valid due date.");
      return;
    }

    try {
      await onPatchTask(activity, { ...task, dueAt: nextDueAt });
      closeTaskEditor();
    } catch (error) {
      setDueAtError(error instanceof Error ? error.message : "Could not update the task due date.");
    }
  }

  async function clearTaskDueAt(activity: CrmActivityItem, task: CrmTaskMetadata): Promise<void> {
    if (!onPatchTask) return;

    try {
      await onPatchTask(activity, { ...task, dueAt: null });
      closeTaskEditor();
    } catch (error) {
      setDueAtError(error instanceof Error ? error.message : "Could not clear the task due date.");
    }
  }

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
        const delivery = readCommunicationDelivery(activity);
        const task = readTaskMetadata(activity);
        const canPatchTask = Boolean(onPatchTask || onToggleTaskStatus);
        const isEditingTask = editingTaskId === activity.id;
        const isPendingTask = pendingTaskId === activity.id;

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
            {task && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("inline-flex items-center rounded-full px-2 py-1 font-semibold", taskStatusTone(task.status))}>
                  {task.status === "completed" ? "Completed" : "Open task"}
                </span>
                <span className={cn(taskDueTone(task.dueAt, task.status))}>
                  {formatTaskDueLabel(task.dueAt)}
                </span>
                {canPatchTask && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 text-xs"
                    disabled={isPendingTask}
                    onClick={() => {
                      const nextStatus = task.status === "completed" ? "open" : "completed";
                      if (onPatchTask) {
                        void onPatchTask(activity, { ...task, status: nextStatus });
                        return;
                      }
                      if (onToggleTaskStatus) {
                        void onToggleTaskStatus(activity, nextStatus);
                      }
                    }}
                  >
                    {isPendingTask
                      ? "Saving..."
                      : task.status === "completed"
                      ? "Reopen"
                      : "Mark complete"}
                  </Button>
                )}
                {onPatchTask && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-[#475569]"
                    disabled={isPendingTask}
                    onClick={() => {
                      if (isEditingTask) {
                        closeTaskEditor();
                        return;
                      }
                      startTaskEditor(activity, task);
                    }}
                  >
                    {isEditingTask ? "Cancel" : "Reschedule"}
                  </Button>
                )}
              </div>
            )}
            {task && onPatchTask && isEditingTask && (
              <div className="mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <label
                  htmlFor={`crm-task-due-at-${activity.id}`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#475569]"
                >
                  Task due date
                </label>
                <input
                  id={`crm-task-due-at-${activity.id}`}
                  type="datetime-local"
                  value={dueAtInput}
                  onChange={(event) => {
                    setDueAtInput(event.target.value);
                    setDueAtError(null);
                  }}
                  disabled={isPendingTask}
                  className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                />
                {dueAtError && <p className="mt-2 text-xs text-[#B91C1C]">{dueAtError}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    disabled={isPendingTask}
                    onClick={() => void saveTaskDueAt(activity, task)}
                  >
                    {isPendingTask ? "Saving..." : "Save due date"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={isPendingTask}
                    onClick={() => void clearTaskDueAt(activity, task)}
                  >
                    Clear due date
                  </Button>
                </div>
              </div>
            )}
            {delivery && (
              <p className={cn("mt-2 text-xs", deliveryTone(delivery.status))}>
                {deliveryLabel(delivery)}
                {delivery.destination ? ` (${delivery.destination})` : ""}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
