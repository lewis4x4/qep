import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { patchCrmActivity } from "../lib/crm-api";
import type { CrmActivityItem } from "../lib/types";

interface PatchBodyInput {
  activityId: string;
  body: string;
  updatedAt: string;
}

function mergeBody(activity: CrmActivityItem, body: string): CrmActivityItem {
  return {
    ...activity,
    body,
  };
}

export function useCrmActivityBodyMutation(queryKey: QueryKey) {
  const queryClient = useQueryClient();
  const [pendingBodyId, setPendingBodyId] = useState<string | null>(null);

  const patchBodyMutation = useMutation({
    mutationFn: async ({ activityId, body, updatedAt }: PatchBodyInput) =>
      patchCrmActivity(activityId, { body, updatedAt }),
    onMutate: async ({ activityId, body }) => {
      setPendingBodyId(activityId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CrmActivityItem[]>(queryKey) ?? [];
      const previousBody = previous.find((activity) => activity.id === activityId)?.body ?? null;
      queryClient.setQueryData<CrmActivityItem[]>(
        queryKey,
        previous.map((activity) => (activity.id === activityId ? mergeBody(activity, body) : activity)),
      );
      return { activityId, attemptedBody: body, previousBody };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData<CrmActivityItem[]>(
        queryKey,
        (current) =>
          current?.map((activity) =>
            activity.id === context.activityId && activity.body === context.attemptedBody
              ? { ...activity, body: context.previousBody }
              : activity
          ) ?? [],
      );
    },
    onSettled: async () => {
      setPendingBodyId(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    pendingBodyId,
    patchBody: patchBodyMutation.mutateAsync,
    patchBodyMutation,
  };
}
