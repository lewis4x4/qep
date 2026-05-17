import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Mic,
  FileText,
  ArrowRight,
  MapPin,
  ChevronDown,
  ChevronRight,
  DollarSign,
  PackagePlus,
  Sparkles,
  X,
} from "lucide-react";
import { CustomerIntelPanel } from "../components/CustomerIntelPanel";
import { CustomerSection } from "../components/CustomerSection";
import { PointShootTradeCard } from "../components/PointShootTradeCard";
import { TradeInInputCard } from "../components/TradeInInputCard";
import { WinProbabilityStrip } from "../components/WinProbabilityStrip";
import { getMarginBaseline } from "../lib/coach-api";
import {
  computeRetrospectiveShadows,
  computeShadowAgreementSummary,
} from "../lib/retrospective-shadow";
import { IntelligencePanel } from "../components/IntelligencePanel";
import { QuoteBuilderOverlays } from "../components/QuoteBuilderOverlays";
import { QuoteBuilderStatusBanners } from "../components/QuoteBuilderStatusBanners";
import { FinancingCalculator } from "../components/FinancingCalculator";
import { DealCoachSidebar } from "../components/DealCoachSidebar";
import { QuoteReviewWorkflowPanels } from "../components/QuoteReviewWorkflowPanels";
import { QuoteBuilderStickyBar } from "../components/QuoteBuilderStickyBar";
import { TaxBreakdown } from "../components/TaxBreakdown";
import { MarginFloorGate } from "../components/MarginFloorGate";
import { useAuth } from "@/hooks/useAuth";
import { MarginCheckBanner } from "../components/MarginCheckBanner";
import { TradeInSection } from "../components/TradeInSection";
import {
  getAiEquipmentRecommendation,
  getClosedDealsAudit,
  getFactorVerdicts,
  listQuoteAvailabilityRequests,
  requestQuoteAvailability,
  searchCatalog,
  type QuoteAvailabilityRequest,
  type QuotePackageCatalogItem,
  type QuotePackageCatalogKind,
  type QuoteFinancingRequest,
} from "../lib/quote-api";
import {
  computeQuoteSendActionReadiness,
  isQuoteWhyThisMachineConfirmationRequired,
  isTaxProfileExempt,
  type QuoteSendActionChannel,
} from "../lib/quote-workspace";
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
import { useQuoteBuilderCatalogActions } from "../hooks/useQuoteBuilderCatalogActions";
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
import {
  applyEquipmentOverridePrice,
  equipmentSystemBasePrice,
} from "../lib/equipment-override-price";
import { isDraftEmpty } from "../lib/local-draft";
import { useActiveBranches, useBranchBySlug } from "@/hooks/useBranches";
import { useQuotePDF } from "../hooks/useQuotePDF";
import { useQuoteFinancingPreview } from "../hooks/useQuoteFinancingPreview";
import { useQuoteTaxPreview } from "../hooks/useQuoteTaxPreview";
import { buildCustomFinanceScenario } from "../lib/custom-finance";
import { resolveApprovalBlockerMessage } from "../lib/quote-builder-approval-blocker";
import { buildQuoteProposalData } from "../lib/quote-proposal-data";
import { getTradeValuationProposalSnapshot } from "../lib/point-shoot-trade-api";
import { buildQuotePdfBranch } from "../lib/quote-builder-page-normalizers";
import { AskIronAdvisorButton } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { VoiceRecorder } from "@/features/voice-qrm/components/VoiceRecorder";
import { submitVoiceToQrm } from "@/features/voice-qrm/lib/voice-qrm-api";
import { toast } from "@/hooks/use-toast";
import { DealAssistantTrigger, type ScenarioSelection } from "../components/ConversationalDealEngine";
import {
  buildScenarioSelectionDraftPatch,
  type ScenarioSelectionSource,
} from "../lib/scenario-selection-draft";
import type {
  QuoteFinanceScenario,
  QuoteLineItemDraft,
  QuoteTaxProfile,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";
import {
  STEP_LABELS,
  WIZARD_STEP_IDS,
  isWizardStepId,
  wizardIndexForStep,
  type AutoSaveState,
  type Step,
} from "../wizard/wizard-types";
import {
  WizardStateProvider,
  type WizardStateValue,
} from "../wizard/WizardStateProvider";
import { STEP_STORAGE_PREFIX } from "../wizard/wizard-storage";
import { WizardShell } from "../wizard/WizardShell";
import { QuoteWizardStepRouter } from "../wizard/QuoteWizardStepRouter";
import {
  canJumpToWizardIndex,
  findWizardStepIndex,
  nextWizardStep as resolveNextWizardStep,
  previousWizardStep as resolvePreviousWizardStep,
  wizardMaxStepIndex0FromDraft,
  wizardReachableMaxIndex0,
} from "../wizard/wizard-navigation";
import {
  dateInputValue,
  dateTimeInputValue,
  isoFromDateInput,
  isoFromDateTimeInput,
  shortDateTime,
} from "../lib/quote-date-input";
import { PRICING_ADDER_FIELDS } from "../lib/pricing-adder-fields";
import { QuoteWorkspaceLineRow } from "../components/QuoteWorkspaceLineRow";
import {
  EMPTY_TRADE_CAPTURE,
  TRADE_CHECKLIST_ITEMS,
  type TradeCaptureDraft,
  type TradeChecklistKey,
} from "../lib/trade-checklist";
import {
  availabilityClientLineKey,
  availabilityLabel,
  availabilityRequestCreatedAtForLine,
  availabilityRequestIdForLine,
  availabilityRequestLabel,
  availabilityRequestStatusForLine,
  availabilityStatusForLine,
  buildEquipmentLine,
  draftHasCustomer,
  equipmentKeyForLine,
  isQuoteApprovedForDistribution,
  metadataForCatalogEntry,
  metadataString,
  type CatalogAttachmentMatch,
  type CatalogEntryMatch,
} from "../lib/quote-builder-page-helpers";

export { isQuoteApprovedForDistribution } from "../lib/quote-builder-page-helpers";

export function QuoteBuilderV2Page() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const packageId = searchParams.get("package_id") || "";
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
  const [tradeExpanded, setTradeExpanded] = useState(false);
  const [termsExpanded, setTermsExpanded] = useState(false);
  const [digitalTwinExpanded, setDigitalTwinExpanded] = useState(false);
  const [marginWaterfallExpanded, setMarginWaterfallExpanded] = useState(false);
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
  } = useLiveMargin(draft);

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

  const { addCatalogEquipment, addCatalogAttachment, addPackageCatalogItem } = useQuoteBuilderCatalogActions({
    setDraft,
    setAvailableOptions,
    setAvailableOptionsLabel,
  });

  const { generateAndDownload: downloadPDF, generating: pdfGenerating, error: pdfError } = useQuotePDF();
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

  const taxProfiles: Array<{ value: QuoteTaxProfile; label: string; detail: string }> = [
    { value: "standard", label: "Standard taxable", detail: "Calculate estimated sales tax normally." },
    { value: "agriculture_exempt", label: "Agriculture exempt", detail: "Use when the quoted application is agricultural." },
    { value: "fire_mitigation_exempt", label: "Fire mitigation exempt", detail: "Use when the quoted application is fire suppression or mitigation." },
    { value: "government_exempt", label: "Government exempt", detail: "Use for exempt public-sector entities." },
    { value: "resale_exempt", label: "Resale exempt", detail: "Use when the customer is buying for resale." },
  ];

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

  const manualTaxOverrideReady = draft.taxOverrideAmount != null && Boolean(draft.taxOverrideReason?.trim());
  const taxPreviewRequiresSuccessfulCalculation =
    !isTaxProfileExempt(draft.taxProfile)
    && Boolean(draft.branchSlug || draft.deliveryState)
    && subtotal > 0
    && !manualTaxOverrideReady;
  const taxResolved = !taxPreviewRequiresSuccessfulCalculation || taxPreviewQuery.isSuccess;
  const taxResolutionBlocker = taxResolved
    ? null
    : taxPreviewQuery.isError
      ? "Tax preview failed. Resolve the jurisdiction or enter a manual tax override with a reason before customer-facing document/send."
      : "Tax preview must complete before customer-facing document/send.";

  useQuoteBuilderTaxSync({
    branchSlug: draft.branchSlug,
    deliveryState: draft.deliveryState,
    taxOverrideAmount: draft.taxOverrideAmount,
    manualTaxOverrideReady,
    previewTotalTax: taxPreviewQuery.data?.total_tax,
    setDraft,
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
    marginGateOpen,
    setMarginGateOpen,
    handleSaveClick,
    handleMarginReasonConfirm,
    activeQuotePackageId,
    activeQuoteRecord,
    activeQuoteNumber,
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
  const activeQuoteUpdatedAt = typeof activeQuoteRecord?.updated_at === "string"
    ? activeQuoteRecord.updated_at
    : typeof activeQuoteRecord?.created_at === "string"
      ? activeQuoteRecord.created_at
      : null;
  const currentWizardStepNumber = wizardIndexForStep(step);

  useQuoteBuilderWizardPersist({
    activeQuotePackageId,
    step,
    currentWizardStepNumber,
    setDraft,
  });

  useQuoteBuilderDetailsDefaults({ step, setDraft });

  const handleQuoteStatusChange = useCallback((status: QuoteWorkspaceDraft["quoteStatus"]) => {
    setDraft((current) => ({ ...current, quoteStatus: status }));
  }, []);

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
  const displayedSavedAt = lastSavedAt ?? activeQuoteUpdatedAt;
  const displayedSavedLabel = shortDateTime(displayedSavedAt);
  const financeMethodLabel =
    selectedFinanceScenario?.label
    ?? draft.selectedFinanceScenario
    ?? (amountFinanced > 0 ? "Cash / TBD" : "Cash");
  const quoteTitle =
    activeQuoteNumber
    ?? (activeQuotePackageId ? `Quote ${activeQuotePackageId.slice(0, 8)}` : "New quote");
  const quotePdfData = useMemo(() => buildQuoteProposalData({
    draft,
    computed: {
      equipmentTotal,
      attachmentTotal,
      pricingLineTotal,
      subtotal,
      discountTotal,
      netTotal,
      taxTotal,
      customerTotal,
      cashDown,
      amountFinanced,
    },
    financeScenarios: allFinanceScenarios,
    quoteNumber: activeQuoteNumber,
    preparedBy: "QEP Sales Team",
    preparedDate: new Date().toLocaleDateString(),
    branch: buildQuotePdfBranch(selectedBranch),
    tradeValuation: tradeValuationProposalQuery.data ?? null,
  }), [
    activeQuoteNumber,
    allFinanceScenarios,
    amountFinanced,
    attachmentTotal,
    cashDown,
    customerTotal,
    discountTotal,
    draft,
    equipmentTotal,
    netTotal,
    pricingLineTotal,
    selectedBranch,
    subtotal,
    taxTotal,
    tradeValuationProposalQuery.data,
  ]);
  const quoteMediaSnapshotLoading =
    Boolean(draft.tradeValuationId)
    && (tradeValuationProposalQuery.isLoading || tradeValuationProposalQuery.isFetching)
    && !tradeValuationProposalQuery.data;
  const whyThisMachineRequired = isQuoteWhyThisMachineConfirmationRequired(draft);
  const whyThisMachineBlocker = whyThisMachineRequired && draft.whyThisMachineConfirmed !== true
    ? "Confirm the Why this machine narrative before customer-facing document/send."
    : null;
  const approvalBlocker = resolveApprovalBlockerMessage({
    activeQuotePackageId,
    activeApprovalCaseLoading,
    bypassApprovedWithoutCase,
    activeApprovalCase,
  });
  const customerFacingDocumentBlocker = approvalBlocker ?? taxResolutionBlocker ?? whyThisMachineBlocker;
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

  const { handleIssueShareLink } = useQuoteBuilderShareLink({
    activeQuotePackageId,
    setShareUrl,
    setShareBusy,
    setShareError,
  });

  const handlePrimaryAction = useQuoteBuilderPrimaryAction({
    quoteStatus,
    approvalCaseCanSend,
    sendReady: packetReadiness.send.ready,
    canSubmitForApproval,
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
    save: saveMutation.mutateAsync,
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
  const leaseQuotingEnabled = import.meta.env.VITE_FEATURE_LEASE_QUOTING === "true";

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
    wizardReachableMaxIndex0Value,
    wizardPricingJumpAllowed,
    handleQuoteForProspect,
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
    <IntelligencePanel
      recommendation={draft.recommendation}
      voiceSummary={draft.voiceSummary}
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
      financingInput={financingInput}
      equipmentMake={firstEquipment?.make}
      userRole={userRoleQuery.data ?? null}
      equipmentModel={firstEquipment?.model}
    />
  );

  return (
    <WizardStateProvider value={wizardStateValue}>
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-2 sm:px-6 lg:px-8">
      <QuoteBuilderStickyBar
        quoteTitle={quoteTitle}
        quoteStatus={quoteStatus}
        autoSaveState={autoSaveState}
        displayedSavedLabel={displayedSavedLabel}
        packetReadiness={packetReadiness}
        customerTotal={customerTotal}
        financeMethodLabel={financeMethodLabel}
        primaryActionLabel={primaryActionLabel}
        primaryActionDisabled={primaryActionDisabled}
        primaryActionPending={saveMutation.isPending || submitApprovalMutation.isPending}
        primaryActionShowsSendIcon={approvalCaseCanSend && packetReadiness.send.ready}
        onPrimaryAction={handlePrimaryAction}
      />

        <div className="flex w-full gap-6">
      {/* Left column — wizard */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Quote Builder</h1>
          <p className="text-sm text-muted-foreground">
            Build quotes with a single typed+mic intake flow. Zero-blocking and commercial-grade.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DealAssistantTrigger
            onClick={() => setDealAssistantOpen(true)}
            active={dealAssistantOpen}
          />
          <AskIronAdvisorButton contextType="quote" contextId={draft.dealId || undefined} variant="inline" />
        </div>
        </div>

        {activeQuotePackageId && (
          <Card className="border-qep-orange/20 bg-qep-orange/5 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Current quote workspace</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-foreground">
                    {activeQuoteNumber ?? `Quote ${activeQuotePackageId.slice(0, 8)}`}
                  </p>
                  <span className="rounded-full border border-qep-orange/20 bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-qep-orange">
                    {quoteStatus.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Current step: {STEP_LABELS[step]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Reopen this quote at any stage, jump anywhere with the step rail, and keep editing the same package.
                </p>
                {activeQuoteUpdatedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last updated {new Date(activeQuoteUpdatedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/quote">Open Quotes</Link>
                </Button>
                {draft.dealId && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/qrm/deals/${draft.dealId}`}>Back to Deal</Link>
                  </Button>
                )}
                {!draft.companyId && activeQuotePackageId && (
                  <Button asChild size="sm">
                    <Link
                      to={`/qrm/companies?new=1&name=${encodeURIComponent(draft.customerCompany || draft.customerName || "Walk-in prospect")}&status=Prospect&source=quote_builder&return_quote_package_id=${encodeURIComponent(activeQuotePackageId)}`}
                    >
                      Convert prospect
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card className="border-qep-orange/20 bg-qep-orange/5 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Urgency signal</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {draft.voiceSummary
                  ? "Fresh field signal captured and ready to steer the quote workspace."
                  : draft.entryMode === "voice"
                    ? "Waiting on the field note that should shape the quote."
                    : "No voice signal attached yet."}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Next move</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {draft.voiceSummary
                  ? "Confirm the recommendation, tighten the equipment mix, and move toward pricing."
                  : "Capture the customer need clearly so QRM can seed the workspace correctly."}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Pipeline carry-through</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {draft.dealId
                  ? "This quote is already anchored to a QRM deal."
                  : "Deal linkage should happen before this opportunity goes cold."}
              </p>
            </div>
          </div>
        </Card>

        <QuoteBuilderStatusBanners
          existingQuoteLoadError={
            existingQuoteQuery.isError
              ? (existingQuoteQuery.error instanceof Error
                ? existingQuoteQuery.error.message
                : "Unable to load the saved quote.")
              : null
          }
          existingQuoteEditingMessage={
            !existingQuoteQuery.isError && existingQuote
              ? `Editing saved quote${typeof existingQuote.quote_number === "string" && existingQuote.quote_number
                ? ` ${existingQuote.quote_number}`
                : ""}. Update any step below, then save to keep working in the same quote.`
              : null
          }
        />

        <WizardShell
          currentWizardStepNumber={currentWizardStepNumber}
          signalsReady={signalsReady}
          marginPct={marginPct}
          marginAmount={marginAmount}
          wizardPricingJumpAllowed={wizardPricingJumpAllowed}
          branches={branches}
          wizardNextHelp={wizardNextHelp}
          previousWizardStep={previousWizardStep}
          nextWizardStep={nextWizardStep}
          wizardNextDisabled={wizardNextDisabled}
          nextWizardLabel={nextWizardLabel}
          hasCustomer={hasCustomer}
          onQuoteForProspect={handleQuoteForProspect}
          wizardMaxStepIndex0={wizardMaxStepIndex0}
        >
      <QuoteWizardStepRouter
        aiPrompt={aiPrompt}
        setAiPrompt={setAiPrompt}
        intakeRecorderOpen={intakeRecorderOpen}
        setIntakeRecorderOpen={setIntakeRecorderOpen}
        onVoiceRecorded={onVoiceRecorded}
        voiceMutationPending={voiceMutation.isPending}
        onBuildWithAi={onBuildWithAi}
        aiIntakeMutationPending={aiIntakeMutation.isPending}
        aiIntakeMessage={aiIntakeMessage}
        winProbContext={winProbContext}
        factorVerdicts={factorVerdicts}
        shadowHistory={shadowHistory}
        shadowCalibration={shadowCalibration}
        intelligencePanel={intelligencePanel}
        setAvailableOptions={setAvailableOptions}
        setAvailableOptionsLabel={setAvailableOptionsLabel}
        availableOptionsLabel={availableOptionsLabel}
        equipmentKeyForLine={equipmentKeyForLine}
        availabilityStatusForLine={availabilityStatusForLine}
        availabilityRequestIdForLine={availabilityRequestIdForLine}
        availabilityRequestCreatedAtForLine={availabilityRequestCreatedAtForLine}
        availabilityRequestLabel={availabilityRequestLabel}
        availabilityLabel={availabilityLabel}
        liveAvailabilityRequestForLine={liveAvailabilityRequestForLine}
        liveAvailabilityStatusForLine={liveAvailabilityStatusForLine}
        markAvailabilityConfirmationRequested={markAvailabilityConfirmationRequested}
        markAllAvailabilityConfirmationRequested={markAllAvailabilityConfirmationRequested}
        availabilityRequestMutationPending={availabilityRequestMutation.isPending}
        sourceRequiredAwaitingConfirmation={sourceRequiredAwaitingConfirmation}
        sourceRequiredUnavailable={sourceRequiredUnavailable}
        equipmentCanContinue={equipmentCanContinue}
        configureTab={configureTab}
        setConfigureTab={setConfigureTab}
        availableOptions={availableOptions}
        setPackageItemSearchOpen={setPackageItemSearchOpen}
        customLineTitle={customLineTitle}
        setCustomLineTitle={setCustomLineTitle}
        customLinePrice={customLinePrice}
        setCustomLinePrice={setCustomLinePrice}
        addConfigLine={addConfigLine}
        appliedValuationSnapshot={tradeValuationProposalQuery.data ?? null}
        onPointShootApply={handlePointShootTradeApply}
        tradeChecklist={tradeChecklist}
        tradeCapture={tradeCapture}
        tradeManagerApprovalRequired={tradeManagerApprovalRequired}
        onOpenTradeCapture={(key) => {
          setActiveTradeCaptureKey(key);
          setTradeCaptureOpen(true);
        }}
        equipmentTotal={equipmentTotal}
        attachmentTotal={attachmentTotal}
        internalCostLoadTotal={internalCostLoadTotal}
        pricingLineTotal={pricingLineTotal}
        subtotal={subtotal}
        discountTotal={discountTotal}
        taxableBasis={taxableBasis}
        taxTotal={taxTotal}
        customerTotal={customerTotal}
        marginPct={marginPct}
        dealerCost={dealerCost}
        netTotal={netTotal}
        marginAmount={marginAmount}
        inboundFreightEligible={inboundFreightEligible}
        pricingLine={pricingLine}
        upsertPricingLine={upsertPricingLine}
        discountLine={discountLine}
        miscChargeTitle={miscChargeTitle}
        setMiscChargeTitle={setMiscChargeTitle}
        miscChargeAmount={miscChargeAmount}
        setMiscChargeAmount={setMiscChargeAmount}
        miscCreditTitle={miscCreditTitle}
        setMiscCreditTitle={setMiscCreditTitle}
        miscCreditAmount={miscCreditAmount}
        setMiscCreditAmount={setMiscCreditAmount}
        onAddMiscPricingLine={handleAddMiscPricingLine}
        taxProfiles={taxProfiles}
        taxPreviewData={taxPreviewQuery.data}
        taxPreviewLoading={taxPreviewQuery.isLoading}
        taxPreviewError={taxPreviewQuery.isError}
        branchStateProvince={selectedBranch?.state_province}
        activeQuotePackageId={activeQuotePackageId}
        allFinanceScenarios={allFinanceScenarios}
        cashDown={cashDown}
        amountFinanced={amountFinanced}
        financingPreviewLoading={financingPreviewQuery.isLoading}
        financingPreviewError={financingPreviewQuery.isError}
        leaseQuotingEnabled={leaseQuotingEnabled}
        branchDisplayName={selectedBranch?.display_name ?? (draft.branchSlug || "Missing")}
        financeMethodLabel={financeMethodLabel}
        availabilityAwaitingCount={sourceRequiredAwaitingConfirmation.length}
        sendReadiness={packetReadiness.send}
        requiresManagerApproval={approvalState.requiresManagerApproval}
        userRole={userRoleQuery.data ?? null}
        canSubmitForApproval={canSubmitForApproval}
        approvalPending={approvalPending}
        approvalGranted={approvalGranted}
        bypassApprovedWithoutCase={bypassApprovedWithoutCase}
        submitApprovalPending={submitApprovalMutation.isPending}
        onSubmitApproval={() => submitApprovalMutation.mutate()}
        submitApprovalData={submitApprovalMutation.data}
        quoteStatus={quoteStatus}
        onQuoteStatusChange={handleQuoteStatusChange}
        quoteTitle={quoteTitle}
        documentPersistenceLabel={documentPersistenceLabel}
        documentFallbackGeneratedAt={documentFallbackGeneratedAt}
        documentArtifact={documentArtifact}
        customerFacingDocumentBlocker={customerFacingDocumentBlocker}
        pdfGenerating={pdfGenerating}
        quoteMediaSnapshotLoading={quoteMediaSnapshotLoading}
        documentActionError={documentActionError}
        documentReady={documentReady}
        onGenerateDocument={() => void handleGenerateFallbackDocument()}
        approvalCaseCanSend={approvalCaseCanSend}
        approvalBlocker={approvalBlocker}
        taxResolved={taxResolved}
        taxResolutionBlocker={taxResolutionBlocker}
        whyThisMachineRequired={whyThisMachineRequired}
        whyThisMachineBlocker={whyThisMachineBlocker}
        previewReadiness={previewReadiness}
        emailReadiness={emailReadiness}
        textReadiness={textReadiness}
        textQuoteEnabled={textQuoteEnabled}
        deliveryActionBusy={deliveryActionBusy}
        deliveryActionMessage={deliveryActionMessage}
        deliveryActionError={deliveryActionError}
        savePending={saveMutation.isPending}
        onPreview={() => void handleQuoteSendAction("preview")}
        onEmail={() => void handleQuoteSendAction("email")}
        onText={() => void handleQuoteSendAction("text")}
        onSaveFollowUp={() => void handleSaveClick()}
      />

        </WizardShell>

      <MarginFloorGate
        brandId={null}
        marginPct={marginPct}
        netTotalCents={Math.round(netTotal * 100)}
        reasonModalOpen={marginGateOpen}
        onReasonModalOpenChange={setMarginGateOpen}
        onReasonConfirm={(payload) => { void handleMarginReasonConfirm(payload); }}
      />

      <QuoteBuilderStatusBanners
        pdfError={pdfError}
        saveSuccess={saveMutation.isSuccess}
        saveErrorMessage={
          saveMutation.isError
            ? (saveMutation.error instanceof Error
              ? saveMutation.error.message
              : "Failed to save the quote.")
            : null
        }
        submitApprovalErrorMessage={
          submitApprovalMutation.isError
            ? (submitApprovalMutation.error instanceof Error
              ? submitApprovalMutation.error.message
              : "Failed to submit the quote for approval.")
            : null
        }
      />

      </div>
      {/* Right column — intelligence panel + Deal Coach (desktop only) */}
      <aside className="hidden w-80 shrink-0 xl:block">
        <div className="sticky top-4 space-y-3">
          {intelligencePanel}
          {draft.equipment.length > 0 && (
            <DealCoachSidebar
              draft={draft}
              computed={{ equipmentTotal, attachmentTotal, subtotal, netTotal, marginAmount, marginPct }}
              quotePackageId={activeQuotePackageId}
            />
          )}
        </div>
      </aside>
        </div>

      <QuoteBuilderOverlays
        dealAssistantOpen={dealAssistantOpen}
        onDealAssistantOpenChange={setDealAssistantOpen}
        onScenarioSelect={handleScenarioSelection}
        activeQuotePackageId={activeQuotePackageId}
        tradeCaptureOpen={tradeCaptureOpen}
        onTradeCaptureOpenChange={setTradeCaptureOpen}
        activeTradeCaptureKey={activeTradeCaptureKey}
        onActiveTradeCaptureKeyChange={setActiveTradeCaptureKey}
        tradeCapture={tradeCapture}
        setTradeCapture={setTradeCapture}
        tradeChecklist={tradeChecklist}
        packageItemSearchOpen={packageItemSearchOpen}
        onPackageItemSearchOpenChange={setPackageItemSearchOpen}
        configureTab={configureTab}
        availableOptions={availableOptions}
        availableOptionsLabel={availableOptionsLabel}
        onAddPackageCatalogItem={addPackageCatalogItem}
        catalogBrowserOpen={catalogBrowserOpen}
        onCatalogBrowserOpenChange={setCatalogBrowserOpen}
        onAddCatalogEquipment={addCatalogEquipment}
        onAddCatalogAttachment={addCatalogAttachment}
        reviewSendOpen={reviewSendOpen}
        onReviewSendOpenChange={setReviewSendOpen}
        customerTotal={customerTotal}
        financeMethodLabel={financeMethodLabel}
        pdfGenerating={pdfGenerating}
        pdfError={pdfError}
        onDownloadPdf={handleDownloadPdf}
        shareBusy={shareBusy}
        shareUrl={shareUrl}
        shareError={shareError}
        onIssueShareLink={handleIssueShareLink}
        internalNotes={internalNotes}
        setInternalNotes={setInternalNotes}
        packetReadiness={packetReadiness}
        approvalGranted={approvalGranted}
        requiresManagerApproval={approvalState.requiresManagerApproval}
        approvalDetail={approvalState.reason ?? ""}
      />

    </div>
    </WizardStateProvider>
  );
}
