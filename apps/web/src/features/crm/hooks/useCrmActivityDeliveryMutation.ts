import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { deliverCrmActivity } from "../lib/crm-api";
import type { CrmActivityItem } from "../lib/types";

interface DeliverActivityInput {
  activityId: string;
  updatedAt: string;
}

interface ActivityMutationOptions {
  extraInvalidateKeys?: QueryKey[];
}

export function useCrmActivityDeliveryMutation(queryKey: QueryKey, options?: ActivityMutationOptions) {
  const queryClient = useQueryClient();
  const [pendingDeliveryId, setPendingDeliveryId] = useState<string | null>(null);

  const deliverActivityMutation = useMutation({
    mutationFn: async ({ activityId, updatedAt }: DeliverActivityInput) => deliverCrmActivity(activityId, updatedAt),
    onMutate: async ({ activityId }) => {
      setPendingDeliveryId(activityId);
      await queryClient.cancelQueries({ queryKey });
    },
    onSuccess: (activity) => {
      queryClient.setQueryData<CrmActivityItem[]>(
        queryKey,
        (current) => current?.map((item) => (item.id === activity.id ? activity : item)) ?? [activity],
      );
    },
    onSettled: async () => {
      setPendingDeliveryId(null);
      await queryClient.invalidateQueries({ queryKey });
      if (options?.extraInvalidateKeys) {
        for (const key of options.extraInvalidateKeys) {
          await queryClient.invalidateQueries({ queryKey: key });
        }
      }
    },
  });

  return {
    pendingDeliveryId,
    deliverActivity: deliverActivityMutation.mutateAsync,
    deliverActivityMutation,
  };
}
