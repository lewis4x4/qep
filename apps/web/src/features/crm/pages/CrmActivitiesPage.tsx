import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
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
import { CrmPageHeader } from "../components/CrmPageHeader";
import { deliverCrmActivity, listCrmActivityFeed, patchCrmActivity } from "../lib/crm-api";
import type { CrmActivityFeedItem, CrmActivityType, CrmTaskMetadata } from "../lib/types";

type FeedFilter = "all" | "communication" | "tasks" | "overdue";

const ACTIVITY_META: Record<
  CrmActivityType,
  {
    label: string;
    icon: typeof Phone;
    badgeClassName: string;
  }
> = {
  call: { label: "Call", icon: Phone, badgeClassName: "bg-green-100 text-green-900" },
  email: { label: "Email", icon: Mail, badgeClassName: "bg-blue-100 text-blue-900" },
  meeting: { label: "Meeting", icon: UserRound, badgeClassName: "bg-violet-100 text-violet-900" },
  note: { label: "Note", icon: MessageSquareText, badgeClassName: "bg-slate-200 text-slate-900" },
  sms: { label: "SMS", icon: MessageSquareText, badgeClassName: "bg-cyan-100 text-cyan-900" },
  task: { label: "Task", icon: ClipboardList, badgeClassName: "bg-amber-100 text-amber-900" },
};

function readTaskMetadata(activity: CrmActivityFeedItem): CrmTaskMetadata | null {
  if (activity.activityType !== "task") return null;
  const task = activity.metadata.task;
  if (!task || typeof task !== "object" || Array.isArray(task)) return null;
  return task as CrmTaskMetadata;
}

function readDeliveryMetadata(activity: CrmActivityFeedItem): Record<string, unknown> | null {
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

function isOverdueTask(activity: CrmActivityFeedItem): boolean {
  const task = readTaskMetadata(activity);
  if (!task?.dueAt) return false;
  if (task.status === "completed") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function taskTone(task: CrmTaskMetadata | null): string {
  if (!task) return "text-[#475569]";
  if (task.status === "completed") return "text-emerald-700";
  if (task.dueAt && new Date(task.dueAt).getTime() < Date.now()) return "text-rose-700";
  return "text-amber-700";
}

function deliveryTone(delivery: Record<string, unknown> | null): string {
  const status = typeof delivery?.status === "string" ? delivery.status : null;
  if (status === "failed") return "bg-rose-100 text-rose-800";
  if (status === "manual_logged") return "bg-amber-100 text-amber-900";
  if (status === "sent") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-700";
}

function canSendFromInbox(activity: CrmActivityFeedItem): boolean {
  const delivery = readDeliveryMetadata(activity);
  if (!delivery || (activity.activityType !== "email" && activity.activityType !== "sms")) {
    return false;
  }
  const status = typeof delivery.status === "string" ? delivery.status : null;
  return status === "failed" || status === "manual_logged";
}

function deliveryActionLabel(delivery: Record<string, unknown> | null): string {
  const status = typeof delivery?.status === "string" ? delivery.status : null;
  return status === "failed" ? "Retry send" : "Send now";
}

function activityTargetHref(activity: CrmActivityFeedItem): string | null {
  if (activity.dealId) return `/crm/deals/${activity.dealId}`;
  if (activity.contactId) return `/crm/contacts/${activity.contactId}`;
  if (activity.companyId) return `/crm/companies/${activity.companyId}`;
  return null;
}

function activityTargetLabel(activity: CrmActivityFeedItem): string {
  if (activity.dealName) return activity.dealName;
  if (activity.contactName) return activity.contactName;
  if (activity.companyName) return activity.companyName;
  return "Open record";
}

export function CrmActivitiesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [typeFilter, setTypeFilter] = useState<CrmActivityType | "all">("all");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([]);
  const [draftBodies, setDraftBodies] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
  const queryKey = ["crm", "activities", "feed"] as const;

  const activitiesQuery = useQuery({
    queryKey,
    queryFn: listCrmActivityFeed,
    staleTime: 30_000,
  });

  const activities = activitiesQuery.data ?? [];
  const selectedActivities = useMemo(
    () => activities.filter((activity) => selectedActivityIds.includes(activity.id)),
    [activities, selectedActivityIds],
  );

  const deliveryMutation = useMutation({
    mutationFn: async (input: { activityId: string; updatedAt: string }) =>
      deliverCrmActivity(input.activityId, input.updatedAt),
    onSuccess: (updatedActivity) => {
      queryClient.setQueryData<CrmActivityFeedItem[]>(
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
      queryClient.setQueryData<CrmActivityFeedItem[]>(
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

  function toggleSelected(activityId: string): void {
    setSelectedActivityIds((current) =>
      current.includes(activityId)
        ? current.filter((id) => id !== activityId)
        : [...current, activityId]
    );
  }

  function readDraftBody(activity: CrmActivityFeedItem): string {
    return draftBodies[activity.id] ?? activity.body ?? "";
  }

  function draftBodyDirty(activity: CrmActivityFeedItem): boolean {
    return readDraftBody(activity) !== (activity.body ?? "");
  }

  async function saveActivityDraft(activity: CrmActivityFeedItem): Promise<CrmActivityFeedItem> {
    const nextBody = readDraftBody(activity);
    if (!draftBodyDirty(activity)) {
      return activity;
    }

    const updatedActivity = await bodyMutation.mutateAsync({
      activityId: activity.id,
      body: nextBody,
      updatedAt: activity.updatedAt,
    });

    return {
      ...activity,
      ...updatedActivity,
    };
  }

  async function handleSaveDraft(activity: CrmActivityFeedItem): Promise<void> {
    try {
      await saveActivityDraft(activity);
      toast({
        title: "Draft saved",
        description: `${activity.activityType === "sms" ? "SMS" : "Email"} content was updated in review.`,
      });
    } catch (error) {
      toast({
        title: "Could not save draft",
        description: error instanceof Error ? error.message : "Review changes were not saved.",
        variant: "destructive",
      });
    }
  }

  async function sendSingleActivity(activity: CrmActivityFeedItem): Promise<void> {
    try {
      await deliveryMutation.mutateAsync({
        activityId: activity.id,
        updatedAt: activity.updatedAt,
      });
      setSelectedActivityIds((current) => current.filter((id) => id !== activity.id));
      toast({
        title: "Message queued",
        description: `${activity.activityType === "sms" ? "SMS" : "Email"} delivery was retried from the activity inbox.`,
      });
    } catch (error) {
      toast({
        title: "Delivery failed",
        description: error instanceof Error ? error.message : "Could not send the selected activity.",
        variant: "destructive",
      });
    }
  }

  async function sendSelectedActivities(): Promise<void> {
    const sendableActivities = selectedActivities.filter(canSendFromInbox);
    if (sendableActivities.length === 0) {
      setReviewOpen(false);
      return;
    }

    const results = await Promise.allSettled(
      sendableActivities.map(async (activity) => {
        const preparedActivity = await saveActivityDraft(activity);
        await deliveryMutation.mutateAsync({
          activityId: preparedActivity.id,
          updatedAt: preparedActivity.updatedAt,
        });
        return activity.id;
      }),
    );

    const succeeded = results
      .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
      .map((result) => result.value);
    const failed = results.filter((result) => result.status === "rejected");

    if (succeeded.length > 0) {
      setSelectedActivityIds((current) => current.filter((id) => !succeeded.includes(id)));
    }

    if (failed.length === 0) {
      setReviewOpen(false);
      toast({
        title: "Bulk send complete",
        description: `${succeeded.length} communication${succeeded.length === 1 ? "" : "s"} sent from the inbox.`,
      });
      return;
    }

    toast({
      title: "Bulk send completed with issues",
      description: `${succeeded.length} sent, ${failed.length} still need review.`,
      variant: "destructive",
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <CrmPageHeader
        title="CRM Activities"
        subtitle="Run calls, texts, emails, and task follow-through from one rep-safe activity feed."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Activity summary">
        {[
          { label: "Open tasks", value: summary.openTasks, tone: "text-amber-700 bg-amber-50 border-amber-200" },
          { label: "Overdue tasks", value: summary.overdueTasks, tone: "text-rose-700 bg-rose-50 border-rose-200" },
          { label: "Failed deliveries", value: summary.failedDeliveries, tone: "text-blue-800 bg-blue-50 border-blue-200" },
          { label: "Touches today", value: summary.todayTouches, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
        ].map((item) => (
          <Card key={item.label} className={cn("border p-4 shadow-sm", item.tone)}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em]">{item.label}</p>
            <p className="mt-2 text-3xl font-bold">{item.value}</p>
          </Card>
        ))}
      </section>

      <Card className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#475569]" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search activity body, rep, contact, company, or deal"
              className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white pl-9 pr-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[#64748B]" aria-hidden="true" />
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as CrmActivityType | "all")}
              className="h-11 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
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
                  ? "border-[#E87722] bg-[#FFF1E6] text-[#B45309] hover:bg-[#FFF1E6]"
                  : "border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]"
              )}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {selectedActivities.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-[#FED7AA] bg-[#FFF7ED] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#9A3412]">
                {selectedActivities.length} communication{selectedActivities.length === 1 ? "" : "s"} selected
              </p>
              <p className="mt-1 text-xs text-[#9A3412]">
                Review manual and failed messages together, then send them as one operator action.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelectedActivityIds([])}
                className="border-[#FDBA74] bg-white text-[#9A3412] hover:bg-[#FFF1E6]"
              >
                Clear
              </Button>
              <Button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="bg-[#E87722] text-white hover:bg-[#D46B1B]"
              >
                <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
                Review selected
              </Button>
            </div>
          </div>
        )}
      </Card>

      {activitiesQuery.isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading activities">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />
          ))}
        </div>
      )}

      {activitiesQuery.isError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">Failed to load the CRM activity feed. Refresh and try again.</p>
        </Card>
      )}

      {!activitiesQuery.isLoading && !activitiesQuery.isError && filteredActivities.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">No activity matches the current filters.</p>
        </Card>
      )}

      {!activitiesQuery.isLoading && !activitiesQuery.isError && filteredActivities.length > 0 && (
        <div className="space-y-3" aria-label="CRM activity feed">
          {filteredActivities.map((activity) => {
            const meta = ACTIVITY_META[activity.activityType];
            const Icon = meta.icon;
            const task = readTaskMetadata(activity);
            const delivery = readDeliveryMetadata(activity);
            const targetHref = activityTargetHref(activity);
            const targetLabel = activityTargetLabel(activity);

            return (
              <Card key={activity.id} className="rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {canSendFromInbox(activity) && (
                        <label className="inline-flex items-center gap-2 rounded-full border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-medium text-[#334155]">
                          <input
                            type="checkbox"
                            checked={selectedActivityIds.includes(activity.id)}
                            onChange={() => toggleSelected(activity.id)}
                            className="h-4 w-4 rounded border-[#CBD5E1] text-[#E87722] focus:ring-[#E87722]"
                            aria-label={`Select ${meta.label} activity`}
                          />
                          Select
                        </label>
                      )}
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", meta.badgeClassName)}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {meta.label}
                      </span>
                      <span className="text-xs font-medium text-[#64748B]">
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

                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#0F172A]">
                      {activity.body || "No activity details logged."}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#475569]">
                      <span>Logged by {activity.actorName || "Unknown user"}</span>
                      {activity.contactName && <span>Contact: {activity.contactName}</span>}
                      {activity.companyName && <span>Company: {activity.companyName}</span>}
                      {activity.dealName && <span>Deal: {activity.dealName}</span>}
                    </div>
                  </div>

                  {targetHref && (
                    <div className="flex flex-wrap items-center gap-2 self-start">
                      {canSendFromInbox(activity) && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void sendSingleActivity(activity)}
                          disabled={deliveryMutation.isPending}
                          className="min-h-[44px] rounded-full bg-[#E87722] px-4 text-white hover:bg-[#D46B1B]"
                        >
                          <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                          {deliveryMutation.isPending ? "Sending..." : deliveryActionLabel(delivery)}
                        </Button>
                      )}
                      <Link
                        to={targetHref}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#D6E0EA] bg-[#F8FAFC] px-4 py-2 text-sm font-medium text-[#0F172A] transition hover:border-[#E87722]/50 hover:text-[#B45309]"
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

      <Card className="rounded-2xl border border-[#D6E0EA] bg-[#F8FAFC] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#0F172A]">Next communication-hub closeout</p>
            <p className="mt-1 text-sm text-[#475569]">
              After this feed lands, the next remaining Sprint 4 gap is deeper operator controls around templates, bulk execution, and communication review workflows.
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
            {selectedActivities.length === 0 && (
              <Card className="rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-5 text-sm text-[#475569]">
                No communications selected.
              </Card>
            )}

            {selectedActivities.map((activity) => {
              const delivery = readDeliveryMetadata(activity);
              const isEditable = canSendFromInbox(activity);
              const dirty = draftBodyDirty(activity);
              return (
                <Card key={activity.id} className="rounded-xl border border-[#E2E8F0] p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", deliveryTone(delivery))}>
                          {deliveryActionLabel(delivery)}
                        </span>
                        <span className="text-xs text-[#64748B]">{formatTimeLabel(activity.occurredAt)}</span>
                        {dirty && (
                          <span className="inline-flex rounded-full bg-[#FFF1E6] px-2.5 py-1 text-xs font-semibold text-[#B45309]">
                            Unsaved edits
                          </span>
                        )}
                      </div>
                      {isEditable ? (
                        <div className="mt-3 space-y-3">
                          <textarea
                            value={readDraftBody(activity)}
                            onChange={(event) =>
                              setDraftBodies((current) => ({
                                ...current,
                                [activity.id]: event.target.value,
                              }))
                            }
                            rows={6}
                            className="min-h-[144px] w-full rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-sm leading-6 text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
                            aria-label={`Edit ${activity.activityType} body`}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setDraftBodies((current) => ({
                                  ...current,
                                  [activity.id]: activity.body ?? "",
                                }))
                              }
                              disabled={!dirty || bodyMutation.isPending}
                            >
                              Reset
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleSaveDraft(activity)}
                              disabled={!dirty || bodyMutation.isPending}
                              className="bg-[#0F172A] text-white hover:bg-[#1E293B]"
                            >
                              {bodyMutation.isPending ? "Saving..." : "Save draft"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#0F172A]">
                          {activity.body || "No message body available."}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-[#475569]">
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
                </Card>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => void sendSelectedActivities()}
              disabled={selectedActivities.length === 0 || deliveryMutation.isPending || bodyMutation.isPending}
              className="bg-[#E87722] text-white hover:bg-[#D46B1B]"
            >
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              {deliveryMutation.isPending || bodyMutation.isPending
                ? "Sending..."
                : `Send selected (${selectedActivities.length})`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
