/**
 * Post–PR 21 orchestrator slimming: AI/voice recommended machine → catalog-backed equipment.
 * Mechanical move from `QuoteBuilderV2Page.tsx` with draftRef routing fix after async catalog lookup.
 */

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { toast } from "@/hooks/use-toast";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import { searchCatalog } from "../lib/quote-api";
import { findRecommendedCatalogMatch } from "../lib/recommended-machine-catalog";
import {
  buildEquipmentLine,
  draftHasCustomer,
  equipmentKeyForLine,
} from "../lib/quote-builder-page-helpers";
import type { Step } from "../wizard/wizard-types";

export interface UseQuoteBuilderRecommendedMachineInput {
  draftRef: MutableRefObject<QuoteWorkspaceDraft>;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  setStep: (step: Step) => void;
  setAvailableOptions: Dispatch<SetStateAction<Array<{ id: string; name: string; price: number }>>>;
  setAvailableOptionsLabel: Dispatch<SetStateAction<string | null>>;
}

export function useQuoteBuilderRecommendedMachine({
  draftRef,
  setDraft,
  setStep,
  setAvailableOptions,
  setAvailableOptionsLabel,
}: UseQuoteBuilderRecommendedMachineInput): {
  addRecommendedMachine: (machine: string) => Promise<void>;
} {
  const addRecommendedMachine = useCallback(async (machine: string) => {
    try {
      const firstMatch = await findRecommendedCatalogMatch(machine, searchCatalog);
      if (!firstMatch) {
        toast({
          title: "Recommendation not in QEP catalog",
          description: "Select a verified machine from Browse Catalog before quoting.",
          variant: "destructive",
        });
        setStep("equipment");
        return;
      }
      const line = buildEquipmentLine(firstMatch);
      const nextKey = equipmentKeyForLine(line);
      setAvailableOptions(firstMatch.attachments ?? []);
      setAvailableOptionsLabel(`${firstMatch.make} ${firstMatch.model}`);
      setDraft((current) => {
        const alreadyAdded = current.equipment.some((item) => equipmentKeyForLine(item) === nextKey);
        if (alreadyAdded) return current;
        return {
          ...current,
          equipment: [...current.equipment, line],
        };
      });
    } catch (error) {
      console.error("[quote-builder] recommended machine catalog lookup failed", error);
      toast({
        title: "Catalog verification failed",
        description: "The recommendation was not added. Browse Catalog and select a verified machine.",
        variant: "destructive",
      });
      setStep("equipment");
      return;
    }
    setStep(draftHasCustomer(draftRef.current) ? "equipment" : "customer");
  }, [draftRef, setAvailableOptions, setAvailableOptionsLabel, setDraft, setStep]);

  return { addRecommendedMachine };
}
