import { CalendarClock, Mail, MessageSquareText, Phone, StickyNote, ClipboardList } from "lucide-react";
import { useState, type ComponentType } from "react";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toDateTimeLocalValue, toIsoOrNull } from "../lib/deal-date";
import type { CrmActivityItem, CrmActivityType, CrmTaskMetadata } from "../lib/types";

interface CrmActivityTimelineProps {
  activities: CrmActivityItem[];
  onLogActivity: () => void;
  entityLabel: string;
  showEntityLabel?: boolean;
  onPatchBody?: (activity: CrmActivityItem, body: string, updatedAt: string) => Promise<void>;
  pendingBodyId?: string | null;
  onPatchOccurredAt?: (activity: CrmActivityItem, occurredAt: string, updatedAt: string) => Promise<void>;
  pendingOccurredAtId?: string | null;
  onPatchTask?: (activity: CrmActivityItem, task: CrmTaskMetadata, updatedAt: string) => Promise<void>;
  onToggleTaskStatus?: (activity: CrmActivityItem, nextStatus: "open" | "completed") => Promise<void>;
  pendingTaskId?: string | null;
  onDeliverCommunication?: (activity: CrmActivityItem) => Promise<void>;
  pendingDeliveryId?: string | null;
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
  attempted?: boolean;
  deliveryInProgress?: boolean;
  deliveryInProgressAt?: string;
  status?: string;
  mode?: string;
  provider?: string;
  reasonCode?: string;
  message?: string;
  destination?: string;
  attemptedAt?: string;
  externalMessageId?: string;
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

function deliveryBadgeState(delivery: CommunicationDeliveryMetadata): "Live" | "Manual" | "Error" {
  if (delivery.status === "sent") return "Live";
  if (delivery.status === "failed") return "Error";
  return "Manual";
}

function deliveryModeLabel(delivery: CommunicationDeliveryMetadata): string {
  if (delivery.provider === "twilio") return "SMS";
  if (delivery.provider === "sendgrid") return "Email";
  return "Communication";
}

function formatAttemptedAt(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deliveryAttemptLabel(delivery: CommunicationDeliveryMetadata): string | null {
  const formatted = formatAttemptedAt(delivery.attemptedAt);
  if (!formatted) return null;
  if (delivery.attempted === false || delivery.mode === "manual") {
    return `Logged ${formatted}`;
  }
  return `Attempted ${formatted}`;
}

function canRetryDelivery(delivery: CommunicationDeliveryMetadata): boolean {
  return delivery.status === "failed" || delivery.mode === "manual";
}

function bodyActionLabel(activity: CrmActivityItem): string {
  return activity.body?.trim() ? "Edit details" : "Add details";
}

function timeActionLabel(activity: CrmActivityItem): string {
  return activity.activityType === "meeting" ? "Adjust meeting time" : "Adjust time";
}

function hasFreshDeliveryLock(delivery: CommunicationDeliveryMetadata | null): boolean {
  if (!delivery || delivery.deliveryInProgress !== true) return false;
  const lockAt = typeof delivery.deliveryInProgressAt === "string"
    ? Date.parse(delivery.deliveryInProgressAt)
    : Number.NaN;
  return Number.isFinite(lockAt) && Date.now() - lockAt < 2 * 60 * 1000;
}

function canEditBody(activity: CrmActivityItem, delivery: CommunicationDeliveryMetadata | null): boolean {
  if (activity.isOptimistic) return false;
  if (activity.activityType !== "email" && activity.activityType !== "sms") {
    return true;
  }
  if (!delivery) return true;
  if (delivery.status === "sent") return false;
  if (delivery.deliveryInProgress === true) return false;
  return true;
}

function canEditOccurredAt(activity: CrmActivityItem, delivery: CommunicationDeliveryMetadata | null): boolean {
  return canEditBody(activity, delivery);
}

function bodyLockMessage(delivery: CommunicationDeliveryMetadata | null): string | null {
  if (!delivery) return null;
  if (hasFreshDeliveryLock(delivery)) {
    return "This message is sending now. Edit it after delivery finishes.";
  }
  if (delivery.deliveryInProgress === true) {
    return "This message needs delivery review before anyone edits it again.";
  }
  if (delivery.status === "sent") {
    return "Sent messages are locked so the timeline stays audit-safe.";
  }
  return null;
}

function deliveryActionLabel(delivery: CommunicationDeliveryMetadata): string {
  return delivery.status === "failed" ? "Retry send" : "Send now";
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
  onPatchBody,
  pendingBodyId = null,
  onPatchOccurredAt,
  pendingOccurredAtId = null,
  onPatchTask,
  onToggleTaskStatus,
  pendingTaskId = null,
  onDeliverCommunication,
  pendingDeliveryId = null,
}: CrmActivityTimelineProps) {
  const [editingBodyId, setEditingBodyId] = useState<string | null>(null);
  const [editingBodyUpdatedAt, setEditingBodyUpdatedAt] = useState<string | null>(null);
  const [bodyConflictId, setBodyConflictId] = useState<string | null>(null);
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [bodyInput, setBodyInput] = useState("");
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [editingOccurredAtId, setEditingOccurredAtId] = useState<string | null>(null);
  const [editingOccurredAtUpdatedAt, setEditingOccurredAtUpdatedAt] = useState<string | null>(null);
  const [occurredAtConflictId, setOccurredAtConflictId] = useState<string | null>(null);
  const [occurredAtDrafts, setOccurredAtDrafts] = useState<Record<string, string>>({});
  const [occurredAtInput, setOccurredAtInput] = useState("");
  const [occurredAtError, setOccurredAtError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskUpdatedAt, setEditingTaskUpdatedAt] = useState<string | null>(null);
  const [taskConflictId, setTaskConflictId] = useState<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});
  const [dueAtInput, setDueAtInput] = useState("");
  const [dueAtError, setDueAtError] = useState<string | null>(null);

  function startBodyEditor(activity: CrmActivityItem): void {
    setEditingBodyId(activity.id);
    setEditingBodyUpdatedAt(activity.updatedAt);
    setBodyConflictId(null);
    setBodyInput(bodyDrafts[activity.id] ?? activity.body ?? "");
    setBodyError(null);
  }

  function startOccurredAtEditor(activity: CrmActivityItem): void {
    setEditingOccurredAtId(activity.id);
    setEditingOccurredAtUpdatedAt(activity.updatedAt);
    setOccurredAtConflictId(null);
    setOccurredAtInput(occurredAtDrafts[activity.id] ?? toDateTimeLocalValue(activity.occurredAt));
    setOccurredAtError(null);
  }

  function closeBodyEditor(options?: { preserveDraft?: boolean }): void {
    const preserveDraft = options?.preserveDraft === true;
    if (editingBodyId && !preserveDraft) {
      setBodyDrafts((current) => {
        const next = { ...current };
        delete next[editingBodyId];
        return next;
      });
    }
    setEditingBodyId(null);
    setEditingBodyUpdatedAt(null);
    setBodyConflictId(null);
    setBodyInput("");
    setBodyError(null);
  }

  function closeOccurredAtEditor(options?: { preserveDraft?: boolean }): void {
    const preserveDraft = options?.preserveDraft === true;
    if (editingOccurredAtId && !preserveDraft) {
      setOccurredAtDrafts((current) => {
        const next = { ...current };
        delete next[editingOccurredAtId];
        return next;
      });
    }
    setEditingOccurredAtId(null);
    setEditingOccurredAtUpdatedAt(null);
    setOccurredAtConflictId(null);
    setOccurredAtInput("");
    setOccurredAtError(null);
  }

  function startTaskEditor(activity: CrmActivityItem, task: CrmTaskMetadata): void {
    setEditingTaskId(activity.id);
    setEditingTaskUpdatedAt(activity.updatedAt);
    setTaskConflictId(null);
    setDueAtInput(taskDrafts[activity.id] ?? toDateTimeLocalValue(task.dueAt ?? null));
    setDueAtError(null);
  }

  function closeTaskEditor(options?: { preserveDraft?: boolean }): void {
    const preserveDraft = options?.preserveDraft === true;
    if (editingTaskId && !preserveDraft) {
      setTaskDrafts((current) => {
        const next = { ...current };
        delete next[editingTaskId];
        return next;
      });
    }
    setEditingTaskId(null);
    setEditingTaskUpdatedAt(null);
    setTaskConflictId(null);
    setDueAtInput("");
    setDueAtError(null);
  }

  async function saveBody(activity: CrmActivityItem): Promise<void> {
    if (!onPatchBody) return;

    const nextBody = bodyInput.trim();
    if (!nextBody) {
      setBodyError("Add details before saving.");
      return;
    }

    try {
      await onPatchBody(activity, nextBody, editingBodyUpdatedAt ?? activity.updatedAt);
      closeBodyEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update the activity.";
      if (message.includes("changed somewhere else")) {
        setBodyConflictId(activity.id);
        setBodyError("This activity changed while you were editing. Cancel and reopen the editor to apply your draft.");
        return;
      }
      setBodyError(message);
    }
  }

  async function saveOccurredAt(activity: CrmActivityItem): Promise<void> {
    if (!onPatchOccurredAt) return;

    const nextOccurredAt = toIsoOrNull(occurredAtInput);
    if (!nextOccurredAt) {
      setOccurredAtError("Enter a valid activity time.");
      return;
    }

    try {
      await onPatchOccurredAt(activity, nextOccurredAt, editingOccurredAtUpdatedAt ?? activity.updatedAt);
      closeOccurredAtEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update the activity time.";
      if (message.includes("changed somewhere else")) {
        setOccurredAtConflictId(activity.id);
        setOccurredAtError("This activity changed while you were editing. Cancel and reopen the editor to apply your draft.");
        return;
      }
      setOccurredAtError(message);
    }
  }

  async function saveTaskDueAt(activity: CrmActivityItem, task: CrmTaskMetadata): Promise<void> {
    if (!onPatchTask) return;

    const nextDueAt = dueAtInput.trim() ? toIsoOrNull(dueAtInput) : null;
    if (dueAtInput.trim() && !nextDueAt) {
      setDueAtError("Enter a valid due date.");
      return;
    }

    try {
      await onPatchTask(activity, { ...task, dueAt: nextDueAt }, editingTaskUpdatedAt ?? activity.updatedAt);
      closeTaskEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update the task due date.";
      if (message.includes("changed somewhere else")) {
        setTaskConflictId(activity.id);
        setDueAtError("This task changed while you were editing. Cancel and reopen the editor to apply your update.");
        return;
      }
      setDueAtError(message);
    }
  }

  async function clearTaskDueAt(activity: CrmActivityItem, task: CrmTaskMetadata): Promise<void> {
    if (!onPatchTask) return;
    setTaskDrafts((current) => ({
      ...current,
      [activity.id]: "",
    }));

    try {
      await onPatchTask(activity, { ...task, dueAt: null }, editingTaskUpdatedAt ?? activity.updatedAt);
      closeTaskEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not clear the task due date.";
      if (message.includes("changed somewhere else")) {
        setTaskConflictId(activity.id);
        setDueAtError("This task changed while you were editing. Cancel and reopen the editor to apply your update.");
        return;
      }
      setDueAtError(message);
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
        const canUpdateBody = Boolean(onPatchBody) && canEditBody(activity, delivery);
        const canUpdateOccurredAt = Boolean(onPatchOccurredAt) && canEditOccurredAt(activity, delivery);
        const isEditingBody = editingBodyId === activity.id;
        const isAnotherBodyEditorOpen = editingBodyId !== null && editingBodyId !== activity.id;
        const isPendingBody = pendingBodyId === activity.id;
        const hasBodyConflict = bodyConflictId === activity.id;
        const isEditingOccurredAt = editingOccurredAtId === activity.id;
        const isAnotherOccurredAtEditorOpen = editingOccurredAtId !== null && editingOccurredAtId !== activity.id;
        const isPendingOccurredAt = pendingOccurredAtId === activity.id;
        const hasOccurredAtConflict = occurredAtConflictId === activity.id;
        const canPatchTask = Boolean(onPatchTask || onToggleTaskStatus);
        const isEditingTask = editingTaskId === activity.id;
        const isAnotherTaskEditorOpen = editingTaskId !== null && editingTaskId !== activity.id;
        const isPendingTask = pendingTaskId === activity.id;
        const hasTaskConflict = taskConflictId === activity.id;
        const attemptedLabel = delivery ? deliveryAttemptLabel(delivery) : null;
        const isPendingDelivery = pendingDeliveryId === activity.id;
        const lockMessage = !canUpdateBody ? bodyLockMessage(delivery) : null;

        return (
          <article
            key={activity.id}
            className={cn(
              "rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm",
              activity.isOptimistic && "opacity-70"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold", typeMeta.badge)}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {typeMeta.label}
                </span>
                {showEntityLabel && <span className="text-xs text-[#475569]">{entityLabel}</span>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <time className="text-xs text-[#475569]" dateTime={activity.occurredAt}>
                  {formatTimestamp(activity.occurredAt)}
                </time>
                {canUpdateOccurredAt && !isEditingOccurredAt && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-[#475569]"
                    disabled={isPendingOccurredAt || isAnotherOccurredAtEditorOpen || editingBodyId !== null || editingTaskId !== null}
                    onClick={() => startOccurredAtEditor(activity)}
                  >
                    {timeActionLabel(activity)}
                  </Button>
                )}
              </div>
            </div>

            {isEditingOccurredAt && (
              <div className="mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <label
                  htmlFor={`crm-activity-occurred-at-${activity.id}`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#475569]"
                >
                  Activity time
                </label>
                <input
                  id={`crm-activity-occurred-at-${activity.id}`}
                  type="datetime-local"
                  value={occurredAtInput}
                  onChange={(event) => {
                    setOccurredAtInput(event.target.value);
                    setOccurredAtDrafts((current) => ({
                      ...current,
                      [activity.id]: event.target.value,
                    }));
                    setOccurredAtError(null);
                    setOccurredAtConflictId(null);
                  }}
                  disabled={isPendingOccurredAt}
                  className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                />
                {occurredAtError && <p className="mt-2 text-xs text-[#B91C1C]">{occurredAtError}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    disabled={isPendingOccurredAt || hasOccurredAtConflict}
                    onClick={() => void saveOccurredAt(activity)}
                  >
                    {isPendingOccurredAt ? "Saving..." : "Save time"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={isPendingOccurredAt}
                    onClick={() => closeOccurredAtEditor({ preserveDraft: hasOccurredAtConflict })}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {!isEditingBody ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#0F172A]">
                {activity.body ?? "No details provided."}
              </p>
            ) : (
              <div className="mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <label
                  htmlFor={`crm-activity-body-${activity.id}`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#475569]"
                >
                  Activity details
                </label>
                <textarea
                  id={`crm-activity-body-${activity.id}`}
                  value={bodyInput}
                  onChange={(event) => {
                    setBodyInput(event.target.value);
                    setBodyDrafts((current) => ({
                      ...current,
                      [activity.id]: event.target.value,
                    }));
                    setBodyError(null);
                    setBodyConflictId(null);
                  }}
                  disabled={isPendingBody}
                  rows={4}
                  className="min-h-[120px] w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                />
                {bodyError && <p className="mt-2 text-xs text-[#B91C1C]">{bodyError}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    disabled={isPendingBody || hasBodyConflict}
                    onClick={() => void saveBody(activity)}
                  >
                    {isPendingBody ? "Saving..." : "Save details"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={isPendingBody}
                    onClick={() => closeBodyEditor({ preserveDraft: hasBodyConflict })}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {canUpdateBody && !isEditingBody && (
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-[#475569]"
                  disabled={isPendingBody || isAnotherBodyEditorOpen || editingTaskId !== null || editingOccurredAtId !== null}
                  onClick={() => startBodyEditor(activity)}
                >
                  {bodyActionLabel(activity)}
                </Button>
              </div>
            )}
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
                    disabled={isPendingTask || isEditingBody || isEditingTask || isEditingOccurredAt}
                    onClick={() => {
                      const nextStatus = task.status === "completed" ? "open" : "completed";
                      if (onPatchTask) {
                          void onPatchTask(activity, { ...task, status: nextStatus }, activity.updatedAt);
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
                    disabled={isPendingTask || isEditingBody || isEditingOccurredAt || isAnotherTaskEditorOpen}
                    onClick={() => {
                      if (isEditingTask) {
                        closeTaskEditor({ preserveDraft: hasTaskConflict });
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
                    setTaskDrafts((current) => ({
                      ...current,
                      [activity.id]: event.target.value,
                    }));
                    setDueAtError(null);
                    setTaskConflictId(null);
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
                    disabled={isPendingTask || hasTaskConflict}
                    onClick={() => void saveTaskDueAt(activity, task)}
                  >
                    {isPendingTask ? "Saving..." : "Save due date"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={isPendingTask || hasTaskConflict}
                    onClick={() => void clearTaskDueAt(activity, task)}
                  >
                    Clear due date
                  </Button>
                </div>
              </div>
            )}
            {delivery && (
              <div className="mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <DataSourceBadge state={deliveryBadgeState(delivery)} />
                  <span className="text-xs font-medium text-[#0F172A]">
                    {deliveryModeLabel(delivery)}
                  </span>
                  {delivery.destination && (
                    <span className="text-xs text-[#475569]">
                      {delivery.destination}
                    </span>
                  )}
                </div>
                <p className={cn("mt-2 text-xs", deliveryTone(delivery.status))}>
                  {deliveryLabel(delivery)}
                </p>
                {lockMessage && (
                  <p className="mt-2 text-[11px] text-[#64748B]">{lockMessage}</p>
                )}
                {(attemptedLabel || delivery.externalMessageId) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#64748B]">
                    {attemptedLabel && (
                      <span>{attemptedLabel}</span>
                    )}
                    {delivery.externalMessageId && (
                      <span className="font-mono">Ref {delivery.externalMessageId}</span>
                    )}
                  </div>
                )}
                {onDeliverCommunication && canRetryDelivery(delivery) && (
                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      disabled={isPendingDelivery || isEditingBody || isPendingBody || isEditingOccurredAt || isPendingOccurredAt}
                      onClick={() => void onDeliverCommunication(activity)}
                    >
                      {isPendingDelivery ? "Sending..." : deliveryActionLabel(delivery)}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
