import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { patchCrmActivity } from "../lib/crm-api";
import type { CrmActivityItem } from "../lib/types";

interface PatchOccurredAtInput {
  activityId: string;
  occurredAt: string;
  updatedAt: string;
}

function sortActivities(items: CrmActivityItem[]): CrmActivityItem[] {
  return [...items].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}

interface ActivityMutationOptions {
  extraInvalidateKeys?: QueryKey[];
}

export function useCrmActivityOccurredAtMutation(queryKey: QueryKey, options?: ActivityMutationOptions) {
  const queryClient = useQueryClient();
  const [pendingOccurredAtId, setPendingOccurredAtId] = useState<string | null>(null);

  const patchOccurredAtMutation = useMutation({
    mutationFn: async ({ activityId, occurredAt, updatedAt }: PatchOccurredAtInput) =>
      patchCrmActivity(activityId, { occurredAt, updatedAt }),
    onMutate: async ({ activityId }) => {
      setPendingOccurredAtId(activityId);
      await queryClient.cancelQueries({ queryKey });
    },
    onSuccess: (activity) => {
      queryClient.setQueryData<CrmActivityItem[]>(
        queryKey,
        (current) => sortActivities(
          current?.map((item) => (item.id === activity.id ? activity : item)) ?? [activity],
        ),
      );
    },
    onSettled: async () => {
      setPendingOccurredAtId(null);
      await queryClient.invalidateQueries({ queryKey });
      if (options?.extraInvalidateKeys) {
        for (const key of options.extraInvalidateKeys) {
          await queryClient.invalidateQueries({ queryKey: key });
        }
      }
    },
  });

  return {
    pendingOccurredAtId,
    patchOccurredAt: patchOccurredAtMutation.mutateAsync,
    patchOccurredAtMutation,
  };
}
