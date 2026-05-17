/**
 * Post–PR 21 orchestrator slimming: Iron intake + voice quote handoff effects.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ScenarioSelection } from "../components/ConversationalDealEngine";
import {
  appendMissingIronLines,
  buildIronQuoteIntakeEquipmentLine,
  buildIronQuoteIntakeOptionLines,
  buildIronQuoteIntakeSummary,
} from "../lib/quote-builder-page-helpers";
import {
  clearIronQuoteHandoff,
  normalizeIronQuoteHandoff,
  readIronQuoteHandoff,
} from "../lib/iron-quote-handoff";
import {
  clearVoiceQuoteHandoff,
  readVoiceQuoteHandoff,
} from "@/features/voice-quote/lib/voice-quote-handoff";
import { toast } from "@/hooks/use-toast";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import type { Step } from "../wizard/wizard-types";

export interface UseQuoteBuilderHandoffsInput {
  packageId: string;
  dealId: string;
  voiceSessionId: string;
  ironQuoteHandoffId: string;
  ironQuoteHandoffState: unknown;
  existingQuote: Record<string, unknown> | null;
  existingQuoteLoading: boolean;
  existingQuoteFetching: boolean;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  setStep: (step: Step) => void;
  setAiPrompt: Dispatch<SetStateAction<string>>;
  setAiIntakeMessage: Dispatch<SetStateAction<string | null>>;
  onVoiceHandoff: (selection: ScenarioSelection & { at?: string }) => void;
}

export function useQuoteBuilderHandoffs({
  packageId,
  dealId,
  voiceSessionId,
  ironQuoteHandoffId,
  ironQuoteHandoffState,
  existingQuote,
  existingQuoteLoading,
  existingQuoteFetching,
  setDraft,
  setStep,
  setAiPrompt,
  setAiIntakeMessage,
  onVoiceHandoff,
}: UseQuoteBuilderHandoffsInput): void {
  const voiceHandoffHydrationKeyRef = useRef<string | null>(null);
  const ironQuoteHandoffHydrationKeyRef = useRef<string | null>(null);
  const onVoiceHandoffRef = useRef(onVoiceHandoff);
  useEffect(() => {
    onVoiceHandoffRef.current = onVoiceHandoff;
  }, [onVoiceHandoff]);

  useEffect(() => {
    if (!ironQuoteHandoffId) return;
    if (packageId || dealId) return;
    if (existingQuoteFetching || existingQuoteLoading) return;
    if (existingQuote) return;
    if (ironQuoteHandoffHydrationKeyRef.current === ironQuoteHandoffId) return;
    ironQuoteHandoffHydrationKeyRef.current = ironQuoteHandoffId;

    const handoff = readIronQuoteHandoff(ironQuoteHandoffId)
      ?? normalizeIronQuoteHandoff(ironQuoteHandoffState, { expectedHandoffId: ironQuoteHandoffId });
    if (!handoff) {
      toast({
        title: "Quote intake expired",
        description: "Start manually or ask Iron again.",
        variant: "destructive",
      });
      return;
    }

    clearIronQuoteHandoff();
    const intakeSummary = buildIronQuoteIntakeSummary(handoff);
    const equipmentLine = buildIronQuoteIntakeEquipmentLine(handoff);
    const optionLines = buildIronQuoteIntakeOptionLines(handoff);
    setDraft((current) => ({
      ...current,
      entryMode: "ai_chat",
      contactId: handoff.resolvedContactId ?? current.contactId,
      companyId: handoff.resolvedCompanyId ?? current.companyId,
      customerName: current.customerName || handoff.resolvedCustomerName || handoff.structuredCustomerText || "",
      customerCompany: current.customerCompany || handoff.resolvedCustomerCompany || handoff.structuredCustomerText || "",
      customerPhone: current.customerPhone || handoff.resolvedCustomerPhone || "",
      customerEmail: current.customerEmail || handoff.resolvedCustomerEmail || "",
      voiceSummary: current.voiceSummary || intakeSummary,
      equipment: current.equipment.length > 0 || !equipmentLine ? current.equipment : [equipmentLine],
      attachments: appendMissingIronLines(current.attachments, optionLines),
    }));
    setAiPrompt(intakeSummary);
    setAiIntakeMessage(
      handoff.structuredEquipmentText
        ? "Iron captured the quote intake and created starter equipment/options lines. Verify customer, price the lines, then continue the quote."
        : "Iron brought this quote intake over. Verify the customer, then configure equipment/options/timeframe before pricing.",
    );
    setStep(equipmentLine ? "equipment" : "customer");
  }, [
    dealId,
    existingQuote,
    existingQuoteFetching,
    existingQuoteLoading,
    ironQuoteHandoffId,
    ironQuoteHandoffState,
    packageId,
    setAiIntakeMessage,
    setAiPrompt,
    setDraft,
    setStep,
  ]);

  useEffect(() => {
    if (!voiceSessionId) return;
    if (packageId || dealId) return;
    if (existingQuoteFetching || existingQuoteLoading) return;
    if (existingQuote) return;
    if (voiceHandoffHydrationKeyRef.current === voiceSessionId) return;
    voiceHandoffHydrationKeyRef.current = voiceSessionId;

    const handoff = readVoiceQuoteHandoff(voiceSessionId);
    if (!handoff) {
      toast({
        title: "Voice handoff expired",
        description: "Start manually or record again.",
        variant: "destructive",
      });
      return;
    }

    clearVoiceQuoteHandoff();
    onVoiceHandoffRef.current(handoff);
  }, [
    dealId,
    existingQuote,
    existingQuoteFetching,
    existingQuoteLoading,
    packageId,
    voiceSessionId,
  ]);
}
