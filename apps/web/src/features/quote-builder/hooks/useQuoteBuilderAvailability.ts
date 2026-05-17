/**
 * Post–PR 21 orchestrator slimming: availability requests + equipment step gates.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import { toast } from "@/hooks/use-toast";
import type { QuoteLineItemDraft, QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import {
  listQuoteAvailabilityRequests,
  requestQuoteAvailability,
  type QuoteAvailabilityRequest,
} from "../lib/quote-api";
import {
  availabilityClientLineKey,
  availabilityRequestIdForLine,
  availabilityRequestStatusForLine,
  availabilityStatusForLine,
  draftHasCustomer,
  metadataString,
} from "../lib/quote-builder-page-helpers";

export interface UseQuoteBuilderAvailabilityInput {
  activeQuotePackageId: string | null;
  draft: QuoteWorkspaceDraft;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  netTotal: number;
  tradeChecklistComplete: boolean;
}

export function useQuoteBuilderAvailability({
  activeQuotePackageId,
  draft,
  setDraft,
  netTotal,
  tradeChecklistComplete,
}: UseQuoteBuilderAvailabilityInput) {
  const queryClient = useQueryClient();

  const availabilityRequestsQuery = useQuery({
    queryKey: ["quote-builder", "availability-requests", activeQuotePackageId],
    queryFn: () => listQuoteAvailabilityRequests(activeQuotePackageId!),
    enabled: Boolean(activeQuotePackageId),
    staleTime: 5_000,
  });

  const availabilityRequestsById = useMemo(() => {
    const map = new Map<string, QuoteAvailabilityRequest>();
    for (const request of availabilityRequestsQuery.data ?? []) {
      map.set(request.id, request);
    }
    return map;
  }, [availabilityRequestsQuery.data]);

  const liveAvailabilityRequestForLine = useCallback((item: QuoteLineItemDraft): QuoteAvailabilityRequest | null => {
    const requestId = availabilityRequestIdForLine(item);
    return requestId ? availabilityRequestsById.get(requestId) ?? null : null;
  }, [availabilityRequestsById]);

  const liveAvailabilityStatusForLine = useCallback((item: QuoteLineItemDraft): string | null => {
    const request = liveAvailabilityRequestForLine(item);
    return request?.status ?? availabilityRequestStatusForLine(item);
  }, [liveAvailabilityRequestForLine]);

  const availabilityRequestMutation = useMutation({
    mutationFn: async ({ equipment, index }: { equipment: QuoteLineItemDraft; index: number }) => {
      const clientLineKey = metadataString(equipment.metadata, "availability_client_line_key")
        ?? availabilityClientLineKey(equipment, index);
      const requestedMachineLabel = equipment.title || [equipment.make, equipment.model].filter(Boolean).join(" ").trim() || "Equipment";
      const request = await requestQuoteAvailability({
        quotePackageId: activeQuotePackageId,
        availabilityRequestId: availabilityRequestIdForLine(equipment),
        clientLineKey,
        sourceCatalog: equipment.sourceCatalog ?? null,
        sourceId: equipment.sourceId ?? equipment.id ?? null,
        catalogModelId: equipment.sourceCatalog === "qb_equipment_models" ? equipment.sourceId ?? equipment.id ?? null : null,
        requestedMachineLabel,
        make: equipment.make ?? null,
        model: equipment.model ?? null,
        year: equipment.year ?? null,
        customerNeed: draft.voiceSummary ?? null,
        requestedBudget: netTotal > 0 ? netTotal : equipment.unitPrice,
        urgency: "normal",
        allowAlternatives: true,
      });
      return { request, index, clientLineKey };
    },
    onSuccess: ({ request, index, clientLineKey }) => {
      setDraft((current) => ({
        ...current,
        equipment: current.equipment.map((item, rowIndex) => rowIndex === index
          ? {
              ...item,
              metadata: {
                ...(item.metadata ?? {}),
                availability_status: availabilityStatusForLine(item),
                availability_request_id: request.id,
                availability_request_status: request.status,
                availability_client_line_key: clientLineKey,
                availability_confirmation_requested_at: request.createdAt ?? new Date().toISOString(),
                availability_candidate_count: request.candidates.length,
              },
            }
          : item),
      }));
      toast({
        title: "Availability request created",
        description: `${request.requestedMachineLabel} is now pending sourcing review.`,
      });
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "availability-requests"] });
    },
    onError: (error) => {
      toast({
        title: "Availability request failed",
        description: error instanceof Error ? error.message : "Could not create the sourcing request.",
        variant: "destructive",
      });
    },
  });

  const markAvailabilityConfirmationRequested = useCallback((index: number) => {
    const equipment = draft.equipment[index];
    if (!equipment) return;
    availabilityRequestMutation.mutate({ equipment, index });
  }, [availabilityRequestMutation, draft.equipment]);

  const markAllAvailabilityConfirmationRequested = useCallback(() => {
    draft.equipment.forEach((equipment, index) => {
      if (availabilityStatusForLine(equipment) === "source_required" && !availabilityRequestIdForLine(equipment)) {
        availabilityRequestMutation.mutate({ equipment, index });
      }
    });
  }, [availabilityRequestMutation, draft.equipment]);

  const hasCustomer = draftHasCustomer(draft);
  const hasEquipmentLine = draft.equipment.length > 0;
  const sourceRequiredEquipment = draft.equipment.filter((item) => availabilityStatusForLine(item) === "source_required");
  const sourceRequiredAwaitingConfirmation = sourceRequiredEquipment.filter((item) => !availabilityRequestIdForLine(item));
  const sourceRequiredUnavailable = sourceRequiredEquipment.filter((item) => {
    const request = liveAvailabilityRequestForLine(item);
    return request?.status === "not_available" && !request.managerOverrideAt;
  });
  const inboundFreightEligible = draft.equipment.some((item) => availabilityStatusForLine(item) !== "in_stock");
  const equipmentCanContinue = hasEquipmentLine && sourceRequiredAwaitingConfirmation.length === 0 && sourceRequiredUnavailable.length === 0;
  const tradeManagerApprovalRequired = draft.tradeAllowance > 0 && !tradeChecklistComplete;
  const signalsReady = hasCustomer && hasEquipmentLine;

  return {
    availabilityRequestsQuery,
    liveAvailabilityRequestForLine,
    liveAvailabilityStatusForLine,
    markAvailabilityConfirmationRequested,
    markAllAvailabilityConfirmationRequested,
    availabilityRequestMutation,
    hasCustomer,
    hasEquipmentLine,
    sourceRequiredAwaitingConfirmation,
    sourceRequiredUnavailable,
    inboundFreightEligible,
    equipmentCanContinue,
    tradeManagerApprovalRequired,
    signalsReady,
  };
}
