import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { patchCrmActivity } from "../lib/qrm-api";
import type { QrmActivityItem } from "../lib/types";

interface PatchBodyInput {
  activityId: string;
  body: string;
  updatedAt: string;
}

function mergeBody(activity: QrmActivityItem, body: string): QrmActivityItem {
  return {
    ...activity,
    body,
  };
}

interface ActivityMutationOptions {
  extraInvalidateKeys?: QueryKey[];
}

export function useCrmActivityBodyMutation(queryKey: QueryKey, options?: ActivityMutationOptions) {
  const queryClient = useQueryClient();
  const [pendingBodyId, setPendingBodyId] = useState<string | null>(null);

  const patchBodyMutation = useMutation({
    mutationFn: async ({ activityId, body, updatedAt }: PatchBodyInput) =>
      patchCrmActivity(activityId, { body, updatedAt }),
    onMutate: async ({ activityId, body }) => {
      setPendingBodyId(activityId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<QrmActivityItem[]>(queryKey) ?? [];
      const previousBody = previous.find((activity) => activity.id === activityId)?.body ?? null;
      queryClient.setQueryData<QrmActivityItem[]>(
        queryKey,
        previous.map((activity) => (activity.id === activityId ? mergeBody(activity, body) : activity)),
      );
      return { activityId, attemptedBody: body, previousBody };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData<QrmActivityItem[]>(
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
      if (options?.extraInvalidateKeys) {
        for (const key of options.extraInvalidateKeys) {
          await queryClient.invalidateQueries({ queryKey: key });
        }
      }
    },
  });

  return {
    pendingBodyId,
    patchBody: patchBodyMutation.mutateAsync,
    patchBodyMutation,
  };
}
