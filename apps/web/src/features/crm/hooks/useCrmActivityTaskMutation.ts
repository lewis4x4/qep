import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { patchCrmActivityTask } from "../lib/crm-api";
import type { CrmActivityItem, CrmTaskMetadata } from "../lib/types";

function mergeTaskMetadata(activity: CrmActivityItem, task: CrmTaskMetadata): CrmActivityItem {
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
  task: CrmTaskMetadata;
}

export function useCrmActivityTaskMutation(queryKey: QueryKey) {
  const queryClient = useQueryClient();
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const patchTaskMutation = useMutation({
    mutationFn: async ({ activityId, task }: PatchTaskInput) =>
      patchCrmActivityTask(activityId, { task }),
    onMutate: async ({ activityId, task }) => {
      setPendingTaskId(activityId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CrmActivityItem[]>(queryKey) ?? [];
      queryClient.setQueryData<CrmActivityItem[]>(
        queryKey,
        previous.map((activity) => (activity.id === activityId ? mergeTaskMetadata(activity, task) : activity)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: async () => {
      setPendingTaskId(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    pendingTaskId,
    patchTask: patchTaskMutation.mutateAsync,
    patchTaskMutation,
  };
}
