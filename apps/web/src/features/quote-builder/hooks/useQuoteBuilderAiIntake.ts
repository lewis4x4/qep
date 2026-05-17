/**
 * Post–PR 21 orchestrator slimming: voice + typed AI equipment intake mutations.
 */

import { useMutation } from "@tanstack/react-query";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { submitVoiceToQrm } from "@/features/voice-qrm/lib/voice-qrm-api";
import { toast } from "@/hooks/use-toast";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import { getAiEquipmentRecommendation } from "../lib/quote-api";
import { draftHasCustomer } from "../lib/quote-builder-page-helpers";
import type { Step } from "../wizard/wizard-types";

export interface UseQuoteBuilderAiIntakeInput {
  draftRef: MutableRefObject<QuoteWorkspaceDraft>;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  setStep: (step: Step) => void;
  setAiIntakeMessage: Dispatch<SetStateAction<string | null>>;
  setPackageToolsOpen: Dispatch<SetStateAction<boolean>>;
  setCatalogBrowserOpen: Dispatch<SetStateAction<boolean>>;
}

export function useQuoteBuilderAiIntake({
  draftRef,
  setDraft,
  setStep,
  setAiIntakeMessage,
  setPackageToolsOpen,
  setCatalogBrowserOpen,
}: UseQuoteBuilderAiIntakeInput) {
  const voiceMutation = useMutation({
    mutationFn: async (payload: { blob: Blob; fileName: string }) => {
      const voiceResult = await submitVoiceToQrm({
        audioBlob: payload.blob,
        fileName: payload.fileName,
        dealId: draftRef.current.dealId || undefined,
      });
      if (!("transcript" in voiceResult) || !voiceResult.transcript) {
        throw new Error("Voice note did not return a usable transcript.");
      }
      const recommendation = await getAiEquipmentRecommendation(voiceResult.transcript);
      return { voiceResult, recommendation };
    },
    onSuccess: ({ voiceResult, recommendation }) => {
      const entities = "entities" in voiceResult ? voiceResult.entities : null;
      const contactName = entities?.contact?.name?.trim() || "";
      const companyName = entities?.company?.name?.trim() || "";
      const contactId = entities?.contact?.id ?? null;
      const companyId = entities?.company?.id ?? null;
      setDraft((current) => ({
        ...current,
        recommendation,
        voiceSummary: voiceResult.transcript,
        customerName: current.customerName?.trim() ? current.customerName : contactName,
        customerCompany: current.customerCompany?.trim() ? current.customerCompany : companyName,
        contactId: current.contactId ?? contactId ?? undefined,
        companyId: current.companyId ?? companyId ?? undefined,
      }));
      setStep("customer");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Voice intake failed. Try again or browse the catalog.";
      setAiIntakeMessage(message);
      toast({
        title: "Voice intake failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const aiIntakeMutation = useMutation({
    onMutate: () => {
      setAiIntakeMessage(null);
    },
    mutationFn: async (prompt: string) => {
      const recommendation = await getAiEquipmentRecommendation(prompt);
      return { recommendation, prompt };
    },
    onSuccess: ({ recommendation, prompt }) => {
      setDraft((current) => ({
        ...current,
        recommendation,
        voiceSummary: prompt,
      }));
      if (!recommendation.machine) {
        const message = recommendation.reasoning || "AI could not find a sellable QEP catalog match. Browse the catalog and pick a verified machine.";
        setAiIntakeMessage(message);
        setPackageToolsOpen(true);
        setCatalogBrowserOpen(true);
        setStep("equipment");
        toast({
          title: "No catalog-backed machine found",
          description: message,
          variant: "destructive",
        });
        return;
      }
      const hasCustomer = draftHasCustomer(draftRef.current);
      setStep(hasCustomer ? "equipment" : "customer");
      toast({
        title: "Catalog-backed recommendation ready",
        description: hasCustomer
          ? "Review the verified machine on the equipment step."
          : "Confirm the customer, then review the verified machine.",
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "AI recommendation failed. Try again or browse the catalog.";
      setAiIntakeMessage(message);
      toast({
        title: "AI intake failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const onVoiceRecorded = useCallback((audioBlob: Blob, fileName: string) => {
    voiceMutation.mutate({ blob: audioBlob, fileName });
  }, [voiceMutation]);

  const onBuildWithAi = useCallback((prompt: string) => {
    aiIntakeMutation.mutate(prompt);
  }, [aiIntakeMutation]);

  return {
    voiceMutation,
    aiIntakeMutation,
    onVoiceRecorded,
    onBuildWithAi,
  };
}
