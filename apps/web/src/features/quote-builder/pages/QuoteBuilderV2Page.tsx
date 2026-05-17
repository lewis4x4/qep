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
  logQuoteDeliveryEvent,
  persistQuoteDocumentArtifact,
  requestQuoteAvailability,
  searchCatalog,
  sendQuotePackage,
  type QuoteAvailabilityRequest,
  type QuotePackageCatalogItem,
  type QuotePackageCatalogKind,
  type QuoteFinancingRequest,
} from "../lib/quote-api";
import {
  computeQuoteSendActionReadiness,
  isQuoteWhyThisMachineConfirmationRequired,
  isTaxProfileExempt,
  quoteLineCostVisibility,
  type QuoteSendActionChannel,
} from "../lib/quote-workspace";
import { useApprovalBypass } from "../hooks/useApprovalBypass";
import { useExistingQuoteLoad } from "../hooks/useExistingQuoteLoad";
import { useQuoteBuilderHandoffs } from "../hooks/useQuoteBuilderHandoffs";
import { useQuoteBuilderInboundFreightReset } from "../hooks/useQuoteBuilderInboundFreightReset";
import { useQuoteBuilderCrmHydration } from "../hooks/useQuoteBuilderCrmHydration";
import { useQuoteBuilderDefaultBranch } from "../hooks/useQuoteBuilderDefaultBranch";
import { useQuoteBuilderDetailsDefaults } from "../hooks/useQuoteBuilderDetailsDefaults";
import { useQuoteBuilderDocumentInvalidation } from "../hooks/useQuoteBuilderDocumentInvalidation";
import { useQuoteBuilderLocalDraft } from "../hooks/useQuoteBuilderLocalDraft";
import { useQuoteBuilderEquipmentSeed } from "../hooks/useQuoteBuilderEquipmentSeed";
import { useQuoteBuilderFinanceScenarioSync } from "../hooks/useQuoteBuilderFinanceScenarioSync";
import { useQuoteBuilderKeyboardShortcuts } from "../hooks/useQuoteBuilderKeyboardShortcuts";
import { useQuoteBuilderLocalDraftPersist } from "../hooks/useQuoteBuilderLocalDraftPersist";
import { useQuoteBuilderSave } from "../hooks/useQuoteBuilderSave";
import { useQuoteBuilderTaxSync } from "../hooks/useQuoteBuilderTaxSync";
import { useQuoteBuilderWizardPersist } from "../hooks/useQuoteBuilderWizardPersist";
import { useDraftAutosave } from "../hooks/useDraftAutosave";
import { useLiveMargin } from "../hooks/useLiveMargin";
import { usePdiAutofill } from "../hooks/usePdiAutofill";
import {
  applyEquipmentOverridePrice,
  equipmentSystemBasePrice,
} from "../lib/equipment-override-price";
import { buildCatalogQueryCandidates } from "../lib/catalog-query-candidates";
import { isDraftEmpty } from "../lib/local-draft";
import { useActiveBranches, useBranchBySlug } from "@/hooks/useBranches";
import { useQuotePDF } from "../hooks/useQuotePDF";
import { useQuoteFinancingPreview } from "../hooks/useQuoteFinancingPreview";
import { useQuoteTaxPreview } from "../hooks/useQuoteTaxPreview";
import { buildCustomFinanceScenario } from "../lib/custom-finance";
import { buildQuoteProposalData } from "../lib/quote-proposal-data";
import { getTradeValuationProposalSnapshot } from "../lib/point-shoot-trade-api";
import { buildQuotePdfBranch } from "../lib/quote-builder-page-normalizers";
import { AskIronAdvisorButton } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { VoiceRecorder } from "@/features/voice-qrm/components/VoiceRecorder";
import { submitVoiceToQrm } from "@/features/voice-qrm/lib/voice-qrm-api";
import { toast } from "@/hooks/use-toast";
import { DealAssistantTrigger, type ScenarioSelection } from "../components/ConversationalDealEngine";
import { issueShareToken } from "@/features/deal-room/lib/deal-room-api";
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
import {
  PRICING_ADDER_FIELDS,
  type CostVisibility,
  type PricingAdderField,
  type PricingLineKind,
} from "../lib/pricing-adder-fields";
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
  normalizeMachineMatchLabel,
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

  const userRoleQuery = useQuery({
    queryKey: ["quote-builder", "role"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return null;
      const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (error) throw error;
      return typeof data?.role === "string" ? data.role : null;
    },
    staleTime: 60_000,
  });

  // Slice 20c: margin baseline powers the win-probability strip's "margin
  // discipline" factor. Same data source DealCoachSidebar uses; we fetch it
  // here once so every step can render the strip without each surface
  // refetching. `enabled` gates on profile.id because the query hits
  // quote_packages.created_by — firing pre-auth would always come back empty.
  const marginBaselineQuery = useQuery({
    queryKey: ["quote-builder", "margin-baseline", profile?.id ?? ""],
    queryFn: () => (profile?.id ? getMarginBaseline(profile.id) : Promise.resolve(null)),
    enabled: !!profile?.id,
    staleTime: 5 * 60_000,
  });
  // Memoized so the strip's `useMemo([draft, context])` scorer can actually
  // hit — a fresh object literal on every render would invalidate it.
  const marginBaselineMedianPct = marginBaselineQuery.data?.medianPct ?? null;

  // Slice 20i: factor verdicts — historical "proven / suspect / unknown"
  // labels for each scorer factor, used by WinProbabilityStrip to annotate
  // the live factor chips. Rep-accessible endpoint; on failure it returns
  // an empty map and the strip silently renders without badges.
  // Gated on `profile?.id` to avoid firing a pre-auth fetch that'd be
  // silently discarded; 5-minute stale time because the verdict
  // aggregate changes on closed-deal timescale, not quote-editing
  // timescale.
  const factorVerdictsQuery = useQuery({
    queryKey: ["quote-builder", "factor-verdicts"],
    queryFn: getFactorVerdicts,
    enabled: !!profile?.id,
    staleTime: 5 * 60_000,
  });
  const factorVerdicts = factorVerdictsQuery.data ?? null;

  // Slice 20j: closed-deals history feeds the K-nearest-neighbor
  // shadow score. The endpoint is manager/owner-only; on reps it
  // returns `{ok:false, reason:"forbidden"}` and we silently render
  // the strip without a shadow chip. Same 5-minute stale time as the
  // verdicts query for the same reason — history updates on
  // closed-deal timescale, not keystroke timescale.
  //
  // Role-gated so we don't round-trip a guaranteed-403 request every
  // 5 minutes on rep sessions. `userRoleQuery.data` can momentarily
  // be undefined; we wait for it to resolve before firing.
  const canLoadShadowHistory =
    !!profile?.id
    && (userRoleQuery.data === "manager" || userRoleQuery.data === "owner");
  const closedDealsAuditQuery = useQuery({
    queryKey: ["quote-builder", "closed-deals-audit"],
    queryFn: getClosedDealsAudit,
    enabled: canLoadShadowHistory,
    staleTime: 5 * 60_000,
  });
  const shadowHistory = useMemo(() => {
    const result = closedDealsAuditQuery.data;
    if (!result || !result.ok) return null;
    return result.audits.map((a) => ({
      packageId: a.packageId,
      factors: a.factors,
      outcome: a.outcome,
    }));
  }, [closedDealsAuditQuery.data]);
  // Slice 20l: calibrated disagreement callout. Derive the aggregate
  // shadow-vs-rule agreement summary from the same closed-deals
  // payload so the strip can modulate its tone by measured evidence.
  // Computed once here (not on every strip render) so three mounted
  // strips share the work.
  const shadowCalibration = useMemo(() => {
    const result = closedDealsAuditQuery.data;
    if (!result || !result.ok) return null;
    if (result.audits.length === 0) return null;
    const retros = computeRetrospectiveShadows(result.audits);
    return computeShadowAgreementSummary(retros);
  }, [closedDealsAuditQuery.data]);
  const winProbContext = useMemo(
    () => ({ marginPct, marginBaselineMedianPct }),
    [marginPct, marginBaselineMedianPct],
  );

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

  const voiceMutation = useMutation({
    mutationFn: async (payload: { blob: Blob; fileName: string }) => {
      const voiceResult = await submitVoiceToQrm({
        audioBlob: payload.blob,
        fileName: payload.fileName,
        dealId: draft.dealId || undefined,
      });
      if (!("transcript" in voiceResult) || !voiceResult.transcript) {
        throw new Error("Voice note did not return a usable transcript.");
      }
      const recommendation = await getAiEquipmentRecommendation(voiceResult.transcript);
      return { voiceResult, recommendation };
    },
    onSuccess: ({ voiceResult, recommendation }) => {
      // voice-to-qrm already extracts structured entities from the
      // transcript (contact name/id, company name/id, deal id). The old
      // flow dropped all of that on the floor — rep landed on Customer
      // with an empty form even though the pipeline knew "John Coker"
      // from "I'm quoting John Coker for a small farm tractor..." Pull
      // the entities in so the Customer step is pre-filled when confidence
      // is usable. Only apply fields we actually have; don't overwrite
      // a manually-entered value the rep may have already typed.
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
      // Slice 20a: land on the Customer step instead of Equipment. The AI
      // has picked a machine, but we still don't know who the quote is
      // for — rep confirms/picks customer next.
      setStep("customer");
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
      setStep(draftHasCustomer(draft) ? "equipment" : "customer");
      toast({
        title: "Catalog-backed recommendation ready",
        description: draftHasCustomer(draft)
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

  const handleScenarioSelection = (selection: ScenarioSelection) => {
    applyScenarioSelection(selection, "deal_assistant");
  };

  function addCatalogEquipment(entry: CatalogEntryMatch): void {
    setAvailableOptions(entry.attachments ?? []);
    setAvailableOptionsLabel(`${entry.make} ${entry.model}`);
    const nextLine = buildEquipmentLine(entry);
    const nextKey = equipmentKeyForLine(nextLine);
    setDraft((current) => ({
      ...current,
      equipment: current.equipment.some((item) => equipmentKeyForLine(item) === nextKey)
        ? current.equipment
        : [...current.equipment, nextLine],
    }));
  }

  function addCatalogAttachment(entry: CatalogAttachmentMatch): void {
    addPackageCatalogItem({
      id: entry.id,
      kind: "attachment",
      name: entry.name,
      price: entry.price,
      dealerCost: null,
      brandName: entry.brandName ?? null,
      category: entry.category ?? null,
      universal: entry.universal === true,
      sourceCatalog: "qb_attachments",
      sourceId: entry.id,
      metadata: {
        catalog_kind: entry.universal ? "universal_attachment" : "attachment",
        brand_name: entry.brandName ?? null,
        category: entry.category ?? null,
      },
    });
  }

  function addPackageCatalogItem(entry: QuotePackageCatalogItem): void {
    const nextLine: QuoteLineItemDraft = {
      kind: entry.kind,
      id: entry.id,
      sourceCatalog: entry.sourceCatalog,
      sourceId: entry.sourceId,
      dealerCost: entry.dealerCost,
      title: entry.name,
      quantity: 1,
      unitPrice: entry.price,
      metadata: {
        ...(entry.metadata ?? {}),
        brand_name: entry.brandName ?? null,
        category: entry.category ?? null,
        universal: entry.universal,
      },
    };
    const nextKey = equipmentKeyForLine(nextLine);
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.some((item) => equipmentKeyForLine(item) === nextKey)
        ? current.attachments
        : [...current.attachments, nextLine],
    }));
  }

  async function addRecommendedMachine(machine: string) {
    // AI machine strings look like "Case SR175 (2026)". Catalog columns
    // (model_code/family/series/name_display) don't contain the year, so
    // a single ilike on the full string returns zero rows and we fall
    // through progressive catalog-only fallbacks (full → no year →
    // make+model → model code → make). If none match, do not add a manual
    // line: AI recommendations must remain backed by a sellable QEP model.
    const candidateQueries = buildCatalogQueryCandidates(machine);
    const expectedMachine = normalizeMachineMatchLabel(machine);
    let firstMatch: CatalogEntryMatch | undefined;
    try {
      for (const query of candidateQueries) {
        const matches = await searchCatalog(query) as CatalogEntryMatch[];
        const exactMatch = matches.find((match) =>
          normalizeMachineMatchLabel(`${match.make} ${match.model}`) === expectedMachine
        );
        if (exactMatch || matches.length > 0) {
          firstMatch = exactMatch ?? matches[0];
          break;
        }
      }
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
    } catch {
      toast({
        title: "Catalog verification failed",
        description: "The recommendation was not added. Browse Catalog and select a verified machine.",
        variant: "destructive",
      });
      setStep("equipment");
      return;
    }
    // Slice 20a: if the rep hasn't picked a customer yet, land on Customer
    // so "who is this quote for?" is explicit before we jump to Equipment.
    // The AI rec often flows straight from voice/AI-chat intake, where the
    // rep hasn't confirmed the customer identity yet.
    const hasCustomerNow = Boolean(
      draft.customerName?.trim() ||
      draft.customerCompany?.trim() ||
      draft.contactId ||
      draft.companyId,
    );
    setStep(hasCustomerNow ? "equipment" : "customer");
  }

  function handleDownloadPdf() {
    if (customerFacingDocumentBlocker) {
      setDocumentActionError(customerFacingDocumentBlocker);
      return;
    }
    if (quoteMediaSnapshotLoading) {
      setDocumentActionError("Trade-in photos are still loading. Try again in a moment so the proposal includes the stored trade media.");
      return;
    }
    void downloadPDF(quotePdfData);
  }

  function approvalBlockerMessage(): string | null {
    if (!activeQuotePackageId) return "Save the quote package before generating customer-facing documents.";
    if (activeApprovalCaseLoading) return "Checking the approval case before customer-facing actions unlock.";
    if (bypassApprovedWithoutCase) return null;
    if (!activeApprovalCase) return "Submit this quote for owner approval before generating or sending customer-facing material.";
    if (activeApprovalCase.canSend) return null;
    if (activeApprovalCase.status === "pending" || activeApprovalCase.status === "escalated") {
      return activeApprovalCase.assignedToName
        ? `Waiting on ${activeApprovalCase.assignedToName} to approve this quote.`
        : "Approval is still pending in Approval Center.";
    }
    if (activeApprovalCase.status === "changes_requested") return "Approval requested changes. Revise and resubmit before sending.";
    if (activeApprovalCase.status === "rejected") return "Approval rejected this quote. It cannot be sent until revised and approved.";
    if (activeApprovalCase.status === "approved_with_conditions") {
      const unmet = activeApprovalCase.evaluations.filter((evaluation) => !evaluation.satisfied).map((evaluation) => evaluation.label);
      return unmet.length > 0
        ? `Approval has unmet conditions: ${unmet.join(", ")}.`
        : "Conditional approval is not clean yet. Recheck the approval case before sending.";
    }
    return "Approval is not clean. Ryan/Rylee approval-case canSend must be true before customer-facing actions.";
  }

  async function ensureCleanApprovalForCustomerFacing(): Promise<string | null> {
    if (!packetReadiness.draft.ready) return "Save the quote package before customer-facing actions.";
    if (draftSaveSignature !== lastAutoSaveSignatureRef.current) {
      await saveMutation.mutateAsync();
      lastAutoSaveSignatureRef.current = draftSaveSignature;
    }
    const refreshed = await refetchActiveApprovalCase();
    if (refreshed.error) return "Could not recheck owner approval after saving. Try again before customer-facing actions.";
    if (!refreshed.data && bypassApprovedWithoutCase) return null;
    return refreshed.data?.canSend === true
      ? null
      : "Approval case is no longer clean after saving the latest quote changes. Resubmit or wait for owner approval before customer-facing actions.";
  }

  async function handleGenerateFallbackDocument() {
    setDocumentActionError(null);
    const blocker = customerFacingDocumentBlocker;
    if (blocker) {
      setDocumentActionError(blocker);
      return;
    }
    if (quoteMediaSnapshotLoading) {
      setDocumentActionError("Trade-in photos are still loading. Try again in a moment so the proposal includes the stored trade media.");
      return;
    }
    try {
      const approvalRefreshBlocker = await ensureCleanApprovalForCustomerFacing();
      if (approvalRefreshBlocker) {
        setDocumentActionError(approvalRefreshBlocker);
        return;
      }
      const pdfResult = await downloadPDF(quotePdfData);
      const generatedAt = new Date().toISOString();
      let artifact: { id: string; storageBucket: string; storageKey: string; generatedAt: string } | null = null;
      if (activeQuotePackageId && pdfResult.blob) {
        const persisted = await persistQuoteDocumentArtifact({
          quotePackageId: activeQuotePackageId,
          quotePackageVersionId: saveMutation.data?.quote_package_version_id ?? null,
          blob: pdfResult.blob,
          filename: pdfResult.filename,
          generatedAt,
          metadata: {
            step: 10,
            mode: pdfResult.mode,
            draft_signature: draftSaveSignature,
          },
        });
        artifact = { ...persisted, generatedAt };
        setDocumentArtifact(artifact);
      } else {
        setDocumentArtifact(null);
      }
      documentDraftSignatureRef.current = draftSaveSignature;
      setDocumentFallbackGeneratedAt(generatedAt);
      if (activeQuotePackageId) {
        await logQuoteDeliveryEvent({
          quotePackageId: activeQuotePackageId,
          documentArtifactId: artifact?.id ?? null,
          channel: "preview",
          status: "draft",
          provider: artifact ? "stored_pdf_preview" : "local_preview",
          recipient: draft.customerEmail || draft.customerPhone || draft.customerName || draft.customerCompany || null,
          followUpAt: draft.followUpAt ?? null,
          metadata: {
            step: 10,
            fallback_document: !artifact,
            document_artifact_id: artifact?.id ?? null,
            generated_at: generatedAt,
            storage_bucket: artifact?.storageBucket ?? null,
            storage_key: artifact?.storageKey ?? null,
            note: artifact
              ? "Customer quote PDF stored as a quote document artifact."
              : "Printable fallback opened; no stored PDF artifact was created.",
          },
        });
      }
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : "Failed to generate document preview.");
    }
  }

  async function handleQuoteSendAction(channel: QuoteSendActionChannel) {
    setDeliveryActionMessage(null);
    setDeliveryActionError(null);
    const readiness = computeQuoteSendActionReadiness({
      channel,
      quotePackageId: activeQuotePackageId,
      approvalCaseCanSend,
      followUpAt: draft.followUpAt ?? null,
      customerEmail: draft.customerEmail ?? null,
      customerPhone: draft.customerPhone ?? null,
      documentReady: Boolean(documentFallbackGeneratedAt),
      taxResolved,
      whyThisMachineRequired,
      whyThisMachineConfirmed: draft.whyThisMachineConfirmed === true,
    });
    if (!readiness.ready) {
      setDeliveryActionError(`Blocked: ${readiness.missing.join(", ")}.`);
      return;
    }
    const approvalRefreshBlocker = await ensureCleanApprovalForCustomerFacing();
    if (approvalRefreshBlocker) {
      setDeliveryActionError(`Blocked: ${approvalRefreshBlocker}`);
      return;
    }
    if (!activeQuotePackageId) return;
    setDeliveryActionBusy(channel);
    try {
      if (channel === "preview") {
        if (quoteMediaSnapshotLoading) {
          setDeliveryActionError("Blocked: trade-in photos are still loading. Try again in a moment.");
          return;
        }
        const pdfResult = await downloadPDF(quotePdfData);
        const generatedAt = new Date().toISOString();
        let artifact: { id: string; storageBucket: string; storageKey: string; generatedAt: string } | null = null;
        if (activeQuotePackageId && pdfResult.blob) {
          const persisted = await persistQuoteDocumentArtifact({
            quotePackageId: activeQuotePackageId,
            quotePackageVersionId: saveMutation.data?.quote_package_version_id ?? null,
            blob: pdfResult.blob,
            filename: pdfResult.filename,
            generatedAt,
            metadata: {
              step: 11,
              mode: pdfResult.mode,
              draft_signature: draftSaveSignature,
            },
          });
          artifact = { ...persisted, generatedAt };
          setDocumentArtifact(artifact);
        } else {
          setDocumentArtifact(null);
        }
        documentDraftSignatureRef.current = draftSaveSignature;
        setDocumentFallbackGeneratedAt(generatedAt);
        await logQuoteDeliveryEvent({
          quotePackageId: activeQuotePackageId,
          documentArtifactId: artifact?.id ?? null,
          channel: "preview",
          status: "draft",
          provider: artifact ? "stored_pdf_preview" : "local_preview",
          recipient: draft.customerEmail || draft.customerPhone || draft.customerName || draft.customerCompany || null,
          followUpAt: draft.followUpAt ?? null,
          metadata: {
            step: 11,
            fallback_document: !artifact,
            document_artifact_id: artifact?.id ?? null,
            generated_at: generatedAt,
            mode: pdfResult.mode,
            storage_bucket: artifact?.storageBucket ?? null,
            storage_key: artifact?.storageKey ?? null,
            note: artifact
              ? "Customer quote PDF stored as a quote document artifact."
              : "Printable fallback opened; no stored PDF artifact was created.",
          },
        });
        setDeliveryActionMessage("Preview opened and logged. This does not mark the quote sent.");
        return;
      }

      const textEnabled = import.meta.env.VITE_FEATURE_QRM_TEXT_QUOTE === "true";
      if (channel === "email") {
        const result = await sendQuotePackage(activeQuotePackageId, {
          documentArtifactId: documentArtifact?.id ?? null,
          followUpAt: draft.followUpAt ?? null,
        });
        setDraft((current) => ({ ...current, quoteStatus: "sent" }));
        setDeliveryActionMessage(`Quote emailed to ${result.to_email}. Delivery event ${result.delivery_event_id ? "logged" : "recorded by quote status"} and follow-up preserved.`);
        return;
      }

      if (!textEnabled) {
        setDeliveryActionMessage("Twilio is not configured. No customer text was sent and no delivery event was logged.");
        return;
      }

      setDeliveryActionError("Twilio flag is enabled, but the text send endpoint is not implemented yet. No customer message was sent or logged.");
    } catch (error) {
      setDeliveryActionError(error instanceof Error ? error.message : "Quote delivery action failed.");
    } finally {
      setDeliveryActionBusy(null);
    }
  }

  function handleAddCustomLine(kindLabel: "Warranty" | "Financing" | "Custom") {
    const title = customLineTitle.trim() || `${kindLabel} line item`;
    const unitPrice = Number.isFinite(customLinePrice) && customLinePrice > 0 ? customLinePrice : 0;
    const kind = kindLabel.toLowerCase() as "warranty" | "financing" | "custom";
    setDraft((current) => ({
      ...current,
      attachments: [
        ...current.attachments,
        {
          kind,
          id: `${kindLabel.toLowerCase()}-${Date.now()}`,
          sourceCatalog: "manual",
          sourceId: null,
          dealerCost: null,
          title: `${kindLabel}: ${title}`,
          quantity: 1,
          unitPrice,
        },
      ],
    }));
    setCustomLineTitle("");
    setCustomLinePrice(0);
    setPackageToolsOpen(false);
  }

  function handleAddMiscPricingLine(kind: "charge" | "credit") {
    const rawTitle = kind === "charge" ? miscChargeTitle : miscCreditTitle;
    const rawAmount = kind === "charge" ? miscChargeAmount : miscCreditAmount;
    const title = rawTitle.trim() || (kind === "charge" ? "Misc charge" : "Misc credit");
    const amount = Number.isFinite(rawAmount) ? Math.max(0, rawAmount) : 0;
    if (amount <= 0) return;
    const id = `misc_${kind}_${Date.now()}`;
    const field: PricingAdderField = {
      id,
      kind: kind === "credit" ? "discount" : "custom",
      title,
      helper: kind === "credit" ? "Customer-facing miscellaneous credit" : "Customer-facing miscellaneous charge",
      step: 25,
      costVisibility: "customer",
      metadata: {
        pricing_field_key: id,
        misc_line_kind: kind,
      },
    };
    upsertPricingLine(field, amount, {
      title,
      reasonCode: kind === "credit" ? "other" : null,
      metadata: field.metadata,
    });
    if (kind === "charge") {
      setMiscChargeTitle("");
      setMiscChargeAmount(0);
    } else {
      setMiscCreditTitle("");
      setMiscCreditAmount(0);
    }
  }

  function handlePrimaryAction() {
    if (quoteStatus === "sent" || quoteStatus === "accepted") {
      void handleSaveClick();
      return;
    }
    if (approvalCaseCanSend && packetReadiness.send.ready) {
      setStep("document");
      return;
    }
    if (canSubmitForApproval) {
      submitApprovalMutation.mutate();
      return;
    }
    void handleSaveClick();
  }

  async function handleIssueShareLink() {
    if (!activeQuotePackageId) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const { token } = await issueShareToken(activeQuotePackageId);
      const url = `${window.location.origin}/q/${token}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard can be unavailable in preview or restricted browsers.
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Unable to create share link.");
    } finally {
      setShareBusy(false);
    }
  }

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

  function liveAvailabilityRequestForLine(item: QuoteLineItemDraft): QuoteAvailabilityRequest | null {
    const requestId = availabilityRequestIdForLine(item);
    return requestId ? availabilityRequestsById.get(requestId) ?? null : null;
  }

  function liveAvailabilityStatusForLine(item: QuoteLineItemDraft): string | null {
    const request = liveAvailabilityRequestForLine(item);
    return request?.status ?? availabilityRequestStatusForLine(item);
  }

  // Gate for advancing off the Customer step — any of name, company,
  // or a resolved CRM id is enough. Kept as one derived flag so the
  // Next-button disabled state and the inline helper text can't drift.
  const hasCustomer = Boolean(
    draft.customerName?.trim() ||
    draft.customerCompany?.trim() ||
    draft.contactId ||
    draft.companyId,
  );
  const hasEquipmentLine = draft.equipment.length > 0;
  const sourceRequiredEquipment = draft.equipment.filter((item) => availabilityStatusForLine(item) === "source_required");
  const sourceRequiredAwaitingConfirmation = sourceRequiredEquipment.filter((item) => !availabilityRequestIdForLine(item));
  const sourceRequiredUnavailable = sourceRequiredEquipment.filter((item) => {
    const request = liveAvailabilityRequestForLine(item);
    return request?.status === "not_available" && !request.managerOverrideAt;
  });
  const inboundFreightEligible = draft.equipment.some((item) => availabilityStatusForLine(item) !== "in_stock");
  const equipmentCanContinue = hasEquipmentLine && sourceRequiredAwaitingConfirmation.length === 0 && sourceRequiredUnavailable.length === 0;
  const tradeChecklistComplete = Object.values(tradeChecklist).every(Boolean);
  const tradeManagerApprovalRequired = draft.tradeAllowance > 0 && !tradeChecklistComplete;
  const signalsReady = hasCustomer && hasEquipmentLine;

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
    onSuccess: ({ request, index, clientLineKey }: { request: QuoteAvailabilityRequest; index: number; clientLineKey: string }) => {
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

  function markAvailabilityConfirmationRequested(index: number): void {
    const equipment = draft.equipment[index];
    if (!equipment) return;
    availabilityRequestMutation.mutate({ equipment, index });
  }

  function markAllAvailabilityConfirmationRequested(): void {
    draft.equipment.forEach((equipment, index) => {
      if (availabilityStatusForLine(equipment) === "source_required" && !availabilityRequestIdForLine(equipment)) {
        availabilityRequestMutation.mutate({ equipment, index });
      }
    });
  }

  function addConfigLine(kind: "attachment" | "option" | "accessory" | "part" | "warranty", input?: { id?: string; title: string; unitPrice: number }): void {
    const title = input?.title?.trim() || `${kind[0]!.toUpperCase()}${kind.slice(1)} line`;
    const line: QuoteLineItemDraft = {
      kind,
      id: input?.id ?? `${kind}-${Date.now()}`,
      sourceCatalog: input?.id ? "qb_attachments" : "manual",
      sourceId: input?.id ?? null,
      dealerCost: null,
      title,
      quantity: 1,
      unitPrice: input?.unitPrice ?? 0,
    };
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.some((item) => item.id === line.id)
        ? current.attachments
        : [...current.attachments, line],
    }));
  }

  function pricingFieldKeyForLine(item: QuoteLineItemDraft): string {
    const explicitKey = typeof item.metadata?.pricing_field_key === "string"
      ? item.metadata.pricing_field_key
      : null;
    if (explicitKey) return explicitKey;
    if (item.kind === "freight") {
      const direction = typeof item.metadata?.freight_direction === "string"
        ? item.metadata.freight_direction
        : "outbound";
      return direction === "inbound" ? "inbound_freight" : "outbound_delivery";
    }
    return item.kind;
  }

  function asPricingAdderField(
    fieldOrKind: PricingAdderField | PricingLineKind,
    title?: string,
    costVisibility?: CostVisibility,
  ): PricingAdderField {
    if (typeof fieldOrKind === "object") return fieldOrKind;
    return {
      id: fieldOrKind,
      kind: fieldOrKind,
      title: title ?? fieldOrKind,
      helper: "",
      step: 1,
      costVisibility: costVisibility ?? quoteLineCostVisibility({ kind: fieldOrKind }),
    };
  }

  function pricingLine(fieldOrKind: PricingAdderField | PricingLineKind): QuoteLineItemDraft | undefined {
    const field = asPricingAdderField(fieldOrKind);
    return draft.pricingLines?.find((item) => item.kind === field.kind && pricingFieldKeyForLine(item) === field.id);
  }

  function upsertPricingLine(
    fieldOrKind: PricingAdderField | PricingLineKind,
    amount: number,
    patch: Partial<QuoteLineItemDraft> = {},
    legacyTitle?: string,
    legacyCostVisibility?: CostVisibility,
  ): void {
    const field = asPricingAdderField(fieldOrKind, legacyTitle, legacyCostVisibility);
    const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    setDraft((current) => {
      const existing = current.pricingLines ?? [];
      const existingMatch = existing.find((item) =>
        item.kind === field.kind && pricingFieldKeyForLine(item) === field.id);
      const mergedMetadata = {
        ...(field.metadata ?? {}),
        ...(existingMatch?.metadata ?? {}),
        ...((patch.metadata && typeof patch.metadata === "object" && !Array.isArray(patch.metadata))
          ? patch.metadata
          : {}),
      };
      const nextLine: QuoteLineItemDraft = {
        kind: field.kind,
        id: existingMatch?.id ?? `${field.id}-${Date.now()}`,
        sourceCatalog: "manual",
        sourceId: null,
        dealerCost: null,
        costVisibility: field.costVisibility,
        title: field.title,
        quantity: 1,
        unitPrice: safeAmount,
        metadata: mergedMetadata,
        ...patch,
      };
      return {
        ...current,
        pricingLines: safeAmount <= 0
          ? existing.filter((item) => !(item.kind === field.kind && pricingFieldKeyForLine(item) === field.id))
          : existingMatch
            ? existing.map((item) =>
              item.kind === field.kind && pricingFieldKeyForLine(item) === field.id
                ? { ...item, ...nextLine }
                : item)
            : [...existing, nextLine],
      };
    });
  }

  useQuoteBuilderInboundFreightReset({
    inboundFreightEligible,
    pricingLines: draft.pricingLines,
    pricingLine,
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
  const textQuoteEnabled = import.meta.env.VITE_FEATURE_QRM_TEXT_QUOTE === "true";
  const approvalBlocker = approvalBlockerMessage();
  const whyThisMachineRequired = isQuoteWhyThisMachineConfirmationRequired(draft);
  const whyThisMachineBlocker = whyThisMachineRequired && draft.whyThisMachineConfirmed !== true
    ? "Confirm the Why this machine narrative before customer-facing document/send."
    : null;
  const customerFacingDocumentBlocker = approvalBlocker ?? taxResolutionBlocker ?? whyThisMachineBlocker;
  const previewReadiness = computeQuoteSendActionReadiness({
    channel: "preview",
    quotePackageId: activeQuotePackageId,
    approvalCaseCanSend,
    followUpAt: draft.followUpAt ?? null,
    documentReady,
    taxResolved,
    whyThisMachineRequired,
    whyThisMachineConfirmed: draft.whyThisMachineConfirmed === true,
  });
  const emailReadiness = computeQuoteSendActionReadiness({
    channel: "email",
    quotePackageId: activeQuotePackageId,
    approvalCaseCanSend,
    followUpAt: draft.followUpAt ?? null,
    customerEmail: draft.customerEmail ?? null,
    documentReady,
    taxResolved,
    whyThisMachineRequired,
    whyThisMachineConfirmed: draft.whyThisMachineConfirmed === true,
  });
  const textReadiness = computeQuoteSendActionReadiness({
    channel: "text",
    quotePackageId: activeQuotePackageId,
    approvalCaseCanSend,
    followUpAt: draft.followUpAt ?? null,
    customerPhone: draft.customerPhone ?? null,
    documentReady,
    taxResolved,
    whyThisMachineRequired,
    whyThisMachineConfirmed: draft.whyThisMachineConfirmed === true,
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

  const primaryActionLabel =
    saveMutation.isPending || submitApprovalMutation.isPending
      ? "Working..."
      : quoteStatus === "sent" || quoteStatus === "accepted"
        ? "Update"
        : approvalCaseCanSend && packetReadiness.send.ready
          ? "Review & Send"
          : canSubmitForApproval
            ? "Submit Approval"
            : "Save Draft";
  const primaryActionDisabled =
    saveMutation.isPending
    || submitApprovalMutation.isPending
    || (!packetReadiness.draft.ready && primaryActionLabel !== "Review & Send");
  const previousWizardStep = resolvePreviousWizardStep(currentWizardStepNumber);
  const nextWizardStep = resolveNextWizardStep(currentWizardStepNumber);
  const nextWizardLabel = nextWizardStep ? STEP_LABELS[nextWizardStep] : null;
  const wizardNextDisabled =
    !nextWizardStep
    || (step === "customer" && !hasCustomer)
    || (step === "equipment" && !equipmentCanContinue)
    || (step === "document" && !documentReady);
  const wizardNextHelp = step === "customer" && !hasCustomer
    ? "Pick a customer or use Quote for prospect first."
    : step === "equipment" && !equipmentCanContinue
      ? "Select equipment and resolve source-required availability first."
      : step === "document" && !documentReady
        ? "Generate the document preview before send/log."
        : "Completed steps stay editable — click any finished step below to jump back.";
  const pricingWizardIndex = findWizardStepIndex("pricing");
  const wizardMaxStepIndex0 = wizardMaxStepIndex0FromDraft(draft.wizardStep);
  const wizardCurrentIndex0 = findWizardStepIndex(step);
  const wizardReachableMaxIndex0Value = wizardReachableMaxIndex0(wizardMaxStepIndex0, wizardCurrentIndex0);
  const wizardPricingJumpAllowed =
    signalsReady
    && canJumpToWizardIndex(pricingWizardIndex, wizardReachableMaxIndex0Value)
    && step !== "pricing";

  function handleQuoteForProspect(): void {
    setDraft((cur) => ({
      ...cur,
      customerName:    cur.customerName    || "Walk-in prospect",
      customerCompany: cur.customerCompany || "Walk-in prospect",
      contactId:       undefined,
      companyId:       undefined,
      customerSignals: null,
      customerWarmth:  cur.customerWarmth ?? "new",
    }));
    setStep("equipment");
  }

  const wizardStateValue = useMemo<WizardStateValue>(() => ({
    step,
    setStep,
    previousWizardStep,
    nextWizardStep,
    currentWizardStepNumber,
    maxCompletedStepIndex: wizardMaxStepIndex0,
    reachableMaxStepIndex: wizardReachableMaxIndex0Value,
    draft,
    setDraft,
    activeWorkspaceId,
    activeQuotePackageId,
    autoSaveState,
    setAutoSaveState,
    lastSavedAt,
    setLastSavedAt,
  }), [
    step,
    previousWizardStep,
    nextWizardStep,
    currentWizardStepNumber,
    wizardMaxStepIndex0,
    wizardReachableMaxIndex0Value,
    draft,
    activeWorkspaceId,
    activeQuotePackageId,
    autoSaveState,
    lastSavedAt,
  ]);

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
        onVoiceRecorded={(audioBlob, fileName) => voiceMutation.mutate({ blob: audioBlob, fileName })}
        voiceMutationPending={voiceMutation.isPending}
        onBuildWithAi={(prompt) => aiIntakeMutation.mutate(prompt)}
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
