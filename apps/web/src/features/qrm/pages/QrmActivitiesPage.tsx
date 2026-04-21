import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Archive,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Eye,
  Filter,
  Mail,
  MessageSquareText,
  Phone,
  Search,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { mergeActivityTemplates } from "../lib/activity-templates";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { archiveCrmActivity, deliverCrmActivity, listCrmActivityFeed, listCrmActivityTemplates, patchCrmActivity, patchCrmActivityTask } from "../lib/qrm-api";
import type { QrmActivityFeedItem, QrmActivityItem, QrmActivityTemplate, QrmActivityType, QrmTaskMetadata } from "../lib/types";

type FeedFilter = "all" | "communication" | "tasks" | "overdue";
type PendingMap = Record<string, true>;

interface OperationIssue {
  activityId: string;
  action: "send" | "save" | "archive" | "task";
  label: string;
  message: string;
}

interface IssueTarget {
  activityId: string;
  action: OperationIssue["action"];
}

const ACTIVITY_META: Record<
  QrmActivityType,
  {
    label: string;
    icon: typeof Phone;
    badgeClassName: string;
  }
> = {
  call: {
    label: "Call",
    icon: Phone,
    badgeClassName:
      "border-emerald-400/45 bg-gradient-to-br from-emerald-400/25 to-emerald-950/12 text-emerald-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md dark:from-emerald-400/20 dark:to-emerald-950/40 dark:text-emerald-50",
  },
  email: {
    label: "Email",
    icon: Mail,
    badgeClassName:
      "border-sky-400/45 bg-gradient-to-br from-sky-400/25 to-sky-950/12 text-sky-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md dark:from-sky-400/22 dark:to-sky-950/45 dark:text-sky-50",
  },
  meeting: {
    label: "Meeting",
    icon: UserRound,
    badgeClassName:
      "border-violet-400/45 bg-gradient-to-br from-violet-400/25 to-violet-950/14 text-violet-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md dark:from-violet-400/22 dark:to-violet-950/45 dark:text-violet-50",
  },
  note: {
    label: "Note",
    icon: MessageSquareText,
    badgeClassName:
      "border-slate-300/70 bg-gradient-to-br from-slate-200/80 to-slate-500/10 text-slate-900 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35)] backdrop-blur-md dark:border-white/15 dark:from-white/[0.1] dark:to-white/[0.03] dark:text-slate-100",
  },
  sms: {
    label: "SMS",
    icon: MessageSquareText,
    badgeClassName:
      "border-cyan-400/45 bg-gradient-to-br from-cyan-400/22 to-cyan-950/14 text-cyan-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md dark:from-cyan-400/20 dark:to-cyan-950/45 dark:text-cyan-50",
  },
  task: {
    label: "Task",
    icon: ClipboardList,
    badgeClassName:
      "border-amber-400/50 bg-gradient-to-br from-amber-400/28 to-amber-950/14 text-amber-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22)] backdrop-blur-md dark:from-amber-400/24 dark:to-amber-950/40 dark:text-amber-50",
  },
};

function readTaskMetadata(activity: QrmActivityFeedItem): QrmTaskMetadata | null {
  if (activity.activityType !== "task") return null;
  const task = activity.metadata.task;
  if (!task || typeof task !== "object" || Array.isArray(task)) return null;
  return task as QrmTaskMetadata;
}

function readDeliveryMetadata(activity: QrmActivityFeedItem): Record<string, unknown> | null {
  if (activity.activityType !== "email" && activity.activityType !== "sms") return null;
  const delivery = activity.metadata.delivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return null;
  return delivery as Record<string, unknown>;
}

function formatTimeLabel(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTaskDueLabel(value: string | null | undefined): string {
  if (!value) return "No due time";
  return `Due ${formatTimeLabel(value)}`;
}

function isOverdueTask(activity: QrmActivityFeedItem): boolean {
  const task = readTaskMetadata(activity);
  if (!task?.dueAt) return false;
  if (task.status === "completed") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function taskTone(task: QrmTaskMetadata | null): string {
  if (!task) return "text-muted-foreground";
  if (task.status === "completed") return "text-emerald-700";
  if (task.dueAt && new Date(task.dueAt).getTime() < Date.now()) return "text-rose-700";
  return "text-amber-700";
}

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoOrNull(value: string): string | null {
  if (!value.trim()) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function deliveryTone(delivery: Record<string, unknown> | null): string {
  const status = typeof delivery?.status === "string" ? delivery.status : null;
  if (status === "failed") {
    return "border-rose-400/45 bg-gradient-to-br from-rose-400/22 to-rose-950/18 text-rose-900 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)] backdrop-blur-md dark:from-rose-400/20 dark:to-rose-950/45 dark:text-rose-50";
  }
  if (status === "manual_logged") {
    return "border-amber-400/45 bg-gradient-to-br from-amber-400/22 to-amber-950/14 text-amber-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md dark:from-amber-400/20 dark:to-amber-950/40 dark:text-amber-50";
  }
  if (status === "sent") {
    return "border-emerald-400/45 bg-gradient-to-br from-emerald-400/22 to-emerald-950/12 text-emerald-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md dark:from-emerald-400/20 dark:to-emerald-950/40 dark:text-emerald-50";
  }
  return "border-slate-300/60 bg-gradient-to-br from-slate-200/70 to-slate-600/10 text-slate-800 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)] backdrop-blur-md dark:border-white/12 dark:from-white/[0.08] dark:to-white/[0.02] dark:text-slate-200";
}

function canSendFromInbox(activity: QrmActivityFeedItem): boolean {
  const delivery = readDeliveryMetadata(activity);
  if (!delivery || (activity.activityType !== "email" && activity.activityType !== "sms")) {
    return false;
  }
  const status = typeof delivery.status === "string" ? delivery.status : null;
  return status === "failed" || status === "manual_logged";
}

function canSelectTaskFromInbox(activity: QrmActivityFeedItem): boolean {
  return activity.activityType === "task" && readTaskMetadata(activity) !== null;
}

function deliveryActionLabel(delivery: Record<string, unknown> | null): string {
  const status = typeof delivery?.status === "string" ? delivery.status : null;
  return status === "failed" ? "Retry send" : "Send now";
}

function canArchiveFromInbox(activity: QrmActivityFeedItem): boolean {
  if (activity.activityType !== "email" && activity.activityType !== "sms") {
    return true;
  }

  const delivery = readDeliveryMetadata(activity);
  const status = typeof delivery?.status === "string" ? delivery.status : null;
  return status !== "sent" && delivery?.deliveryInProgress !== true;
}

function canApproveCommunication(activity: QrmActivityFeedItem): boolean {
  return canSendFromInbox(activity) && (activity.body ?? "").trim().length > 0;
}

function activityTargetHref(activity: QrmActivityFeedItem): string | null {
  if (activity.dealId) return `/crm/deals/${activity.dealId}`;
  if (activity.contactId) return `/crm/contacts/${activity.contactId}`;
  if (activity.companyId) return `/crm/companies/${activity.companyId}`;
  return null;
}

function activityTargetLabel(activity: QrmActivityFeedItem): string {
  if (activity.dealName) return activity.dealName;
  if (activity.contactName) return activity.contactName;
  if (activity.companyName) return activity.companyName;
  return "Open record";
}

function updatePendingMap(current: PendingMap, activityId: string, nextState: boolean): PendingMap {
  if (nextState) {
    return current[activityId] ? current : { ...current, [activityId]: true };
  }

  if (!current[activityId]) {
    return current;
  }

  const next = { ...current };
  delete next[activityId];
  return next;
}

function activityIssueLabel(activity: QrmActivityFeedItem): string {
  return `${ACTIVITY_META[activity.activityType].label} · ${activityTargetLabel(activity)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export function QrmActivitiesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [typeFilter, setTypeFilter] = useState<QrmActivityType | "all">("all");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([]);
  const [draftBodies, setDraftBodies] = useState<Record<string, string>>({});
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDueDraft, setTaskDueDraft] = useState("");
  const [taskDueError, setTaskDueError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [approvedActivityIds, setApprovedActivityIds] = useState<string[]>([]);
  const [selectedTemplateByType, setSelectedTemplateByType] = useState<Partial<Record<"email" | "sms", string>>>({});
  const [pendingDeliveryIds, setPendingDeliveryIds] = useState<PendingMap>({});
  const [pendingBodyIds, setPendingBodyIds] = useState<PendingMap>({});
  const [pendingArchiveIds, setPendingArchiveIds] = useState<PendingMap>({});
  const [pendingTaskIds, setPendingTaskIds] = useState<PendingMap>({});
  const [bulkSendPending, setBulkSendPending] = useState(false);
  const [bulkTaskAction, setBulkTaskAction] = useState<"open" | "completed" | null>(null);
  const [operationIssues, setOperationIssues] = useState<OperationIssue[]>([]);
  const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
  const queryKey = ["crm", "activities", "feed"] as const;

  const activitiesQuery = useQuery({
    queryKey,
    queryFn: listCrmActivityFeed,
    staleTime: 30_000,
  });
  const templatesQuery = useQuery({
    queryKey: ["crm", "activity-templates"],
    queryFn: listCrmActivityTemplates,
    staleTime: 60_000,
  });

  const activities = activitiesQuery.data ?? [];
  const workspaceTemplates = templatesQuery.data ?? [];
  const selectedActivities = useMemo(
    () => activities.filter((activity) => selectedActivityIds.includes(activity.id)),
    [activities, selectedActivityIds],
  );
  const selectedCommunications = useMemo(
    () => selectedActivities.filter(canSendFromInbox),
    [selectedActivities],
  );
  const selectedTaskActivities = useMemo(
    () => selectedActivities.filter(canSelectTaskFromInbox),
    [selectedActivities],
  );
  const selectedOpenTasks = useMemo(
    () =>
      selectedTaskActivities.filter((activity) => readTaskMetadata(activity)?.status !== "completed"),
    [selectedTaskActivities],
  );
  const selectedCompletedTasks = useMemo(
    () =>
      selectedTaskActivities.filter((activity) => readTaskMetadata(activity)?.status === "completed"),
    [selectedTaskActivities],
  );
  const approvedSelectedCommunications = useMemo(
    () => selectedCommunications.filter((activity) => approvedActivityIds.includes(activity.id)),
    [approvedActivityIds, selectedCommunications],
  );
  const approvableSelectedCommunications = useMemo(
    () =>
      selectedCommunications.filter((activity) =>
        canApproveCommunication({
          ...activity,
          body: readDraftBody(activity),
        })
      ),
    [draftBodies, selectedCommunications],
  );
  const nonApprovableSelectedCommunications = useMemo(
    () => selectedCommunications.filter((activity) => !approvableSelectedCommunications.some((item) => item.id === activity.id)),
    [approvableSelectedCommunications, selectedCommunications],
  );
  const allSelectedCommunicationsApproved = useMemo(
    () =>
      approvableSelectedCommunications.length > 0 &&
      approvableSelectedCommunications.every((activity) => approvedActivityIds.includes(activity.id)),
    [approvedActivityIds, approvableSelectedCommunications],
  );
  const reviewTemplateGroups = useMemo(() => {
    return (["email", "sms"] as const)
      .map((activityType) => {
        const activitiesForType = selectedCommunications.filter((activity) => activity.activityType === activityType);
        if (activitiesForType.length === 0) {
          return null;
        }

        return {
          activityType,
          count: activitiesForType.length,
          templates: mergeActivityTemplates(activityType, workspaceTemplates),
        };
      })
      .filter((group): group is {
        activityType: "email" | "sms";
        count: number;
        templates: QrmActivityTemplate[];
      } => Boolean(group));
  }, [selectedCommunications, workspaceTemplates]);

  const deliveryMutation = useMutation({
    mutationFn: async (input: { activityId: string; updatedAt: string }) =>
      deliverCrmActivity(input.activityId, input.updatedAt),
    onSuccess: (updatedActivity) => {
      queryClient.setQueryData<QrmActivityFeedItem[]>(
        queryKey,
        (current) =>
          current?.map((item) =>
            item.id === updatedActivity.id
              ? {
                  ...item,
                  ...updatedActivity,
                }
              : item
          ) ?? [],
      );
    },
  });

  const bodyMutation = useMutation({
    mutationFn: async (input: { activityId: string; body: string; updatedAt: string }) =>
      patchCrmActivity(input.activityId, {
        body: input.body,
        updatedAt: input.updatedAt,
      }),
    onSuccess: (updatedActivity) => {
      queryClient.setQueryData<QrmActivityFeedItem[]>(
        queryKey,
        (current) =>
          current?.map((item) =>
            item.id === updatedActivity.id
              ? {
                  ...item,
                  ...updatedActivity,
                }
              : item
          ) ?? [],
      );
      setDraftBodies((current) => {
        const next = { ...current };
        delete next[updatedActivity.id];
        return next;
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (input: { activityId: string; updatedAt: string }) =>
      archiveCrmActivity(input.activityId, input.updatedAt),
    onSuccess: (archivedActivity) => {
      queryClient.setQueryData<QrmActivityFeedItem[]>(
        queryKey,
        (current) => current?.filter((item) => item.id !== archivedActivity.id) ?? [],
      );
      setSelectedActivityIds((current) => current.filter((id) => id !== archivedActivity.id));
      setDraftBodies((current) => {
        const next = { ...current };
        delete next[archivedActivity.id];
        return next;
      });
    },
  });

  const taskMutation = useMutation({
    mutationFn: async (input: { activityId: string; task: QrmTaskMetadata; updatedAt: string }) =>
      patchCrmActivityTask(input.activityId, {
        task: input.task,
        updatedAt: input.updatedAt,
      }),
    onSuccess: (updatedActivity) => {
      queryClient.setQueryData<QrmActivityFeedItem[]>(
        queryKey,
        (current) =>
          current?.map((item) =>
            item.id === updatedActivity.id
              ? {
                  ...item,
                  ...updatedActivity,
                }
              : item
          ) ?? [],
      );
    },
  });

  const filteredActivities = useMemo(() => {
    return activities.filter((activity) => {
      if (typeFilter !== "all" && activity.activityType !== typeFilter) {
        return false;
      }

      if (feedFilter === "communication" && activity.activityType !== "email" && activity.activityType !== "sms" && activity.activityType !== "call") {
        return false;
      }

      if (feedFilter === "tasks" && activity.activityType !== "task") {
        return false;
      }

      if (feedFilter === "overdue" && !isOverdueTask(activity)) {
        return false;
      }

      if (!deferredSearch) {
        return true;
      }

      const haystack = [
        activity.body ?? "",
        activity.actorName ?? "",
        activity.contactName ?? "",
        activity.companyName ?? "",
        activity.dealName ?? "",
        ACTIVITY_META[activity.activityType].label,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(deferredSearch);
    });
  }, [activities, deferredSearch, feedFilter, typeFilter]);

  const filteredSendableActivityIds = useMemo(
    () => filteredActivities.filter(canSendFromInbox).map((activity) => activity.id),
    [filteredActivities],
  );
  const filteredOpenTaskActivityIds = useMemo(
    () =>
      filteredActivities
        .filter((activity) => {
          const task = readTaskMetadata(activity);
          return canSelectTaskFromInbox(activity) && task?.status !== "completed";
        })
        .map((activity) => activity.id),
    [filteredActivities],
  );
  const filteredCompletedTaskActivityIds = useMemo(
    () =>
      filteredActivities
        .filter((activity) => readTaskMetadata(activity)?.status === "completed")
        .map((activity) => activity.id),
    [filteredActivities],
  );

  const allFilteredSendableSelected = useMemo(
    () =>
      filteredSendableActivityIds.length > 0 &&
      filteredSendableActivityIds.every((activityId) => selectedActivityIds.includes(activityId)),
    [filteredSendableActivityIds, selectedActivityIds],
  );
  const allFilteredOpenTasksSelected = useMemo(
    () =>
      filteredOpenTaskActivityIds.length > 0 &&
      filteredOpenTaskActivityIds.every((activityId) => selectedActivityIds.includes(activityId)),
    [filteredOpenTaskActivityIds, selectedActivityIds],
  );
  const allFilteredCompletedTasksSelected = useMemo(
    () =>
      filteredCompletedTaskActivityIds.length > 0 &&
      filteredCompletedTaskActivityIds.every((activityId) => selectedActivityIds.includes(activityId)),
    [filteredCompletedTaskActivityIds, selectedActivityIds],
  );

  const summary = useMemo(() => {
    const openTasks = activities.filter((activity) => {
      const task = readTaskMetadata(activity);
      return activity.activityType === "task" && task?.status !== "completed";
    }).length;
    const overdueTasks = activities.filter(isOverdueTask).length;
    const failedDeliveries = activities.filter((activity) => {
      const delivery = readDeliveryMetadata(activity);
      return delivery?.status === "failed";
    }).length;
    const todayTouches = activities.filter((activity) => {
      const occurredAt = new Date(activity.occurredAt);
      const now = new Date();
      return occurredAt.toDateString() === now.toDateString();
    }).length;

    return { openTasks, overdueTasks, failedDeliveries, todayTouches };
  }, [activities]);

  // Cascading Iron briefing — route the operator to the sharpest activity lever.
  const activitiesIronHeadline = activitiesQuery.isLoading
    ? "Activity pressure is loading…"
    : summary.failedDeliveries > 0
      ? `${summary.failedDeliveries} failed deliver${summary.failedDeliveries === 1 ? "y" : "ies"} — clear these first so follow-up does not silently stall. ${summary.overdueTasks} overdue · ${summary.openTasks} open.`
      : summary.overdueTasks > 0
        ? `${summary.overdueTasks} overdue task${summary.overdueTasks === 1 ? "" : "s"} — work these before adding more outbound. ${summary.openTasks} open tasks in scope.`
        : summary.openTasks > 0
          ? `${summary.openTasks} open task${summary.openTasks === 1 ? "" : "s"} in scope. ${summary.todayTouches} touch${summary.todayTouches === 1 ? "" : "es"} already logged today — disposition and press the next lever.`
          : `Inbox clear. ${summary.todayTouches} touch${summary.todayTouches === 1 ? "" : "es"} logged today — pick the next outbound or close the loop.`;

  const selectedCommunicationHasPendingWork = useMemo(
    () =>
      selectedCommunications.some(
        (activity) =>
          Boolean(pendingDeliveryIds[activity.id]) ||
          Boolean(pendingBodyIds[activity.id]) ||
          Boolean(pendingArchiveIds[activity.id]),
      ),
    [pendingArchiveIds, pendingBodyIds, pendingDeliveryIds, selectedCommunications],
  );
  const selectedTaskHasPendingWork = useMemo(
    () => selectedTaskActivities.some((activity) => Boolean(pendingTaskIds[activity.id])),
    [pendingTaskIds, selectedTaskActivities],
  );
  const selectedCommunicationIssues = useMemo(
    () => operationIssues.filter((issue) => selectedCommunications.some((activity) => activity.id === issue.activityId)),
    [operationIssues, selectedCommunications],
  );

  function toggleSelected(activityId: string): void {
    setSelectedActivityIds((current) =>
      current.includes(activityId)
        ? current.filter((id) => id !== activityId)
        : [...current, activityId]
    );
  }

  function clearApproval(activityId: string): void {
    setApprovedActivityIds((current) => current.filter((id) => id !== activityId));
  }

  function updateIssueLedger(nextIssues: OperationIssue[], targetsToClear: IssueTarget[] = []): void {
    setOperationIssues((current) => {
      const filtered = current.filter(
        (issue) =>
          !targetsToClear.some(
            (target) => target.activityId === issue.activityId && target.action === issue.action,
          ),
      );
      if (nextIssues.length === 0) {
        return filtered;
      }
      return [...filtered, ...nextIssues];
    });
  }

  function clearIssueTargets(targets: IssueTarget[]): void {
    if (targets.length === 0) {
      return;
    }
    updateIssueLedger([], targets);
  }

  function isPending(map: PendingMap, activityId: string): boolean {
    return Boolean(map[activityId]);
  }

  async function runDeliveryMutation(activityId: string, updatedAt: string): Promise<QrmActivityItem> {
    setPendingDeliveryIds((current) => updatePendingMap(current, activityId, true));
    try {
      return await deliveryMutation.mutateAsync({
        activityId,
        updatedAt,
      });
    } finally {
      setPendingDeliveryIds((current) => updatePendingMap(current, activityId, false));
    }
  }

  async function runBodyMutation(activityId: string, body: string, updatedAt: string): Promise<QrmActivityItem> {
    setPendingBodyIds((current) => updatePendingMap(current, activityId, true));
    try {
      return await bodyMutation.mutateAsync({
        activityId,
        body,
        updatedAt,
      });
    } finally {
      setPendingBodyIds((current) => updatePendingMap(current, activityId, false));
    }
  }

  async function runArchiveMutation(activityId: string, updatedAt: string): Promise<QrmActivityItem> {
    setPendingArchiveIds((current) => updatePendingMap(current, activityId, true));
    try {
      return await archiveMutation.mutateAsync({
        activityId,
        updatedAt,
      });
    } finally {
      setPendingArchiveIds((current) => updatePendingMap(current, activityId, false));
    }
  }

  async function runTaskMutation(activityId: string, task: QrmTaskMetadata, updatedAt: string): Promise<QrmActivityItem> {
    setPendingTaskIds((current) => updatePendingMap(current, activityId, true));
    try {
      return await taskMutation.mutateAsync({
        activityId,
        task,
        updatedAt,
      });
    } finally {
      setPendingTaskIds((current) => updatePendingMap(current, activityId, false));
    }
  }

  function toggleApproved(activity: QrmActivityFeedItem): void {
    if (!canApproveCommunication({
      ...activity,
      body: readDraftBody(activity),
    })) {
      return;
    }

    setApprovedActivityIds((current) =>
      current.includes(activity.id)
        ? current.filter((id) => id !== activity.id)
        : [...current, activity.id],
    );
  }

  function approveAllSelectedCommunications(): void {
    const approvableIds = approvableSelectedCommunications
      .map((activity) => activity.id);

    setApprovedActivityIds((current) => Array.from(new Set([...current, ...approvableIds])));
  }

  function clearApprovedCommunications(): void {
    setApprovedActivityIds((current) =>
      current.filter((id) => !selectedCommunications.some((activity) => activity.id === id)),
    );
  }

  function selectFilteredEligible(): void {
    if (filteredSendableActivityIds.length === 0) {
      return;
    }

    setSelectedActivityIds((current) => {
      const next = new Set(current);
      for (const activityId of filteredSendableActivityIds) {
        next.add(activityId);
      }
      return Array.from(next);
    });
  }

  function clearFilteredEligible(): void {
    if (filteredSendableActivityIds.length === 0) {
      return;
    }

    setSelectedActivityIds((current) =>
      current.filter((activityId) => !filteredSendableActivityIds.includes(activityId)),
    );
  }

  function selectFilteredOpenTasks(): void {
    if (filteredOpenTaskActivityIds.length === 0) {
      return;
    }

    setSelectedActivityIds((current) => {
      const next = new Set(current);
      for (const activityId of filteredOpenTaskActivityIds) {
        next.add(activityId);
      }
      return Array.from(next);
    });
  }

  function clearFilteredOpenTasks(): void {
    if (filteredOpenTaskActivityIds.length === 0) {
      return;
    }

    setSelectedActivityIds((current) =>
      current.filter((activityId) => !filteredOpenTaskActivityIds.includes(activityId)),
    );
  }

  function selectFilteredCompletedTasks(): void {
    if (filteredCompletedTaskActivityIds.length === 0) {
      return;
    }

    setSelectedActivityIds((current) => {
      const next = new Set(current);
      for (const activityId of filteredCompletedTaskActivityIds) {
        next.add(activityId);
      }
      return Array.from(next);
    });
  }

  function clearFilteredCompletedTasks(): void {
    if (filteredCompletedTaskActivityIds.length === 0) {
      return;
    }

    setSelectedActivityIds((current) =>
      current.filter((activityId) => !filteredCompletedTaskActivityIds.includes(activityId)),
    );
  }

  function readDraftBody(activity: QrmActivityFeedItem): string {
    return draftBodies[activity.id] ?? activity.body ?? "";
  }

  function beginTaskEditor(activity: QrmActivityFeedItem, task: QrmTaskMetadata): void {
    setEditingTaskId(activity.id);
    setTaskDueDraft(toDateTimeLocalValue(task.dueAt));
    setTaskDueError(null);
  }

  function stopTaskEditor(): void {
    setEditingTaskId(null);
    setTaskDueDraft("");
    setTaskDueError(null);
  }

  function draftBodyDirty(activity: QrmActivityFeedItem): boolean {
    return readDraftBody(activity) !== (activity.body ?? "");
  }

  async function saveActivityDraft(activity: QrmActivityFeedItem): Promise<QrmActivityFeedItem> {
    const nextBody = readDraftBody(activity);
    if (!draftBodyDirty(activity)) {
      return activity;
    }

    const updatedActivity = await runBodyMutation(activity.id, nextBody, activity.updatedAt);

    return {
      ...activity,
      ...updatedActivity,
    };
  }

  async function handleSaveDraft(activity: QrmActivityFeedItem): Promise<void> {
    try {
      await saveActivityDraft(activity);
      clearIssueTargets([{ activityId: activity.id, action: "save" }]);
      toast({
        title: "Draft saved",
        description: `${activity.activityType === "sms" ? "SMS" : "Email"} content was updated in review.`,
      });
    } catch (error) {
      updateIssueLedger([
        {
          activityId: activity.id,
          action: "save",
          label: activityIssueLabel(activity),
          message: errorMessage(error, "Review changes were not saved."),
        },
      ], [{ activityId: activity.id, action: "save" }]);
      toast({
        title: "Could not save draft",
        description: errorMessage(error, "Review changes were not saved."),
        variant: "destructive",
      });
    }
  }

  async function sendSingleActivity(activity: QrmActivityFeedItem): Promise<void> {
    try {
      await runDeliveryMutation(activity.id, activity.updatedAt);
      setSelectedActivityIds((current) => current.filter((id) => id !== activity.id));
      clearIssueTargets([{ activityId: activity.id, action: "send" }]);
      toast({
        title: "Message queued",
        description: `${activity.activityType === "sms" ? "SMS" : "Email"} delivery was retried from the activity inbox.`,
      });
    } catch (error) {
      updateIssueLedger([
        {
          activityId: activity.id,
          action: "send",
          label: activityIssueLabel(activity),
          message: errorMessage(error, "Could not send the selected activity."),
        },
      ], [{ activityId: activity.id, action: "send" }]);
      toast({
        title: "Delivery failed",
        description: errorMessage(error, "Could not send the selected activity."),
        variant: "destructive",
      });
    }
  }

  async function sendSelectedActivities(): Promise<void> {
    const sendableActivities = selectedCommunications;
    if (sendableActivities.length === 0) {
      setReviewOpen(false);
      return;
    }
    if (nonApprovableSelectedCommunications.length > 0) {
      toast({
        title: "Message copy still missing",
        description: "Add message copy for every selected email or SMS before sending the batch.",
        variant: "destructive",
      });
      return;
    }
    if (!sendableActivities.every((activity) => approvedActivityIds.includes(activity.id))) {
      toast({
        title: "Approval required",
        description: "Approve each selected email or SMS before sending the batch.",
        variant: "destructive",
      });
      return;
    }

    setBulkSendPending(true);
    clearIssueTargets(
      sendableActivities.flatMap((activity) => [
        { activityId: activity.id, action: "save" as const },
        { activityId: activity.id, action: "send" as const },
      ]),
    );

    try {
      const results = await Promise.allSettled(
        sendableActivities.map(async (activity) => {
          let preparedActivity = activity;
          try {
            preparedActivity = await saveActivityDraft(activity);
          } catch (error) {
            throw {
              action: "save" as const,
              message: errorMessage(error, "Review changes were not saved."),
            };
          }

          try {
            await runDeliveryMutation(preparedActivity.id, preparedActivity.updatedAt);
          } catch (error) {
            throw {
              action: "send" as const,
              message: errorMessage(error, "Delivery did not complete for this communication."),
            };
          }

          return activity.id;
        }),
      );

      const succeeded: string[] = [];
      const failedIssues: OperationIssue[] = [];

      results.forEach((result, index) => {
        const activity = sendableActivities[index];
        if (result.status === "fulfilled") {
          succeeded.push(result.value);
          return;
        }

        failedIssues.push({
          activityId: activity.id,
          action:
            typeof result.reason === "object" &&
            result.reason &&
            "action" in result.reason &&
            result.reason.action === "save"
              ? "save"
              : "send",
          label: activityIssueLabel(activity),
          message:
            typeof result.reason === "object" &&
            result.reason &&
            "message" in result.reason &&
            typeof result.reason.message === "string"
              ? result.reason.message
              : "Delivery did not complete for this communication.",
        });
      });

      if (succeeded.length > 0) {
        setSelectedActivityIds((current) => current.filter((id) => !succeeded.includes(id)));
        setApprovedActivityIds((current) => current.filter((id) => !succeeded.includes(id)));
      }

      updateIssueLedger(
        failedIssues,
        succeeded.flatMap((activityId) => [
          { activityId, action: "save" as const },
          { activityId, action: "send" as const },
        ]),
      );

      if (failedIssues.length === 0) {
        setReviewOpen(false);
        toast({
          title: "Bulk send complete",
          description: `${succeeded.length} communication${succeeded.length === 1 ? "" : "s"} sent from the inbox.`,
        });
        return;
      }

      toast({
        title: "Bulk send completed with issues",
        description: `${succeeded.length} sent, ${failedIssues.length} still need review.`,
        variant: "destructive",
      });
    } finally {
      setBulkSendPending(false);
    }
  }

  function applyTemplateToSelected(activityType: "email" | "sms"): void {
    const templateId = selectedTemplateByType[activityType];
    if (!templateId) {
      return;
    }

    const template = mergeActivityTemplates(activityType, workspaceTemplates).find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    setDraftBodies((current) => {
      const next = { ...current };
      for (const activity of selectedCommunications) {
        if (activity.activityType === activityType) {
          next[activity.id] = template.body;
        }
      }
      return next;
    });
    setApprovedActivityIds((current) =>
      current.filter((id) =>
        !selectedCommunications.some((activity) => activity.id === id && activity.activityType === activityType),
      ),
    );
    toast({
      title: `${activityType === "sms" ? "SMS" : "Email"} template applied`,
      description: `Applied "${template.label}" to the selected ${activityType.toUpperCase()} queue. Review and approve before sending.`,
    });
  }

  async function applyTaskStatusToSelected(nextStatus: "open" | "completed"): Promise<void> {
    const targetActivities =
      nextStatus === "completed" ? selectedOpenTasks : selectedCompletedTasks;

    if (targetActivities.length === 0) {
      return;
    }

    setBulkTaskAction(nextStatus);
    clearIssueTargets(targetActivities.map((activity) => ({ activityId: activity.id, action: "task" as const })));

    try {
      const results = await Promise.allSettled(
        targetActivities.map(async (activity) => {
          const task = readTaskMetadata(activity);
          if (!task) {
            return null;
          }

          await runTaskMutation(
            activity.id,
            {
              ...task,
              status: nextStatus,
            },
            activity.updatedAt,
          );

          return activity.id;
        }),
      );

      const succeeded: string[] = [];
      const failedIssues: OperationIssue[] = [];

      results.forEach((result, index) => {
        const activity = targetActivities[index];
        if (result.status === "fulfilled") {
          if (result.value) {
            succeeded.push(result.value);
          }
          return;
        }

        failedIssues.push({
          activityId: activity.id,
          action: "task",
          label: activityIssueLabel(activity),
          message: errorMessage(result.reason, "Task status could not be updated."),
        });
      });

      if (succeeded.length > 0) {
        setSelectedActivityIds((current) => current.filter((id) => !succeeded.includes(id)));
      }

      updateIssueLedger(
        failedIssues,
        succeeded.map((activityId) => ({ activityId, action: "task" as const })),
      );

      if (failedIssues.length === 0) {
        toast({
          title: nextStatus === "completed" ? "Tasks completed" : "Tasks reopened",
          description:
            nextStatus === "completed"
              ? `${succeeded.length} task${succeeded.length === 1 ? "" : "s"} moved out of the active queue.`
              : `${succeeded.length} task${succeeded.length === 1 ? "" : "s"} returned to the active queue.`,
        });
        return;
      }

      toast({
        title: nextStatus === "completed" ? "Bulk complete finished with issues" : "Bulk reopen finished with issues",
        description: `${succeeded.length} updated, ${failedIssues.length} still need attention.`,
        variant: "destructive",
      });
    } finally {
      setBulkTaskAction(null);
    }
  }

  async function archiveActivity(activity: QrmActivityFeedItem): Promise<void> {
    try {
      await runArchiveMutation(activity.id, activity.updatedAt);
      clearIssueTargets([{ activityId: activity.id, action: "archive" }]);
      toast({
        title: "Activity archived",
        description: "The entry was removed from the active inbox without touching delivered history.",
      });
    } catch (error) {
      updateIssueLedger([
        {
          activityId: activity.id,
          action: "archive",
          label: activityIssueLabel(activity),
          message: errorMessage(error, "The activity could not be archived."),
        },
      ], [{ activityId: activity.id, action: "archive" }]);
      toast({
        title: "Could not archive activity",
        description: errorMessage(error, "The activity could not be archived."),
        variant: "destructive",
      });
    }
  }

  async function saveTask(activity: QrmActivityFeedItem, task: QrmTaskMetadata): Promise<void> {
    const nextDueAt = toIsoOrNull(taskDueDraft);
    if (taskDueDraft.trim().length > 0 && !nextDueAt) {
      setTaskDueError("Enter a valid due time before saving.");
      return;
    }

    try {
      await runTaskMutation(
        activity.id,
        {
          ...task,
          dueAt: nextDueAt,
        },
        activity.updatedAt,
      );
      stopTaskEditor();
      clearIssueTargets([{ activityId: activity.id, action: "task" }]);
      toast({
        title: "Task updated",
        description: "The due time was updated from the activity inbox.",
      });
    } catch (error) {
      const message = errorMessage(error, "Could not update the task.");
      setTaskDueError(message);
      updateIssueLedger([
        {
          activityId: activity.id,
          action: "task",
          label: activityIssueLabel(activity),
          message,
        },
      ], [{ activityId: activity.id, action: "task" }]);
    }
  }

  async function clearTaskDueAt(activity: QrmActivityFeedItem, task: QrmTaskMetadata): Promise<void> {
    try {
      await runTaskMutation(
        activity.id,
        {
          ...task,
          dueAt: null,
        },
        activity.updatedAt,
      );
      stopTaskEditor();
      clearIssueTargets([{ activityId: activity.id, action: "task" }]);
      toast({
        title: "Due time cleared",
        description: "The task stays open without a scheduled due time.",
      });
    } catch (error) {
      const message = errorMessage(error, "Could not clear the due time.");
      setTaskDueError(message);
      updateIssueLedger([
        {
          activityId: activity.id,
          action: "task",
          label: activityIssueLabel(activity),
          message,
        },
      ], [{ activityId: activity.id, action: "task" }]);
    }
  }

  async function toggleTaskStatus(activity: QrmActivityFeedItem, task: QrmTaskMetadata): Promise<void> {
    const nextStatus = task.status === "completed" ? "open" : "completed";
    try {
      await runTaskMutation(
        activity.id,
        {
          ...task,
          status: nextStatus,
        },
        activity.updatedAt,
      );
      clearIssueTargets([{ activityId: activity.id, action: "task" }]);
      toast({
        title: nextStatus === "completed" ? "Task completed" : "Task reopened",
        description:
          nextStatus === "completed"
            ? "The task was closed from the activity inbox."
            : "The task is back in the active queue.",
      });
    } catch (error) {
      updateIssueLedger([
        {
          activityId: activity.id,
          action: "task",
          label: activityIssueLabel(activity),
          message: errorMessage(error, "The task could not be updated."),
        },
      ], [{ activityId: activity.id, action: "task" }]);
      toast({
        title: "Could not update task",
        description: errorMessage(error, "The task could not be updated."),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Activities"
        subtitle="Calls, texts, emails, and task follow-through — one rep-safe feed with drafted next moves."
        crumb={{ surface: "TODAY", lens: "ACTIVITIES", count: summary.openTasks }}
        metrics={[
          { label: "Open", value: summary.openTasks, tone: summary.openTasks > 0 ? "active" : undefined },
          { label: "Overdue", value: summary.overdueTasks, tone: summary.overdueTasks > 0 ? "hot" : undefined },
          { label: "Failed", value: summary.failedDeliveries, tone: summary.failedDeliveries > 0 ? "hot" : undefined },
          { label: "Today", value: summary.todayTouches, tone: summary.todayTouches > 0 ? "live" : undefined },
        ]}
        ironBriefing={{
          headline: activitiesIronHeadline,
          actions: [{ label: "Templates →", href: "/qrm/activities/templates" }],
        }}
      />
      <QrmSubNav />

      <Card className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search activity body, rep, contact, company, or deal"
              className="h-11 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as QrmActivityType | "all")}
              className="h-11 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
              aria-label="Filter by activity type"
            >
              <option value="all">All types</option>
              <option value="call">Calls</option>
              <option value="email">Emails</option>
              <option value="meeting">Meetings</option>
              <option value="note">Notes</option>
              <option value="task">Tasks</option>
              <option value="sms">SMS</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "All activity" },
            { key: "communication", label: "Communication" },
            { key: "tasks", label: "Tasks" },
            { key: "overdue", label: "Overdue tasks" },
          ].map((item) => (
            <Button
              key={item.key}
              type="button"
              variant="outline"
              onClick={() => setFeedFilter(item.key as FeedFilter)}
              className={cn(
                "min-h-[44px] rounded-full px-4",
                feedFilter === item.key
                  ? "border-primary/55 bg-gradient-to-b from-primary/32 to-primary/[0.08] text-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.28)] backdrop-blur-xl hover:from-primary/38 hover:to-primary/12"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/12 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl dark:border-white/10 dark:from-white/[0.05] dark:to-transparent">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Queue actions
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={allFilteredSendableSelected ? clearFilteredEligible : selectFilteredEligible}
            disabled={filteredSendableActivityIds.length === 0}
            className="min-h-[44px] rounded-full text-muted-foreground hover:text-primary"
          >
            {allFilteredSendableSelected ? "Clear eligible" : `Select eligible (${filteredSendableActivityIds.length})`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Uses the current filters to queue manual and failed email/SMS items for review.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/12 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl dark:border-white/10 dark:from-white/[0.05] dark:to-transparent">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Task queue
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={allFilteredOpenTasksSelected ? clearFilteredOpenTasks : selectFilteredOpenTasks}
            disabled={filteredOpenTaskActivityIds.length === 0}
            className="min-h-[44px] rounded-full text-muted-foreground hover:border-amber-400/35 hover:from-amber-400/12 hover:to-amber-950/5 hover:text-amber-900 dark:hover:text-amber-100"
          >
            {allFilteredOpenTasksSelected
              ? "Clear open tasks"
              : `Select open tasks (${filteredOpenTaskActivityIds.length})`}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={allFilteredCompletedTasksSelected ? clearFilteredCompletedTasks : selectFilteredCompletedTasks}
            disabled={filteredCompletedTaskActivityIds.length === 0}
            className="min-h-[44px] rounded-full text-muted-foreground hover:border-emerald-400/35 hover:from-emerald-400/12 hover:to-emerald-950/5 hover:text-green-800 dark:hover:text-green-300"
          >
            {allFilteredCompletedTasksSelected
              ? "Clear completed tasks"
              : `Select completed tasks (${filteredCompletedTaskActivityIds.length})`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Use the same inbox filters to batch-close overdue work or reopen completed follow-through.
          </span>
        </div>

        {selectedActivities.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/60 bg-primary/10 dark:border-amber-500/35 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-primary">
                {selectedActivities.length} inbox item{selectedActivities.length === 1 ? "" : "s"} selected
              </p>
              <p className="mt-1 text-xs text-primary">
                {selectedCommunications.length > 0 && (
                  <>
                    {selectedCommunications.length} communication{selectedCommunications.length === 1 ? "" : "s"} ready for review
                    {approvedSelectedCommunications.length > 0
                      ? `, ${approvedSelectedCommunications.length} approved to send`
                      : ""}
                    {selectedTaskActivities.length > 0 ? ", and " : "."}
                  </>
                )}
                {selectedTaskActivities.length > 0 && (
                  <>
                    {selectedTaskActivities.length} task{selectedTaskActivities.length === 1 ? "" : "s"} queued for bulk follow-through.
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelectedActivityIds([])}
                className="border-primary/40 text-primary hover:border-primary/55 hover:from-primary/20 hover:to-primary/5"
              >
                Clear
              </Button>
              {selectedOpenTasks.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void applyTaskStatusToSelected("completed")}
                  disabled={bulkTaskAction !== null || selectedTaskHasPendingWork}
                  className="border-amber-400/40 text-amber-900 hover:border-amber-400/55 hover:from-amber-400/15 hover:to-amber-950/5 dark:text-amber-100"
                >
                  {bulkTaskAction === "completed" ? "Updating..." : `Complete tasks (${selectedOpenTasks.length})`}
                </Button>
              )}
              {selectedCompletedTasks.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void applyTaskStatusToSelected("open")}
                  disabled={bulkTaskAction !== null || selectedTaskHasPendingWork}
                  className="border-emerald-400/40 text-green-800 hover:border-emerald-400/55 hover:from-emerald-400/15 hover:to-emerald-950/5 dark:text-green-300"
                >
                  {bulkTaskAction === "open" ? "Updating..." : `Reopen tasks (${selectedCompletedTasks.length})`}
                </Button>
              )}
              {selectedCommunications.length > 0 && (
                <Button
                  type="button"
                  onClick={() => setReviewOpen(true)}
                  className="bg-primary text-white hover:bg-primary/90"
                >
                  <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
                  Review selected
                </Button>
              )}
            </div>
          </div>
        )}

        {operationIssues.length > 0 && (
          <Card className="rounded-2xl border border-rose-300/60 bg-rose-500/10 dark:border-rose-500/35 p-4 shadow-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Queue issues still need attention</p>
                <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                  Failed inbox actions stay listed here so operators know exactly what still needs follow-through.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOperationIssues([])}
                className="border-rose-400/40 text-rose-800 hover:border-rose-400/55 hover:from-rose-400/12 hover:to-rose-950/5 dark:text-rose-200"
              >
                Clear list
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {operationIssues.map((issue) => (
                <div
                  key={`${issue.activityId}-${issue.action}`}
                  className="rounded-xl border border-pink-300/50 bg-card px-3 py-2"
                >
                  <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">{issue.label}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-rose-700 dark:text-rose-300">
                    {issue.action === "send"
                      ? "Send issue"
                      : issue.action === "save"
                      ? "Draft save issue"
                      : issue.action === "archive"
                      ? "Archive issue"
                      : "Task issue"}
                  </p>
                  <p className="mt-2 text-sm text-rose-950 dark:text-rose-100">{issue.message}</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Card>

      {activitiesQuery.isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading activities">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      )}

      {activitiesQuery.isError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Failed to load the QRM activity feed. Refresh and try again.</p>
        </Card>
      )}

      {!activitiesQuery.isLoading && !activitiesQuery.isError && filteredActivities.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">No activity matches the current filters.</p>
        </Card>
      )}

      {!activitiesQuery.isLoading && !activitiesQuery.isError && filteredActivities.length > 0 && (
        <div className="space-y-3" aria-label="QRM activity feed">
          {filteredActivities.map((activity) => {
            const meta = ACTIVITY_META[activity.activityType];
            const Icon = meta.icon;
            const task = readTaskMetadata(activity);
            const delivery = readDeliveryMetadata(activity);
            const targetHref = activityTargetHref(activity);
            const targetLabel = activityTargetLabel(activity);
            const isEditingTask = editingTaskId === activity.id;
            const taskPending = isPending(pendingTaskIds, activity.id);
            const archivePending = isPending(pendingArchiveIds, activity.id);
            const deliveryPending = isPending(pendingDeliveryIds, activity.id);

            return (
              <Card key={activity.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {(canSendFromInbox(activity) || canSelectTaskFromInbox(activity)) && (
                        <label className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-gradient-to-b from-white/[0.1] to-white/[0.02] px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-md dark:border-white/12">
                          <input
                            type="checkbox"
                            checked={selectedActivityIds.includes(activity.id)}
                            onChange={() => toggleSelected(activity.id)}
                            className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                            aria-label={`Select ${meta.label} activity`}
                          />
                          Select
                        </label>
                      )}
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", meta.badgeClassName)}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {meta.label}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {formatTimeLabel(activity.occurredAt)}
                      </span>
                      {delivery && typeof delivery.status === "string" && (
                        <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", deliveryTone(delivery))}>
                          {delivery.status === "manual_logged"
                            ? "Logged manually"
                            : delivery.status === "failed"
                            ? "Delivery failed"
                            : "Sent live"}
                        </span>
                      )}
                      {task && (
                        <span className={cn("text-xs font-semibold", taskTone(task))}>
                          {task.status === "completed" ? "Completed" : formatTaskDueLabel(task.dueAt)}
                        </span>
                      )}
                    </div>

                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
                      {activity.body || "No activity details logged."}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      <span>Logged by {activity.actorName || "Unknown user"}</span>
                      {activity.contactName && <span>Contact: {activity.contactName}</span>}
                      {activity.companyName && <span>Company: {activity.companyName}</span>}
                      {activity.dealName && <span>Deal: {activity.dealName}</span>}
                    </div>

                    {task && isEditingTask && (
                      <div className="mt-4 rounded-2xl border border-amber-300/50 bg-amber-500/10 p-3">
                        <label
                          htmlFor={`crm-inbox-task-due-${activity.id}`}
                          className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-200"
                        >
                          Task due time
                        </label>
                        <input
                          id={`crm-inbox-task-due-${activity.id}`}
                          type="datetime-local"
                          value={taskDueDraft}
                          onChange={(event) => {
                            setTaskDueDraft(event.target.value);
                            if (taskDueError) {
                              setTaskDueError(null);
                            }
                          }}
                          disabled={taskPending}
                          className="h-11 w-full rounded-md border border-amber-400/50 bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                        />
                        {taskDueError && (
                          <p className="mt-2 text-xs font-medium text-destructive">{taskDueError}</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void saveTask(activity, task)}
                            disabled={taskPending}
                            className="min-h-[40px] bg-primary text-white hover:bg-primary/90"
                          >
                            {taskPending ? "Saving..." : "Save due time"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void clearTaskDueAt(activity, task)}
                            disabled={taskPending}
                            className="min-h-[40px] border-amber-400/50 bg-card text-amber-800 dark:text-amber-200 hover:bg-primary/10"
                          >
                            Clear due time
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={stopTaskEditor}
                            disabled={taskPending}
                            className="min-h-[40px] border-border bg-card text-muted-foreground hover:bg-muted/30"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {targetHref && (
                    <div className="flex flex-wrap items-center gap-2 self-start">
                      {task && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void toggleTaskStatus(activity, task)}
                            disabled={taskPending}
                            className={cn(
                              "min-h-[44px] rounded-full px-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-xl",
                              task.status === "completed"
                                ? "border-emerald-400/45 bg-gradient-to-b from-emerald-400/16 to-emerald-950/8 text-green-800 hover:border-emerald-400/60 hover:from-emerald-400/22 dark:text-green-300"
                                : "border-amber-400/45 bg-gradient-to-b from-amber-400/16 to-amber-950/8 text-amber-900 hover:border-amber-400/60 hover:from-amber-400/22 dark:text-amber-100",
                            )}
                          >
                            {taskPending
                              ? "Updating..."
                              : task.status === "completed"
                              ? "Reopen task"
                              : "Complete task"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => (isEditingTask ? stopTaskEditor() : beginTaskEditor(activity, task))}
                            disabled={taskPending}
                            className="min-h-[44px] rounded-full px-4 text-muted-foreground hover:text-foreground"
                          >
                            {isEditingTask ? "Close due editor" : "Edit due time"}
                          </Button>
                        </>
                      )}
                      {canArchiveFromInbox(activity) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void archiveActivity(activity)}
                          disabled={archivePending || taskPending}
                          className="min-h-[44px] rounded-full border-rose-400/45 px-4 text-rose-800 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-xl hover:border-rose-400/60 hover:from-rose-400/15 hover:to-rose-950/8 dark:text-rose-200"
                        >
                          <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                          {archivePending ? "Archiving..." : "Archive"}
                        </Button>
                      )}
                      {canSendFromInbox(activity) && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void sendSingleActivity(activity)}
                          disabled={deliveryPending || taskPending}
                          className="min-h-[44px] rounded-full bg-primary px-4 text-white hover:bg-primary/90"
                        >
                          <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                          {deliveryPending ? "Sending..." : deliveryActionLabel(delivery)}
                        </Button>
                      )}
                      <Link
                        to={targetHref}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 bg-gradient-to-b from-white/[0.11] to-white/[0.02] px-4 py-2 text-sm font-medium text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_8px_28px_-14px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:border-primary/45 hover:from-primary/18 hover:to-primary/5 hover:text-primary dark:border-white/[0.14] dark:from-white/[0.08] dark:to-white/[0.02]"
                      >
                        {targetLabel}
                        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="rounded-2xl border border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Next communication-hub closeout</p>
              <p className="mt-1 text-sm text-muted-foreground">
              After bulk task handling lands, the next remaining Sprint 4 gap is deeper send governance and template execution control on top of the inbox workflow.
              </p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Unified inbox slice active
          </span>
        </div>
      </Card>

      <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Review selected communications</SheetTitle>
            <SheetDescription>
              Confirm the messages that need to go out now from the activity inbox.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3">
            {selectedCommunications.length === 0 && (
              <Card className="rounded-xl border border-dashed border-input bg-muted/30 p-5 text-sm text-muted-foreground">
                No communications selected.
              </Card>
            )}

            {selectedCommunications.length > 0 && (
              <Card className="rounded-xl border border-border bg-muted/30 p-4 shadow-sm">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Send governance</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Apply the right language, save edits, then explicitly approve each message before bulk send.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={allSelectedCommunicationsApproved ? clearApprovedCommunications : approveAllSelectedCommunications}
                        disabled={approvableSelectedCommunications.length === 0}
                      >
                        {allSelectedCommunicationsApproved
                          ? "Clear approvals"
                          : `Approve ready (${approvableSelectedCommunications.length})`}
                      </Button>
                    </div>
                  </div>
                  {nonApprovableSelectedCommunications.length > 0 && (
                    <p className="text-xs text-primary">
                      {nonApprovableSelectedCommunications.length} selected communication{nonApprovableSelectedCommunications.length === 1 ? "" : "s"} still need message copy before approval.
                    </p>
                  )}

                  <div className="grid gap-3 md:grid-cols-3">
                    <Card className="rounded-xl border border-border bg-card p-3 shadow-none">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Selected</p>
                      <p className="mt-2 text-2xl font-bold text-foreground">{selectedCommunications.length}</p>
                    </Card>
                    <Card className="rounded-xl border border-border bg-card p-3 shadow-none">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Approved</p>
                      <p className="mt-2 text-2xl font-bold text-emerald-700">{approvedSelectedCommunications.length}</p>
                    </Card>
                    <Card className="rounded-xl border border-border bg-card p-3 shadow-none">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Still reviewing</p>
                      <p className="mt-2 text-2xl font-bold text-primary">
                        {Math.max(selectedCommunications.length - approvedSelectedCommunications.length, 0)}
                      </p>
                    </Card>
                  </div>

                  {reviewTemplateGroups.length > 0 && (
                    <div className="grid gap-3">
                      {reviewTemplateGroups.map((group) => (
                        <div
                          key={group.activityType}
                          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground">
                              {group.activityType === "sms" ? "SMS" : "Email"} batch
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Apply one saved template across {group.count} selected {group.activityType === "sms" ? "texts" : "emails"} before approval.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={selectedTemplateByType[group.activityType] ?? ""}
                              onChange={(event) =>
                                setSelectedTemplateByType((current) => ({
                                  ...current,
                                  [group.activityType]: event.target.value,
                                }))}
                              className="h-10 min-w-[220px] rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                              aria-label={`Apply ${group.activityType} template`}
                            >
                              <option value="">Choose a template</option>
                              {group.templates.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.label}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => applyTemplateToSelected(group.activityType)}
                              disabled={!selectedTemplateByType[group.activityType]}
                            >
                              Apply
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}

            {selectedCommunications.map((activity) => {
              const delivery = readDeliveryMetadata(activity);
              const isEditable = canSendFromInbox(activity);
              const isArchivable = canArchiveFromInbox(activity);
              const dirty = draftBodyDirty(activity);
              const approved = approvedActivityIds.includes(activity.id);
              const bodyPending = isPending(pendingBodyIds, activity.id);
              const archivePending = isPending(pendingArchiveIds, activity.id);
              const approvable = canApproveCommunication({
                ...activity,
                body: readDraftBody(activity),
              });
              return (
                <Card key={activity.id} className="rounded-xl border border-border p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", deliveryTone(delivery))}>
                          {deliveryActionLabel(delivery)}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatTimeLabel(activity.occurredAt)}</span>
                        {dirty && (
                          <span className="inline-flex rounded-full border border-primary/45 bg-gradient-to-b from-primary/25 to-primary/[0.06] px-2.5 py-1 text-xs font-semibold text-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22)] backdrop-blur-md">
                            Unsaved edits
                          </span>
                        )}
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)] backdrop-blur-md",
                            approved
                              ? "border-emerald-400/45 bg-gradient-to-br from-emerald-400/20 to-emerald-950/12 text-emerald-900 dark:text-emerald-50"
                              : "border-slate-300/55 bg-gradient-to-br from-slate-200/65 to-slate-600/10 text-slate-800 dark:border-white/12 dark:from-white/[0.08] dark:to-white/[0.02] dark:text-slate-200",
                          )}
                        >
                          {approved ? "Approved to send" : "Needs approval"}
                        </span>
                      </div>
                      {isEditable ? (
                        <div className="mt-3 space-y-3">
                          <textarea
                            value={readDraftBody(activity)}
                            onChange={(event) =>
                              {
                                clearApproval(activity.id);
                                setDraftBodies((current) => ({
                                  ...current,
                                  [activity.id]: event.target.value,
                                }));
                              }
                            }
                            rows={6}
                            className="min-h-[144px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm leading-6 text-foreground shadow-sm focus:border-primary focus:outline-none"
                            aria-label={`Edit ${activity.activityType} body`}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                {
                                  clearApproval(activity.id);
                                  setDraftBodies((current) => ({
                                    ...current,
                                    [activity.id]: activity.body ?? "",
                                  }));
                                }
                              }
                              disabled={!dirty || bodyPending}
                            >
                              Reset
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleSaveDraft(activity)}
                              disabled={!dirty || bodyPending}
                              className="bg-foreground text-background hover:bg-foreground/90"
                            >
                              {bodyPending ? "Saving..." : "Save draft"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
                          {activity.body || "No message body available."}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-muted-foreground">
                        {activity.contactName || activity.companyName || activity.dealName || "Unlinked record"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => toggleSelected(activity.id)}
                    >
                      <X className="mr-2 h-4 w-4" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={approved ? "outline" : "default"}
                      size="sm"
                      onClick={() => toggleApproved(activity)}
                      disabled={!approvable}
                      className={cn(
                        approved
                          ? "border-emerald-200 bg-card text-emerald-700 hover:bg-emerald-50"
                          : "bg-foreground text-background hover:bg-foreground/90"
                      )}
                    >
                      {approved ? "Clear approval" : "Approve to send"}
                    </Button>
                    {!approvable && (
                      <p className="text-xs text-primary">
                        Add message copy before approval.
                      </p>
                    )}
                  </div>
                  {isArchivable && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void archiveActivity(activity)}
                        disabled={archivePending}
                        className="border-pink-300/50 bg-card text-rose-700 dark:text-rose-300 hover:bg-pink-500/10"
                      >
                        <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                        {archivePending ? "Archiving..." : "Archive instead"}
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {selectedCommunicationIssues.length > 0 && (
            <Card className="mt-4 rounded-xl border border-rose-300/60 bg-rose-500/10 dark:border-rose-500/35 p-4 shadow-none">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Selected message issues</p>
              <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                These items failed during review, delivery, or archive handling. Fix them here before sending again.
              </p>
              <div className="mt-3 space-y-2">
                {selectedCommunicationIssues.map((issue) => (
                  <div key={`${issue.activityId}-${issue.action}`} className="rounded-xl border border-pink-300/50 bg-card px-3 py-2">
                    <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">{issue.label}</p>
                    <p className="mt-1 text-sm text-rose-950 dark:text-rose-100">{issue.message}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => void sendSelectedActivities()}
              disabled={
                selectedCommunications.length === 0 ||
                nonApprovableSelectedCommunications.length > 0 ||
                !allSelectedCommunicationsApproved ||
                bulkSendPending ||
                selectedCommunicationHasPendingWork
              }
              className="bg-primary text-white hover:bg-primary/90"
            >
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              {bulkSendPending
                ? "Sending..."
                : `Send selected (${selectedCommunications.length})`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
