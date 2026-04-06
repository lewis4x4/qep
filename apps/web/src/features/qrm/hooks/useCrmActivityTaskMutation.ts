import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { patchCrmActivityTask } from "../lib/qrm-api";
import type { QrmActivityItem, QrmTaskMetadata } from "../lib/types";

function mergeTaskMetadata(activity: QrmActivityItem, task: QrmTaskMetadata): QrmActivityItem {
  return {
    ...activity,
    metadata: {
      ...activity.metadata,
      task: {
        ...((activity.metadata.task as Record<string, unknown> | undefined) ?? {}),
        ...task,
      },
    },
  };
}

interface PatchTaskInput {
  activityId: string;
  task: QrmTaskMetadata;
  updatedAt: string;
}

function readTaskMetadata(activity: QrmActivityItem): QrmTaskMetadata | null {
  const task = activity.metadata.task;
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return null;
  }
  return task as QrmTaskMetadata;
}

interface ActivityMutationOptions {
  extraInvalidateKeys?: QueryKey[];
}

export function useCrmActivityTaskMutation(queryKey: QueryKey, options?: ActivityMutationOptions) {
  const queryClient = useQueryClient();
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const patchTaskMutation = useMutation({
    mutationFn: async ({ activityId, task, updatedAt }: PatchTaskInput) =>
      patchCrmActivityTask(activityId, { task, updatedAt }),
    onMutate: async ({ activityId, task }) => {
      setPendingTaskId(activityId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<QrmActivityItem[]>(queryKey) ?? [];
      const previousTask = previous.find((activity) => activity.id === activityId)
        ? readTaskMetadata(previous.find((activity) => activity.id === activityId)!)
        : null;
      queryClient.setQueryData<QrmActivityItem[]>(
        queryKey,
        previous.map((activity) => (activity.id === activityId ? mergeTaskMetadata(activity, task) : activity)),
      );
      return { activityId, attemptedTask: task, previousTask };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData<QrmActivityItem[]>(
        queryKey,
        (current) =>
          current?.map((activity) => {
            if (activity.id !== context.activityId) return activity;
            const currentTask = readTaskMetadata(activity);
            const attemptedDueAt = context.attemptedTask.dueAt ?? null;
            const attemptedStatus = context.attemptedTask.status ?? "open";
            const currentDueAt = currentTask?.dueAt ?? null;
            const currentStatus = currentTask?.status ?? "open";
            if (currentDueAt !== attemptedDueAt || currentStatus !== attemptedStatus) {
              return activity;
            }
            return mergeTaskMetadata(activity, context.previousTask ?? { dueAt: null, status: "open" });
          }) ?? [],
      );
    },
    onSettled: async () => {
      setPendingTaskId(null);
      await queryClient.invalidateQueries({ queryKey });
      if (options?.extraInvalidateKeys) {
        for (const key of options.extraInvalidateKeys) {
          await queryClient.invalidateQueries({ queryKey: key });
        }
      }
    },
  });

  return {
    pendingTaskId,
    patchTask: patchTaskMutation.mutateAsync,
    patchTaskMutation,
  };
}
