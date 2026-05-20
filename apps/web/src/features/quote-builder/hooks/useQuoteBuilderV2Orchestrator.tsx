import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import type { QuoteFinancingRequest, QuotePackageCatalogKind } from "../lib/quote-api";
import { performQuoteListAction } from "../lib/quote-api";
import { translateQuoteError } from "../lib/quote-error-messages";
import { toast } from "@/hooks/use-toast";
import {
  DEFAULT_QUOTE_MARGIN_FLOOR_PCT,
  type QuoteFinanceScenario,
  type QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import type { QuoteSendActionChannel } from "../lib/quote-workspace";
import { useAuth } from "@/hooks/useAuth";
import { useApprovalBypass } from "../hooks/useApprovalBypass";
import { useExistingQuoteLoad } from "../hooks/useExistingQuoteLoad";
import { useQuoteBuilderHandoffs } from "../hooks/useQuoteBuilderHandoffs";
import { useQuoteBuilderInboundFreightReset } from "../hooks/useQuoteBuilderInboundFreightReset";
import { useQuoteBuilderCrmHydration } from "../hooks/useQuoteBuilderCrmHydration";
import { useQuoteBuilderDefaultBranch } from "../hooks/useQuoteBuilderDefaultBranch";
import { useQuoteBuilderDetailsDefaults } from "../hooks/useQuoteBuilderDetailsDefaults";
import { useQuoteBuilderDocumentActions } from "../hooks/useQuoteBuilderDocumentActions";
import { useQuoteBuilderDocumentInvalidation } from "../hooks/useQuoteBuilderDocumentInvalidation";
import { useQuoteBuilderLocalDraft } from "../hooks/useQuoteBuilderLocalDraft";
import { useQuoteBuilderEquipmentSeed } from "../hooks/useQuoteBuilderEquipmentSeed";
import { useQuoteBuilderFinanceScenarioSync } from "../hooks/useQuoteBuilderFinanceScenarioSync";
import { useQuoteBuilderKeyboardShortcuts } from "../hooks/useQuoteBuilderKeyboardShortcuts";
import { useQuoteBuilderLocalDraftPersist } from "../hooks/useQuoteBuilderLocalDraftPersist";
import { useQuoteBuilderSave } from "../hooks/useQuoteBuilderSave";
import { useQuoteBuilderConfigLines } from "../hooks/useQuoteBuilderConfigLines";
import { useQuoteBuilderAiIntake } from "../hooks/useQuoteBuilderAiIntake";
import { useQuoteBuilderAvailability } from "../hooks/useQuoteBuilderAvailability";
import { useQuoteBuilderCatalogAdds } from "../hooks/useQuoteBuilderCatalogAdds";
import { useQuoteBuilderReadiness } from "../hooks/useQuoteBuilderReadiness";
import { useQuoteBuilderProspectIntake } from "../hooks/useQuoteBuilderProspectIntake";
import { QuoteBuilderV2PageView } from "../components/QuoteBuilderV2PageView";
import { buildQuoteBuilderPageShellProps } from "../lib/build-quote-builder-page-shell-props";
import { QuoteBuilderIntelligencePanelHost } from "../components/QuoteBuilderIntelligencePanelHost";
import { QUOTE_TAX_PROFILES } from "../lib/quote-tax-profiles";
import { useQuoteBuilderRecommendedMachine } from "../hooks/useQuoteBuilderRecommendedMachine";
import { useQuoteBuilderIntelligenceContext } from "../hooks/useQuoteBuilderIntelligenceContext";
import { useQuoteBuilderWizardChrome } from "../hooks/useQuoteBuilderWizardChrome";
import { useQuoteBuilderMiscPricingLine } from "../hooks/useQuoteBuilderMiscPricingLine";
import { useQuoteBuilderPricingLines } from "../hooks/useQuoteBuilderPricingLines";
import { useQuoteBuilderPrimaryAction } from "../hooks/useQuoteBuilderPrimaryAction";
import { useQuoteBuilderShareLink } from "../hooks/useQuoteBuilderShareLink";
import { useQuoteBuilderTaxSync } from "../hooks/useQuoteBuilderTaxSync";
import { useQuoteBuilderWizardPersist } from "../hooks/useQuoteBuilderWizardPersist";
import { useDraftAutosave } from "../hooks/useDraftAutosave";
import { useLiveMargin } from "../hooks/useLiveMargin";
import { usePdiAutofill } from "../hooks/usePdiAutofill";
import { isDraftEmpty } from "../lib/local-draft";
import { useActiveBranches, useBranchBySlug } from "@/hooks/useBranches";
import { useQuotePDF } from "../hooks/useQuotePDF";
import { useQuoteFinancingPreview } from "../hooks/useQuoteFinancingPreview";
import { useQuoteTaxPreview } from "../hooks/useQuoteTaxPreview";
import { buildCustomFinanceScenario } from "../lib/custom-finance";
import { getTradeValuationProposalSnapshot } from "../lib/point-shoot-trade-api";
import { buildTradeMarketContext } from "@/features/qrm/lib/trade-market-context";
import { buildTradeWalkaroundHref } from "@/features/qrm/lib/trade-walkaround";
import type { ScenarioSelection } from "../components/ConversationalDealEngine";
import {
  buildScenarioSelectionDraftPatch,
  type ScenarioSelectionSource,
} from "../lib/scenario-selection-draft";
import { wizardIndexForStep, type AutoSaveState, type Step } from "../wizard/wizard-types";
import { useQuoteBuilderOrchestratorStepRouterGroups } from "../hooks/useQuoteBuilderOrchestratorStepRouterGroups";
import { PRICING_ADDER_FIELDS } from "../lib/pricing-adder-fields";
import { getApplicableMarginFloor } from "@/features/admin/lib/pricing-discipline-api";
import {
  EMPTY_TRADE_CAPTURE,
  TRADE_CHECKLIST_ITEMS,
  type TradeCaptureDraft,
  type TradeChecklistKey,
} from "../lib/trade-checklist";
import {
  availabilityLabel,
  availabilityRequestCreatedAtForLine,
  availabilityRequestIdForLine,
  availabilityRequestLabel,
  availabilityStatusForLine,
  equipmentKeyForLine,
} from "../lib/quote-builder-page-helpers";


export function useQuoteBuilderV2Orchestrator() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const routeParams = useParams<{ quoteId?: string }>();
  // WAVE phase 1: Quote Builder now ALSO hosts at /sales/quotes/:quoteId
  // (path-param form). Path param wins when present; otherwise fall back
  // to the legacy ?package_id=... contract preserved via redirects.
  const packageId =
    routeParams.quoteId && routeParams.quoteId !== "new"
      ? routeParams.quoteId
      : searchParams.get("package_id") || "";
  const dealId = searchParams.get("deal_id") || searchParams.get("crm_deal_id") || "";
  const contactId = searchParams.get("contact_id") || searchParams.get("crm_contact_id") || "";
  const companyId = searchParams.get("company_id") || searchParams.get("crm_company_id") || "";
  const prospectConverted = searchParams.get("prospect_converted") === "1";
  const equipmentId = searchParams.get("equipment_id") || searchParams.get("crm_equipment_id") || "";
  const voiceSessionId = searchParams.get("voice_session_id") || "";
  const ironQuoteHandoffId = searchParams.get("iron_quote_intake_id") || "";
  const ironQuoteHandoffState = (location.state as { ironQuoteHandoff?: unknown } | null)?.ironQuoteHandoff;
  const [step, setStep] = useState<Step>("customer");
  const [reviewSendOpen, setReviewSendOpen] = useState(false);
  const [packageToolsOpen, setPackageToolsOpen] = useState(false);
  const [catalogBrowserOpen, setCatalogBrowserOpen] = useState(false);
  const [packageItemSearchOpen, setPackageItemSearchOpen] = useState(false);
  const [customLineTitle, setCustomLineTitle] = useState("");
  const [customLinePrice, setCustomLinePrice] = useState(0);
  const [miscChargeTitle, setMiscChargeTitle] = useState("");
  const [miscChargeAmount, setMiscChargeAmount] = useState(0);
  const [miscCreditTitle, setMiscCreditTitle] = useState("");
  const [miscCreditAmount, setMiscCreditAmount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>("idle");
  const [internalNotes, setInternalNotes] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [documentFallbackGeneratedAt, setDocumentFallbackGeneratedAt] = useState<string | null>(null);
  const [documentArtifact, setDocumentArtifact] = useState<{ id: string; storageBucket: string; storageKey: string; generatedAt: string } | null>(null);
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [deliveryActionMessage, setDeliveryActionMessage] = useState<string | null>(null);
  const [deliveryActionError, setDeliveryActionError] = useState<string | null>(null);
  const [deliveryActionBusy, setDeliveryActionBusy] = useState<QuoteSendActionChannel | null>(null);
  const lastAutoSaveSignatureRef = useRef<string>("");
  const documentDraftSignatureRef = useRef<string>("");
  const persistedQuotePackageIdRef = useRef<string | null>(packageId || null);
  const [customFinanceEnabled, setCustomFinanceEnabled] = useState(false);
  const [customFinanceRate, setCustomFinanceRate] = useState<number | null>(null);
  const [customFinanceTermMonths, setCustomFinanceTermMonths] = useState<number | null>(null);
  const [draft, setDraft] = useState<QuoteWorkspaceDraft>({
    dealId: dealId || undefined,
    contactId: contactId || undefined,
    companyId: companyId || undefined,
    entryMode: "ai_chat",
    branchSlug: "",
    recommendation: null,
    voiceSummary: null,
    equipment: [],
    attachments: [],
    tradeAllowance: 0,
    tradeValuationId: null,
    commercialDiscountType: "flat",
    commercialDiscountValue: 0,
    cashDown: 0,
    taxProfile: "standard",
    taxTotal: 0,
    amountFinanced: 0,
    selectedFinanceScenario: null,
    showFinanceComparisonOnCustomerCopy: true,
    pricingLines: [],
    postApprovalAction: "return_to_rep",
    wizardStep: 1,
    customerName: "",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
    quoteStatus: "draft",
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Track A / Epic #39: when the wizard step changes, snap the window to the top
  // so mobile operators see the new step title and first controls (not mid-page).
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step]);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiIntakeMessage, setAiIntakeMessage] = useState<string | null>(null);
  const [intakeRecorderOpen, setIntakeRecorderOpen] = useState(false);
  const [dealAssistantOpen, setDealAssistantOpen] = useState(false);
  const applyScenarioSelection = useCallback((
    selection: ScenarioSelection & { at?: string },
    source: ScenarioSelectionSource,
  ) => {
    setDealAssistantOpen(false);
    setDraft((current) => ({
      ...current,
      ...buildScenarioSelectionDraftPatch(current, selection, source),
    }));
    setStep("customer");
  }, [setDraft, setStep]);
  const [availableOptions, setAvailableOptions] = useState<Array<{ id: string; name: string; price: number }>>([]);
  const [availableOptionsLabel, setAvailableOptionsLabel] = useState<string | null>(null);
  const [configureTab, setConfigureTab] = useState<QuotePackageCatalogKind>("attachment");
  const [tradeCaptureOpen, setTradeCaptureOpen] = useState(false);
  const [activeTradeCaptureKey, setActiveTradeCaptureKey] = useState<TradeChecklistKey>("hourMeter");
  const [tradeCapture, setTradeCapture] = useState<TradeCaptureDraft>(EMPTY_TRADE_CAPTURE);
  const tradeChecklist = useMemo(
    () => Object.fromEntries(
      TRADE_CHECKLIST_ITEMS.map((item) => [item.key, tradeCapture[item.key].trim().length > 0]),
    ) as Record<TradeChecklistKey, boolean>,
    [tradeCapture],
  );
  const queryClient = useQueryClient();
  const handlePointShootTradeApply = useCallback((allowanceDollars: number, valuationId: string) => {
    setDraft((current) => ({
      ...current,
      tradeAllowance: allowanceDollars,
      tradeValuationId: valuationId,
    }));
    queryClient.invalidateQueries({ queryKey: ["quote-builder", "trade-valuation-proposal", valuationId] });
  }, [queryClient]);

  const branchesQ = useActiveBranches();
  const branches = branchesQ.data ?? [];
  const selectedBranchQuery = useBranchBySlug(draft.branchSlug || null);
  const selectedBranch = branches.find((branch) => branch.slug === draft.branchSlug)
    ?? selectedBranchQuery.data
    ?? undefined;
  const marginFloorQuery = useQuery({
    queryKey: ["quote-builder", "margin-floor", null],
    queryFn: () => getApplicableMarginFloor(null),
    staleTime: 60_000,
  });
  const marginFloorResolved = marginFloorQuery.isSuccess && marginFloorQuery.data?.floorPct != null;
  const marginFloorPct = marginFloorResolved ? marginFloorQuery.data!.floorPct : DEFAULT_QUOTE_MARGIN_FLOOR_PCT;
  const marginFloorSource = marginFloorResolved ? marginFloorQuery.data!.source : "fallback_default";
  const {
    equipmentTotal,
    attachmentTotal,
    internalCostLoadTotal,
    pricingLineTotal,
    taxableBasis,
    subtotal,
    discountTotal,
    discountedSubtotal,
    netTotal,
    taxTotal,
    customerTotal,
    cashDown,
    amountFinanced,
    dealerCost,
    marginAmount,
    marginPct,
    approvalState,
    packetReadiness,
  } = useLiveMargin(draft, { marginFloorPct });

  const { pricingLine, upsertPricingLine } = useQuoteBuilderPricingLines({
    pricingLines: draft.pricingLines,
    setDraft,
  });

  const { addConfigLine } = useQuoteBuilderConfigLines({ setDraft });

  const { addRecommendedMachine } = useQuoteBuilderRecommendedMachine({
    draftRef,
    setDraft,
    setStep,
    setAvailableOptions,
    setAvailableOptionsLabel,
  });

  const { addCatalogEquipment, addCatalogAttachment, addPackageCatalogItem } = useQuoteBuilderCatalogAdds({
    setDraft,
    setAvailableOptions,
    setAvailableOptionsLabel,
  });

  const { generateAndDownload: downloadPDF, generatePdfBlob, generating: pdfGenerating, error: pdfError } = useQuotePDF();
  const { profile } = useAuth();
  const { existingQuoteQuery, existingQuote } = useExistingQuoteLoad({
    packageId,
    dealId,
    companyId,
    persistedQuotePackageIdRef,
    setDraft,
    setStep,
  });

  useQuoteBuilderHandoffs({
    packageId,
    dealId,
    voiceSessionId,
    ironQuoteHandoffId,
    ironQuoteHandoffState,
    existingQuote,
    existingQuoteLoading: existingQuoteQuery.isLoading,
    existingQuoteFetching: existingQuoteQuery.isFetching,
    setDraft,
    setStep,
    setAiPrompt,
    setAiIntakeMessage,
    onVoiceHandoff: (handoff) => applyScenarioSelection(handoff, "voice_handoff"),
  });

  const {
    localDraftKey,
    localDraftHydrationComplete,
    localPersistEnabled,
    setLocalPersistEnabled,
  } = useQuoteBuilderLocalDraft({
    userId: profile?.id,
    dealId,
    contactId,
    draftDealId: draft.dealId,
    draftContactId: draft.contactId,
    ironQuoteHandoffId,
    existingQuote,
    existingQuoteLoading: existingQuoteQuery.isLoading,
    existingQuoteFetching: existingQuoteQuery.isFetching,
    setDraft,
  });

  useQuoteBuilderCrmHydration({
    prospectConverted,
    companyId,
    contactId,
    dealId,
    packageId,
    customerName: draft.customerName ?? "",
    customerCompany: draft.customerCompany ?? "",
    existingQuote,
    existingQuoteLoading: existingQuoteQuery.isLoading,
    existingQuoteFetching: existingQuoteQuery.isFetching,
    draftRef,
    setDraft,
    setStep,
  });

  useQuoteBuilderEquipmentSeed({
    equipmentId,
    packageId,
    dealId,
    setDraft,
    setAvailableOptions,
    setAvailableOptionsLabel,
  });

  const {
    userRoleQuery,
    factorVerdicts,
    shadowHistory,
    shadowCalibration,
    winProbContext,
  } = useQuoteBuilderIntelligenceContext(profile?.id, marginPct);

  const taxProfiles = QUOTE_TAX_PROFILES;

  useQuoteBuilderDefaultBranch({
    branchSlug: draft.branchSlug,
    branches,
    setDraft,
  });

  const financingInput = useMemo<QuoteFinancingRequest>(() => ({
    packageSubtotal: subtotal,
    discountTotal,
    tradeAllowance: draft.tradeAllowance,
    taxTotal,
    cashDown,
    amountFinanced,
    marginPct,
    manufacturer: draft.equipment[0]?.make,
  }), [
    subtotal,
    discountTotal,
    draft.tradeAllowance,
    taxTotal,
    cashDown,
    amountFinanced,
    marginPct,
    draft.equipment,
  ]);

  const financingPreviewQuery = useQuoteFinancingPreview(financingInput);
  const financeScenarios: QuoteFinanceScenario[] = financingPreviewQuery.data?.scenarios ?? [];
  const customFinanceScenario = useMemo(() => buildCustomFinanceScenario({
    enabled: customFinanceEnabled,
    amountFinanced,
    ratePct: customFinanceRate,
    termMonths: customFinanceTermMonths,
  }), [customFinanceEnabled, amountFinanced, customFinanceRate, customFinanceTermMonths]);
  const allFinanceScenarios = useMemo<QuoteFinanceScenario[]>(
    () => customFinanceScenario ? [customFinanceScenario, ...financeScenarios] : financeScenarios,
    [customFinanceScenario, financeScenarios],
  );
  const selectedFinanceScenario = useMemo(
    () => allFinanceScenarios.find((scenario) => scenario.label === draft.selectedFinanceScenario) ?? null,
    [allFinanceScenarios, draft.selectedFinanceScenario],
  );

  const taxPreviewQuery = useQuoteTaxPreview({
    dealId: draft.dealId,
    companyId: draft.companyId,
    branchSlug: draft.branchSlug || undefined,
    subtotal,
    discountTotal,
    tradeAllowance: draft.tradeAllowance,
    taxProfile: draft.taxProfile,
    deliveryState: draft.deliveryState ?? undefined,
    deliveryCounty: draft.deliveryCounty ?? undefined,
    taxOverrideAmount: draft.taxOverrideAmount ?? null,
    taxOverrideReason: draft.taxOverrideReason ?? null,
  });

  useQuoteBuilderFinanceScenarioSync({
    allFinanceScenarios,
    customFinanceScenario,
    selectedFinanceScenario: draft.selectedFinanceScenario,
    setDraft,
  });

  const {
    saveMutation,
    submitApprovalMutation,
    withdrawApprovalMutation,
    marginGateOpen,
    setMarginGateOpen,
    handleSaveClick,
    handleMarginReasonConfirm,
    activeQuotePackageId,
    activeQuoteRecord,
    activeQuoteNumber,
    lowMarginDraftReasonRequired,
    lowMarginDraftReasonMessage,
  } = useQuoteBuilderSave({
    draft,
    setDraft,
    totals: {
      equipmentTotal,
      attachmentTotal,
      subtotal,
      discountTotal,
      discountedSubtotal,
      netTotal,
      taxTotal,
      customerTotal,
      cashDown,
      amountFinanced,
      marginAmount,
      marginPct,
    },
    allFinanceScenarios,
    winProbContext,
    marginFloorPct,
    persistedQuotePackageIdRef,
    existingQuote,
    urlPackageId: packageId || null,
    localDraftKey,
    userId: profile?.id,
    dealId,
    profile,
    setLastSavedAt,
    setAutoSaveState,
    setLocalPersistEnabled,
  });

  const tradeValuationProposalQuery = useQuery({
    queryKey: ["quote-builder", "trade-valuation-proposal", draft.tradeValuationId],
    queryFn: () => getTradeValuationProposalSnapshot(draft.tradeValuationId!),
    enabled: Boolean(draft.tradeValuationId),
    staleTime: 60_000,
  });
  const tradeMarketContext = useMemo(() => buildTradeMarketContext({
    make: tradeValuationProposalQuery.data?.make,
    model: tradeValuationProposalQuery.data?.model,
    year: tradeValuationProposalQuery.data?.year,
    hours: tradeValuationProposalQuery.data?.hours,
    marketComps: tradeValuationProposalQuery.data?.marketComps,
    auctionValue: tradeValuationProposalQuery.data?.auctionValue,
    preliminaryValue: tradeValuationProposalQuery.data?.preliminaryValue,
    finalValue: tradeValuationProposalQuery.data?.finalValue,
  }), [tradeValuationProposalQuery.data]);
  const tradeWalkaroundHref = draft.dealId ? buildTradeWalkaroundHref(draft.dealId) : null;
  const activeQuoteUpdatedAt = typeof activeQuoteRecord?.updated_at === "string"
    ? activeQuoteRecord.updated_at
    : typeof activeQuoteRecord?.created_at === "string"
      ? activeQuoteRecord.created_at
      : null;
  const currentWizardStepNumber = wizardIndexForStep(step);
  const leaseQuotingEnabled = import.meta.env.VITE_FEATURE_LEASE_QUOTING === "true";

  useQuoteBuilderWizardPersist({
    activeQuotePackageId,
    step,
    currentWizardStepNumber,
    setDraft,
  });

  useQuoteBuilderDetailsDefaults({ step, setDraft });

  const handleQuoteStatusChange = useCallback((status: QuoteWorkspaceDraft["quoteStatus"]) => {
    setDraft((current) => ({ ...current, quoteStatus: status }));
  }, [setDraft]);

  const handleQuoteForProspect = useQuoteBuilderProspectIntake({ setDraft, setStep });

  const quoteStatus = draft.quoteStatus ?? "draft";
  // QEP rule: every quote requires owner approval (Ryan + Rylee).
  // canSubmit shows whenever the draft is complete enough to save —
  // Submit auto-saves first, so the rep can go straight from "done
  // editing" to "waiting on Ryan/Rylee" in one click. Hidden once the
  // case is already past draft (pending / approved / sent / accepted).
  const {
    approvalCase: activeApprovalCase,
    caseLoading: activeApprovalCaseLoading,
    refetchCase: refetchActiveApprovalCase,
    pending: approvalPending,
    bypassApprovedWithoutCase,
    canSend: approvalCaseCanSend,
    granted: approvalGranted,
    canSubmit: canSubmitForApproval,
  } = useApprovalBypass({
    quotePackageId: activeQuotePackageId,
    quoteStatus,
    draftHasBranch: Boolean(draft.branchSlug),
    draftReady: packetReadiness.draft.ready,
  });
  void approvalState.requiresManagerApproval; // retained in state; not used for gating

  const {
    manualTaxOverrideReady,
    taxResolved,
    taxResolutionBlocker,
    whyThisMachineRequired,
    whyThisMachineBlocker,
    approvalBlocker,
    customerFacingDocumentBlocker,
    displayedSavedLabel,
    financeMethodLabel,
    quoteTitle,
    quotePdfData,
    quoteMediaSnapshotLoading,
  } = useQuoteBuilderReadiness({
    draft,
    subtotal,
    equipmentTotal,
    attachmentTotal,
    pricingLineTotal,
    discountTotal,
    netTotal,
    taxTotal,
    customerTotal,
    cashDown,
    amountFinanced,
    marginPct,
    allFinanceScenarios,
    leaseQuotingEnabled,
    activeQuotePackageId,
    activeQuoteNumber,
    activeApprovalCaseLoading,
    bypassApprovedWithoutCase,
    activeApprovalCase,
    taxPreviewSuccess: taxPreviewQuery.isSuccess,
    taxPreviewError: taxPreviewQuery.isError,
    selectedBranch,
    tradeValuationSnapshot: tradeValuationProposalQuery.data,
    tradeValuationLoading: tradeValuationProposalQuery.isLoading,
    tradeValuationFetching: tradeValuationProposalQuery.isFetching,
    hasTradeValuationData: Boolean(tradeValuationProposalQuery.data),
    selectedFinanceScenarioLabel: selectedFinanceScenario?.label,
    lastSavedAt,
    activeQuoteUpdatedAt,
  });

  useQuoteBuilderTaxSync({
    branchSlug: draft.branchSlug,
    deliveryState: draft.deliveryState,
    taxOverrideAmount: draft.taxOverrideAmount,
    manualTaxOverrideReady,
    previewTotalTax: taxPreviewQuery.data?.total_tax,
    setDraft,
  });

  const draftSaveSignature = useMemo(() => JSON.stringify({
    draft,
    computed: {
      equipmentTotal,
      attachmentTotal,
      subtotal,
      discountTotal,
      tradeAllowance: draft.tradeAllowance,
      taxTotal,
      customerTotal,
      cashDown,
      amountFinanced,
      marginPct,
    },
  }), [
    draft,
    equipmentTotal,
    attachmentTotal,
    subtotal,
    discountTotal,
    taxTotal,
    customerTotal,
    cashDown,
    amountFinanced,
    marginPct,
  ]);

  const {
    handleDownloadPdf,
    handleGenerateFallbackDocument,
    handleQuoteSendAction,
  } = useQuoteBuilderDocumentActions({
    customerFacingDocumentBlocker,
    quoteMediaSnapshotLoading,
    quotePdfData,
    downloadPDF,
    generatePdfBlob,
    activeQuotePackageId,
    draft,
    setDraft,
    draftSaveSignature,
    lastAutoSaveSignatureRef,
    documentDraftSignatureRef,
    documentArtifact,
    documentFallbackGeneratedAt,
    setDocumentFallbackGeneratedAt,
    setDocumentArtifact,
    setDocumentActionError,
    setDeliveryActionMessage,
    setDeliveryActionError,
    setDeliveryActionBusy,
    packetReadinessDraftReady: packetReadiness.draft.ready,
    saveMutation,
    refetchActiveApprovalCase: refetchActiveApprovalCase,
    bypassApprovedWithoutCase,
    approvalCaseCanSend,
    taxResolved,
    whyThisMachineRequired,
  });

  const handleVersionedEmailSend = useCallback(async () => {
    const result = await handleQuoteSendAction("email");
    if (result.ok && activeQuotePackageId) {
      await queryClient.invalidateQueries({ queryKey: ["quote-builder", "quote-pdf-versions", activeQuotePackageId] });
    }
    return result;
  }, [activeQuotePackageId, handleQuoteSendAction, queryClient]);

  const { handleIssueShareLink } = useQuoteBuilderShareLink({
    activeQuotePackageId,
    setShareUrl,
    setShareBusy,
    setShareError,
  });

  const handlePrimaryAction = useQuoteBuilderPrimaryAction({
    quoteStatus,
    currentStep: step,
    approvalCaseCanSend,
    sendReady: packetReadiness.send.ready,
    canSubmitForApproval,
    requiresApprovalJustification: !marginFloorResolved || approvalState.requiresManagerApproval,
    onSave: handleSaveClick,
    onSubmitApproval: () => submitApprovalMutation.mutate(),
    setStep,
  });

  useDraftAutosave({
    enabled: localDraftHydrationComplete,
    draftReady: packetReadiness.draft.ready,
    draftIsEmpty: isDraftEmpty(draft),
    draftSignature: draftSaveSignature,
    signatureRef: lastAutoSaveSignatureRef,
    isPaused: saveMutation.isPending || submitApprovalMutation.isPending,
    pauseReason: lowMarginDraftReasonRequired ? "low_margin_reason_required" : null,
    save: () => saveMutation.mutateAsync({ saveMode: "autosave" }),
    setAutoSaveState,
  });

  useQuoteBuilderDocumentInvalidation({
    documentFallbackGeneratedAt,
    draftSaveSignature,
    documentDraftSignatureRef,
    setDocumentFallbackGeneratedAt,
    setDocumentArtifact,
  });

  useQuoteBuilderLocalDraftPersist({
    draftSaveSignature,
    localDraftHydrationComplete,
    localDraftKey,
    localPersistEnabled,
    draftRef,
  });

  useQuoteBuilderKeyboardShortcuts({
    draftReady: packetReadiness.draft.ready,
    savePending: saveMutation.isPending,
    onSave: handleSaveClick,
  });

  const { voiceMutation, aiIntakeMutation, onVoiceRecorded, onBuildWithAi } = useQuoteBuilderAiIntake({
    draftRef,
    setDraft,
    setStep,
    setAiIntakeMessage,
    setPackageToolsOpen,
    setCatalogBrowserOpen,
  });

  const handleScenarioSelection = (selection: ScenarioSelection) => {
    applyScenarioSelection(selection, "deal_assistant");
  };

  const tradeChecklistComplete = Object.values(tradeChecklist).every(Boolean);

  const {
    liveAvailabilityRequestForLine,
    liveAvailabilityStatusForLine,
    markAvailabilityConfirmationRequested,
    markAllAvailabilityConfirmationRequested,
    availabilityRequestMutation,
    hasCustomer,
    sourceRequiredAwaitingConfirmation,
    sourceRequiredUnavailable,
    inboundFreightEligible,
    equipmentCanContinue,
    tradeManagerApprovalRequired,
    signalsReady,
  } = useQuoteBuilderAvailability({
    activeQuotePackageId,
    draft,
    setDraft,
    netTotal,
    tradeChecklistComplete,
  });

  const firstEquipment = draft.equipment[0];
  const activeWorkspaceId = profile?.active_workspace_id ?? null;
  const pdiAutofillField = PRICING_ADDER_FIELDS.find((field) => field.id === "pdi");
  const pdiAutofillCurrentAmount = pdiAutofillField ? (pricingLine(pdiAutofillField)?.unitPrice ?? 0) : 0;
  usePdiAutofill({
    workspaceId: activeWorkspaceId,
    make: firstEquipment?.make,
    model: firstEquipment?.model,
    currentPdiAmount: pdiAutofillCurrentAmount,
    onAutofill: ({ amount, sampleCount }) => {
      if (!pdiAutofillField) return;
      const existing = pricingLine(pdiAutofillField);
      upsertPricingLine(pdiAutofillField, amount, {
        metadata: {
          ...(existing?.metadata ?? {}),
          pdi_source: "rolling_average_by_model",
          pdi_sample_count: sampleCount,
        },
      });
    },
  });

  useQuoteBuilderInboundFreightReset({
    inboundFreightEligible,
    pricingLines: draft.pricingLines,
    pricingLine,
    upsertPricingLine,
  });

  const handleAddMiscPricingLine = useQuoteBuilderMiscPricingLine({
    chargeTitle: miscChargeTitle,
    chargeAmount: miscChargeAmount,
    creditTitle: miscCreditTitle,
    creditAmount: miscCreditAmount,
    setMiscChargeTitle,
    setMiscChargeAmount,
    setMiscCreditTitle,
    setMiscCreditAmount,
    upsertPricingLine,
  });

  const discountLine = pricingLine("discount");

  const documentReady = Boolean(documentFallbackGeneratedAt);
  const documentPersistenceLabel = documentArtifact
    ? "Stored customer PDF artifact"
    : documentFallbackGeneratedAt
      ? "Printable fallback generated"
      : "Not generated";
  const {
    primaryActionLabel,
    primaryActionDisabled,
    previousWizardStep,
    nextWizardStep,
    nextWizardLabel,
    wizardNextDisabled,
    wizardNextHelp,
    wizardMaxStepIndex0,
    wizardPricingJumpAllowed,
    previewReadiness,
    emailReadiness,
    textReadiness,
    textQuoteEnabled,
    wizardStateValue,
  } = useQuoteBuilderWizardChrome({
    step,
    setStep,
    draft,
    setDraft,
    activeWorkspaceId,
    activeQuotePackageId,
    autoSaveState,
    setAutoSaveState,
    lastSavedAt,
    setLastSavedAt,
    hasCustomer,
    equipmentCanContinue,
    documentReady,
    signalsReady,
    marginPct,
    marginAmount,
    quoteStatus,
    savePending: saveMutation.isPending,
    submitApprovalPending: submitApprovalMutation.isPending,
    approvalCaseCanSend,
    sendReady: packetReadiness.send.ready,
    canSubmitForApproval,
    draftReady: packetReadiness.draft.ready,
    taxResolved,
    whyThisMachineRequired,
    whyThisMachineConfirmed: draft.whyThisMachineConfirmed === true,
    textQuoteEnabled: import.meta.env.VITE_FEATURE_QRM_TEXT_QUOTE === "true",
  });

  const intelligencePanel = (
    <QuoteBuilderIntelligencePanelHost
      draft={draft}
      financingInput={financingInput}
      equipmentMake={firstEquipment?.make}
      equipmentModel={firstEquipment?.model}
      userRole={userRoleQuery.data ?? null}
      onSelectPrimary={() => {
        if (!draft.recommendation?.machine) return;
        void addRecommendedMachine(draft.recommendation.machine);
      }}
      onSelectAlternative={draft.recommendation?.alternative?.machine ? () => {
        void addRecommendedMachine(draft.recommendation!.alternative!.machine);
      } : undefined}
      onBrowseCatalog={() => {
        setStep("equipment");
        setPackageToolsOpen(true);
        setCatalogBrowserOpen(true);
      }}
    />
  );

    const stepRouterProps = useQuoteBuilderOrchestratorStepRouterGroups({
    markAllAvailabilityConfirmationRequested,
    markAvailabilityConfirmationRequested,
    availabilityRequestCreatedAtForLine,
    sourceRequiredAwaitingConfirmation,
    liveAvailabilityRequestForLine,
    handleGenerateFallbackDocument,
    liveAvailabilityStatusForLine,
    customerFacingDocumentBlocker,
    availabilityRequestIdForLine,
    tradeManagerApprovalRequired,
    availabilityRequestMutation,
    tradeValuationProposalQuery,
    documentFallbackGeneratedAt,
    handlePointShootTradeApply,
    availabilityStatusForLine,
    sourceRequiredUnavailable,
    bypassApprovedWithoutCase,
    quoteMediaSnapshotLoading,
    setAvailableOptionsLabel,
    availabilityRequestLabel,
    setPackageItemSearchOpen,
    setActiveTradeCaptureKey,
    handleAddMiscPricingLine,
    documentPersistenceLabel,
    handleQuoteStatusChange,
    inboundFreightEligible,
    submitApprovalMutation,
    withdrawApprovalMutation,
    whyThisMachineRequired,
    setIntakeRecorderOpen,
    availableOptionsLabel,
    internalCostLoadTotal,
    financingPreviewQuery,
    whyThisMachineBlocker,
    deliveryActionMessage,
    handleQuoteSendAction,
    handleVersionedEmailSend,
    equipmentCanContinue,
    activeQuotePackageId,
    canSubmitForApproval,
    taxResolutionBlocker,
    setAvailableOptions,
    equipmentKeyForLine,
    setTradeCaptureOpen,
    setMiscChargeAmount,
    setMiscCreditAmount,
    allFinanceScenarios,
    leaseQuotingEnabled,
    approvalCaseCanSend,
    documentActionError,
    deliveryActionError,
    intakeRecorderOpen,
    setCustomLineTitle,
    setCustomLinePrice,
    setMiscChargeTitle,
    setMiscCreditTitle,
    financeMethodLabel,
    deliveryActionBusy,
    shadowCalibration,
    intelligencePanel,
    availabilityLabel,
    upsertPricingLine,
    aiIntakeMutation,
    availableOptions,
    pricingLineTotal,
    miscChargeAmount,
    miscCreditAmount,
    documentArtifact,
    previewReadiness,
    textQuoteEnabled,
    onVoiceRecorded,
    aiIntakeMessage,
    setConfigureTab,
    customLineTitle,
    customLinePrice,
    attachmentTotal,
    miscChargeTitle,
    miscCreditTitle,
    taxPreviewQuery,
    packetReadiness,
    approvalPending,
    approvalGranted,
    approvalBlocker,
    handleSaveClick,
    winProbContext,
    factorVerdicts,
    tradeChecklist,
    equipmentTotal,
    selectedBranch,
    amountFinanced,
    emailReadiness,
    voiceMutation,
    onBuildWithAi,
    shadowHistory,
    addConfigLine,
    discountTotal,
    customerTotal,
    approvalState,
    userRoleQuery,
    pdfGenerating,
    documentReady,
    textReadiness,
    configureTab,
    tradeCapture,
    taxableBasis,
    marginAmount,
    marginFloorPct,
    marginFloorResolved,
    discountLine,
    saveMutation,
    setAiPrompt,
    pricingLine,
    taxProfiles,
    quoteStatus,
    taxResolved,
    dealerCost,
    quoteTitle,
    marginPct,
    aiPrompt,
    subtotal,
    taxTotal,
    netTotal,
    cashDown,
    draft,
    currentUserId: profile?.id ?? null,
  });

  return (
    <QuoteBuilderV2PageView
      wizardStateValue={wizardStateValue}
      shellProps={buildQuoteBuilderPageShellProps({
        quoteTitle,
        quoteStatus: quoteStatus ?? "draft",
        autoSaveState,
        displayedSavedLabel,
        packetReadiness,
        customerTotal,
        financeMethodLabel,
        primaryActionLabel,
        primaryActionDisabled,
        primaryActionPending: saveMutation.isPending || submitApprovalMutation.isPending,
        primaryActionShowsSendIcon: approvalCaseCanSend && packetReadiness.send.ready,
        onPrimaryAction: handlePrimaryAction,
        draft,
        step,
        dealAssistantOpen,
        onDealAssistantOpenChange: setDealAssistantOpen,
        activeQuotePackageId,
        activeQuoteNumber,
        activeQuoteUpdatedAt,
        existingQuoteLoadError: existingQuoteQuery.isError
          ? (existingQuoteQuery.error instanceof Error ? existingQuoteQuery.error.message : "Unable to load the saved quote.")
          : null,
        existingQuoteEditingMessage: !existingQuoteQuery.isError && existingQuote
          ? `Editing saved quote${typeof existingQuote.quote_number === "string" && existingQuote.quote_number ? ` ${existingQuote.quote_number}` : ""}. Update any step below, then save to keep working in the same quote.`
          : null,
        draftSavePausedMessage: lowMarginDraftReasonMessage,
        currentWizardStepNumber,
        signalsReady,
        marginPct,
        marginAmount,
        marginFloorPct,
        marginFloorSource,
        wizardPricingJumpAllowed,
        branches,
        wizardNextHelp,
        previousWizardStep,
        nextWizardStep,
        wizardNextDisabled,
        nextWizardLabel,
        hasCustomer,
        onQuoteForProspect: handleQuoteForProspect,
        wizardMaxStepIndex0,
        equipmentTotal,
        attachmentTotal,
        subtotal,
        netTotal,
        marginGateOpen,
        onMarginGateOpenChange: setMarginGateOpen,
        onMarginReasonConfirm: (payload) => { void handleMarginReasonConfirm(payload); },
        pdfError,
        saveSuccess: saveMutation.isSuccess,
        saveErrorMessage: saveMutation.isError
          ? translateQuoteError(saveMutation.error ?? "Failed to save the quote.")
          : null,
        submitApprovalErrorMessage: submitApprovalMutation.isError
          ? translateQuoteError(submitApprovalMutation.error ?? "Failed to submit the quote for approval.")
          : null,
        onRecoveryAction: (kind: "goto_customer_step" | "discard_and_restart") => {
          if (kind === "goto_customer_step") {
            setStep("customer");
            // Clear the save error so the banner doesn't linger after the
            // rep takes action — they'll see a fresh save attempt on the
            // next state change.
            saveMutation.reset();
            submitApprovalMutation.reset();
            return;
          }
          if (kind === "discard_and_restart") {
            const proceed = window.confirm(
              "Discard this draft and start a new quote? This cannot be undone.",
            );
            if (!proceed) return;
            // Hard reload to /sales/quotes/new — React-Router SPA
            // navigation between /quotes/:quoteId and /quotes/new keeps
            // the same component mounted, so the previous draft's React
            // state (including any archived customer reference) leaks
            // into the "new" quote. window.location.assign forces a full
            // remount with truly empty state.
            const restartUrl = "/sales/quotes/new";
            if (!activeQuotePackageId) {
              window.location.assign(restartUrl);
              return;
            }
            performQuoteListAction({
              quotePackageId: activeQuotePackageId,
              action: "discard",
            })
              .then(() => {
                window.location.assign(restartUrl);
              })
              .catch((error) => {
                const copy = translateQuoteError(error);
                toast({
                  title: "Couldn't discard the draft",
                  description: copy.description,
                  variant: "destructive",
                });
              });
          }
        },
        intelligencePanel,
        tradeMarketContext,
        tradeMarketContextLoading: tradeValuationProposalQuery.isLoading || tradeValuationProposalQuery.isFetching,
        tradeWalkaroundHref,
        overlays: {
          dealAssistantOpen,
          onDealAssistantOpenChange: setDealAssistantOpen,
          onScenarioSelect: handleScenarioSelection,
          activeQuotePackageId,
          tradeCaptureOpen,
          onTradeCaptureOpenChange: setTradeCaptureOpen,
          activeTradeCaptureKey,
          onActiveTradeCaptureKeyChange: setActiveTradeCaptureKey,
          tradeCapture,
          setTradeCapture,
          tradeChecklist,
          packageItemSearchOpen,
          onPackageItemSearchOpenChange: setPackageItemSearchOpen,
          configureTab,
          availableOptions,
          availableOptionsLabel,
          onAddPackageCatalogItem: addPackageCatalogItem,
          catalogBrowserOpen,
          onCatalogBrowserOpenChange: setCatalogBrowserOpen,
          onAddCatalogEquipment: addCatalogEquipment,
          onAddCatalogAttachment: addCatalogAttachment,
          reviewSendOpen,
          onReviewSendOpenChange: setReviewSendOpen,
          customerTotal,
          financeMethodLabel,
          pdfGenerating,
          pdfError,
          onDownloadPdf: handleDownloadPdf,
          shareBusy,
          shareUrl,
          shareError,
          onIssueShareLink: handleIssueShareLink,
          internalNotes,
          setInternalNotes,
          packetReadiness,
          approvalGranted,
          requiresManagerApproval: approvalState.requiresManagerApproval,
          approvalDetail: approvalState.reason ?? "",
          onSendQuote: handleVersionedEmailSend,
        },
      })}
      stepRouterProps={stepRouterProps}
    />
  );
}

