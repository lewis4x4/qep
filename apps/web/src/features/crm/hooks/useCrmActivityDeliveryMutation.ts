import { useState } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { deliverCrmActivity } from "../lib/crm-api";
import type { CrmActivityItem } from "../lib/types";

interface DeliverActivityInput {
  activityId: string;
}

export function useCrmActivityDeliveryMutation(queryKey: QueryKey) {
  const queryClient = useQueryClient();
  const [pendingDeliveryId, setPendingDeliveryId] = useState<string | null>(null);

  const deliverActivityMutation = useMutation({
    mutationFn: async ({ activityId }: DeliverActivityInput) => deliverCrmActivity(activityId),
    onMutate: async ({ activityId }) => {
      setPendingDeliveryId(activityId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CrmActivityItem[]>(queryKey) ?? [];
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
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
    },
  });

  return {
    pendingDeliveryId,
    deliverActivity: deliverActivityMutation.mutateAsync,
    deliverActivityMutation,
  };
}
