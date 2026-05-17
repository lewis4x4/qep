/**
 * QRM Quote Builder — save + submit-for-approval orchestration hook.
 *
 * Post–PR 21 orchestrator slimming: extracts `saveMutation`,
 * `submitApprovalMutation`, margin-floor gate handlers, and active-quote
 * identity derivations from `QuoteBuilderV2Page.tsx`. Mechanical move —
 * behavior preserved 1:1.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  getApplicableThreshold,
  isUnderThreshold,
  logMarginException,
} from "@/features/admin/lib/pricing-discipline-api";
import { toast } from "@/hooks/use-toast";
import type {
  QuoteFinanceScenario,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import {
  buildQuoteSavePayload,
  saveQuotePackage,
  submitQuoteForApproval,
  type QuotePackageSaveResponse,
} from "../lib/quote-api";
import { computeWinProbability } from "../lib/win-probability-scorer";
import {
  buildLocalDraftKey,
  clearLocalDraft,
} from "../lib/local-draft";
import type { AutoSaveState } from "../wizard/wizard-types";

export interface QuoteBuilderSaveTotals {
  equipmentTotal: number;
  attachmentTotal: number;
  subtotal: number;
  discountTotal: number;
  discountedSubtotal: number;
  netTotal: number;
  taxTotal: number;
  customerTotal: number;
  cashDown: number;
  amountFinanced: number;
  marginAmount: number;
  marginPct: number;
}

export interface QuoteBuilderWinProbContext {
  marginPct: number;
  marginBaselineMedianPct: number | null;
}

export interface UseQuoteBuilderSaveInput {
  draft: QuoteWorkspaceDraft;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  totals: QuoteBuilderSaveTotals;
  allFinanceScenarios: QuoteFinanceScenario[];
  winProbContext: QuoteBuilderWinProbContext;
  persistedQuotePackageIdRef: MutableRefObject<string | null>;
  existingQuote: Record<string, unknown> | null;
  urlPackageId?: string | null;
  localDraftKey: string | null;
  userId: string | undefined;
  dealId: string | null;
  profile: { id: string; active_workspace_id?: string | null } | null;
  setLastSavedAt: Dispatch<SetStateAction<string | null>>;
  setAutoSaveState: Dispatch<SetStateAction<AutoSaveState>>;
  setLocalPersistEnabled: Dispatch<SetStateAction<boolean>>;
}

export interface UseQuoteBuilderSaveResult {
  saveMutation: UseMutationResult<QuotePackageSaveResponse, Error, void, unknown>;
  submitApprovalMutation: UseMutationResult<
    Awaited<ReturnType<typeof submitQuoteForApproval>>,
    Error,
    void,
    unknown
  >;
  marginGateOpen: boolean;
  setMarginGateOpen: Dispatch<SetStateAction<boolean>>;
  handleSaveClick: () => Promise<void>;
  handleMarginReasonConfirm: (payload: {
    reason: string;
    thresholdPct: number;
    estimatedGapCents: number;
  }) => Promise<void>;
  activeQuotePackageId: string | null;
  activeQuoteRecord: Record<string, unknown> | null;
  activeQuoteNumber: string | null;
}

export function marginKeyFor(quoteId: string | null, marginPctValue: number): string {
  return `${quoteId ?? "new"}|${Math.round(marginPctValue * 10) / 10}`;
}

/** Exported for tests — stable package id for approval, persist, and margin gate. */
export function resolveActiveQuotePackageId(input: {
  savedQuoteId?: string | null;
  savedResponseId?: string | null;
  existingQuoteId?: string | null;
  urlPackageId?: string | null;
  persistedId?: string | null;
}): string | null {
  const fromSave = input.savedQuoteId ?? input.savedResponseId ?? null;
  if (fromSave) return fromSave;
  const fromLoad = input.existingQuoteId ?? null;
  if (fromLoad) return fromLoad;
  const urlId = input.urlPackageId?.trim();
  if (urlId) return urlId;
  const persisted = input.persistedId?.trim();
  return persisted || null;
}

export function useQuoteBuilderSave({
  draft,
  setDraft,
  totals,
  allFinanceScenarios,
  winProbContext,
  persistedQuotePackageIdRef,
  existingQuote,
  urlPackageId,
  localDraftKey,
  userId,
  dealId,
  profile,
  setLastSavedAt,
  setAutoSaveState,
  setLocalPersistEnabled,
}: UseQuoteBuilderSaveInput): UseQuoteBuilderSaveResult {
  const queryClient = useQueryClient();
  const { marginPct } = totals;

  const saveMutation = useMutation({
    mutationFn: (): Promise<QuotePackageSaveResponse> => {
      const wp = computeWinProbability(draft, winProbContext);
      const snapshot = {
        score: wp.score,
        band: wp.band,
        rawScore: wp.rawScore,
        factors: wp.factors,
        marginBaselineMedianPct: winProbContext.marginBaselineMedianPct ?? null,
        weightsVersion: "v1",
        savedAt: new Date().toISOString(),
      };
      return saveQuotePackage(
        buildQuoteSavePayload(
          draft,
          totals,
          allFinanceScenarios,
          snapshot,
          {
            quotePackageId: resolveActiveQuotePackageId({
              existingQuoteId: typeof existingQuote?.id === "string" ? existingQuote.id : null,
              urlPackageId: urlPackageId ?? null,
              persistedId: persistedQuotePackageIdRef.current,
            }),
          },
        ),
      );
    },
    onSuccess: (result) => {
      const savedQuoteId =
        (result.quote as { id?: string } | undefined)?.id
        ?? (result as { id?: string }).id
        ?? null;
      if (savedQuoteId) persistedQuotePackageIdRef.current = savedQuoteId;
      const resolvedDealId =
        (result.quote as { deal_id?: string } | undefined)?.deal_id
        ?? (result as { deal_id?: string }).deal_id
        ?? draft.dealId
        ?? undefined;
      const nextStatus =
        (result.quote as { status?: string } | undefined)?.status
        ?? "draft";
      setDraft((current) => ({
        ...current,
        dealId: resolvedDealId ?? current.dealId,
        quoteStatus: nextStatus as QuoteWorkspaceDraft["quoteStatus"],
      }));
      setLastSavedAt(new Date().toISOString());
      setAutoSaveState("saved");
      if (localDraftKey) clearLocalDraft(localDraftKey);
      if (userId && resolvedDealId && resolvedDealId !== dealId) {
        clearLocalDraft(buildLocalDraftKey({ userId, dealId: resolvedDealId }));
      }
      setLocalPersistEnabled(false);
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "approval-case"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "saved-quote"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "list"] });
      if (result.warning || result.partial_error) {
        toast({
          title: "Quote saved with a sync warning",
          description: result.warning ?? result.partial_error ?? "Some quote details may need another save after refresh.",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Quote save failed",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const activeQuotePackageId = resolveActiveQuotePackageId({
    savedQuoteId: saveMutation.data?.quote?.id as string | undefined,
    savedResponseId: saveMutation.data?.id as string | undefined,
    existingQuoteId: typeof existingQuote?.id === "string" ? existingQuote.id : null,
    urlPackageId: urlPackageId ?? null,
    persistedId: persistedQuotePackageIdRef.current,
  });

  const activeQuoteRecord = useMemo(() => {
    const saved = saveMutation.data?.quote;
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? (saved as Record<string, unknown>)
      : existingQuote;
  }, [existingQuote, saveMutation.data?.quote]);

  const activeQuoteNumber = typeof activeQuoteRecord?.quote_number === "string"
    && activeQuoteRecord.quote_number.length > 0
    ? activeQuoteRecord.quote_number
    : null;

  const submitApprovalMutation = useMutation({
    mutationFn: async () => {
      let quotePackageId = activeQuotePackageId ?? persistedQuotePackageIdRef.current;
      if (!quotePackageId) {
        const saveResult = await saveMutation.mutateAsync();
        quotePackageId =
          (saveResult.quote?.id as string | undefined)
          ?? (saveResult as { id?: string }).id
          ?? null;
        if (!quotePackageId) {
          throw new Error("Couldn't save the quote — approval not submitted.");
        }
      }
      return submitQuoteForApproval(quotePackageId);
    },
    onSuccess: (result) => {
      setDraft((current) => ({
        ...current,
        quoteStatus:
          result.status === "approved" || result.status === "approved_with_conditions"
            ? result.status
            : "pending_approval",
      }));
      const casePackageId = persistedQuotePackageIdRef.current ?? activeQuotePackageId;
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "list"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "approval-case"] });
      if (casePackageId) {
        queryClient.invalidateQueries({ queryKey: ["quote-builder", "approval-case", casePackageId] });
      }
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "saved-quote"] });
    },
    onError: (error) => {
      toast({
        title: "Approval submission failed",
        description: error instanceof Error ? error.message : "Try saving the quote, then submit again.",
        variant: "destructive",
      });
    },
  });

  const [marginGateOpen, setMarginGateOpen] = useState(false);
  const [marginReasonCaptured, setMarginReasonCaptured] = useState<string | null>(null);
  useEffect(() => {
    setMarginReasonCaptured(null);
  }, [existingQuote?.id]);

  const handleSaveClick = useCallback(async () => {
    let thresholdPct: number | null = null;
    try {
      const { threshold } = await getApplicableThreshold(null);
      thresholdPct = threshold ? Number(threshold.min_margin_pct) : null;
    } catch (error) {
      console.warn("quote-builder threshold lookup failed; saving without margin gate", error);
    }
    const key = marginKeyFor(activeQuotePackageId, marginPct);
    if (isUnderThreshold(marginPct, thresholdPct) && marginReasonCaptured !== key) {
      setMarginGateOpen(true);
      return;
    }
    saveMutation.mutate();
  }, [
    activeQuotePackageId,
    marginPct,
    marginReasonCaptured,
    saveMutation.mutate,
  ]);

  const handleMarginReasonConfirm = useCallback(async (payload: {
    reason: string;
    thresholdPct: number;
    estimatedGapCents: number;
  }) => {
    setMarginGateOpen(false);
    try {
      const saveResult = await saveMutation.mutateAsync();
      const savedId = saveResult.quote?.id ?? saveResult.id;
      if (!savedId || !profile) return;
      await logMarginException({
        workspaceId: profile.active_workspace_id ?? "default",
        quotePackageId: savedId,
        brandId: null,
        quotedMarginPct: marginPct,
        thresholdMarginPct: payload.thresholdPct,
        estimatedGapCents: payload.estimatedGapCents,
        reason: payload.reason,
        repId: profile.id,
      });
      setMarginReasonCaptured(marginKeyFor(savedId, marginPct));
    } catch {
      // saveMutation.error path handles user-visible feedback.
    }
  }, [marginPct, profile, saveMutation.mutateAsync]);

  return {
    saveMutation,
    submitApprovalMutation,
    marginGateOpen,
    setMarginGateOpen,
    handleSaveClick,
    handleMarginReasonConfirm,
    activeQuotePackageId,
    activeQuoteRecord,
    activeQuoteNumber,
  };
}
