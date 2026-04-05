import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createServiceJob,
  updateServiceJob,
  transitionServiceJob,
} from "../lib/api";

export function useCreateServiceJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => createServiceJob(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
    },
  });
}

export function useUpdateServiceJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...fields }: { id: string; [k: string]: unknown }) =>
      updateServiceJob(id, fields),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
      qc.invalidateQueries({ queryKey: ["service-job", variables.id] });
    },
  });
}

export function useTransitionServiceJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      toStage,
      blockerInfo,
    }: {
      id: string;
      toStage: string;
      blockerInfo?: { blocker_type: string; blocker_description?: string };
    }) => transitionServiceJob(id, toStage, blockerInfo),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
      qc.invalidateQueries({ queryKey: ["service-job", variables.id] });
    },
  });
}
