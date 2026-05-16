import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Mic,
  FileText,
  FileDown,
  ArrowRight,
  ArrowLeft,
  Save,
  MapPin,
  Loader2,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Link2,
  Mail,
  PackagePlus,
  Printer,
  Send,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import { CustomerIntelPanel } from "../components/CustomerIntelPanel";
import { CustomerSection } from "../components/CustomerSection";
import { PointShootTradeCard } from "../components/PointShootTradeCard";
import { TradeInInputCard } from "../components/TradeInInputCard";
import { WinProbabilityStrip } from "../components/WinProbabilityStrip";
import { getMarginBaseline } from "../lib/coach-api";
import { computeWinProbability } from "../lib/win-probability-scorer";
import {
  computeRetrospectiveShadows,
  computeShadowAgreementSummary,
} from "../lib/retrospective-shadow";
import { hydrateCustomerById } from "../lib/customer-search-api";
import { IntelligencePanel } from "../components/IntelligencePanel";
import { EquipmentSelector } from "../components/EquipmentSelector";
import { PackageItemSearchDialog } from "../components/PackageItemSearchDialog";
import { FinancingCalculator } from "../components/FinancingCalculator";
import { DealCoachSidebar } from "../components/DealCoachSidebar";
import { QuoteReviewWorkflowPanels } from "../components/QuoteReviewWorkflowPanels";
import { SendQuoteSection } from "../components/SendQuoteSection";
import { TaxBreakdown } from "../components/TaxBreakdown";
import { MarginFloorGate } from "../components/MarginFloorGate";
import { useAuth } from "@/hooks/useAuth";
import {
  getApplicableThreshold,
  isUnderThreshold,
  logMarginException,
} from "@/features/admin/lib/pricing-discipline-api";
import { MarginCheckBanner } from "../components/MarginCheckBanner";
import { TradeInSection } from "../components/TradeInSection";
import {
  buildQuoteSavePayload,
  getAiEquipmentRecommendation,
  getClosedDealsAudit,
  getCrmEquipmentQuoteSeed,
  getFactorVerdicts,
  getSavedQuotePackage,
  listQuoteAvailabilityRequests,
  logQuoteDeliveryEvent,
  persistQuoteDocumentArtifact,
  requestQuoteAvailability,
  saveQuotePackage,
  searchCatalog,
  sendQuotePackage,
  submitQuoteForApproval,
  type QuoteAvailabilityRequest,
  type QuotePackageCatalogItem,
  type QuotePackageCatalogKind,
  type QuotePackageSaveResponse,
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
import { useDraftAutosave } from "../hooks/useDraftAutosave";
import { useLiveMargin } from "../hooks/useLiveMargin";
import { usePdiAutofill } from "../hooks/usePdiAutofill";
import {
  applyEquipmentOverridePrice,
  equipmentSystemBasePrice,
} from "../lib/equipment-override-price";
import { hydrateDraftFromSavedQuote } from "../lib/saved-quote-draft";
import { buildCatalogQueryCandidates } from "../lib/catalog-query-candidates";
import {
  buildLocalDraftKey,
  clearLocalDraft,
  isDraftEmpty,
  loadLocalDraft,
  saveLocalDraft,
} from "../lib/local-draft";
import { useActiveBranches, useBranchBySlug } from "@/hooks/useBranches";
import { useQuotePDF } from "../hooks/useQuotePDF";
import { useQuoteFinancingPreview } from "../hooks/useQuoteFinancingPreview";
import { useQuoteTaxPreview } from "../hooks/useQuoteTaxPreview";
import { buildCustomFinanceScenario } from "../lib/custom-finance";
import { buildQuoteProposalData, isSafeProposalMediaUrl } from "../lib/quote-proposal-data";
import { getTradeValuationProposalSnapshot } from "../lib/point-shoot-trade-api";
import { buildQuotePdfBranch } from "../lib/quote-builder-page-normalizers";
import { AskIronAdvisorButton } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { VoiceRecorder } from "@/features/voice-qrm/components/VoiceRecorder";
import { submitVoiceToQrm } from "@/features/voice-qrm/lib/voice-qrm-api";
import {
  clearVoiceQuoteHandoff,
  readVoiceQuoteHandoff,
} from "@/features/voice-quote/lib/voice-quote-handoff";
import {
  clearIronQuoteHandoff,
  normalizeIronQuoteHandoff,
  readIronQuoteHandoff,
  type IronQuoteHandoff,
} from "../lib/iron-quote-handoff";
import { toast } from "@/hooks/use-toast";
import {
  ConversationalDealEngine,
  DealAssistantTrigger,
  type ScenarioSelection,
} from "../components/ConversationalDealEngine";
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
  WIZARD_STEPS,
  WIZARD_STEP_IDS,
  isWizardStepId,
  stepForWizardIndex,
  wizardIndexForStep,
  type AutoSaveState,
  type Step,
} from "../wizard/wizard-types";
import {
  WizardStateProvider,
  type WizardStateValue,
} from "../wizard/WizardStateProvider";
import {
  STEP_STORAGE_PREFIX,
  persistStep,
  readPersistedStep,
} from "../wizard/wizard-storage";
import { QuoteWizardProgress } from "../wizard/WizardProgress";
import {
  canJumpToWizardIndex,
  findWizardStepIndex,
  nextWizardStep as resolveNextWizardStep,
  previousWizardStep as resolvePreviousWizardStep,
  wizardMaxStepIndex0FromDraft,
  wizardReachableMaxIndex0,
} from "../wizard/wizard-navigation";
import { IntakeInput } from "../wizard/IntakeInput";
import { CustomerStep } from "../steps/CustomerStep";
import { EquipmentStep } from "../steps/EquipmentStep";
import { ConfigureStep } from "../steps/ConfigureStep";
import { TradeInStep } from "../steps/TradeInStep";
import { PricingStep } from "../steps/PricingStep";
import { PromotionsStep } from "../steps/PromotionsStep";
import { FinancingStep } from "../steps/FinancingStep";
import { DetailsStep } from "../steps/DetailsStep";
import { ReviewStep } from "../steps/ReviewStep";
import { DocumentStep } from "../steps/DocumentStep";
import { SendStep } from "../steps/SendStep";
import { ReadinessRow } from "../components/ReadinessRow";
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
import { money } from "../lib/money";
import {
  EMPTY_TRADE_CAPTURE,
  TRADE_CHECKLIST_ITEMS,
  type TradeCaptureDraft,
  type TradeChecklistKey,
} from "../lib/trade-checklist";

// Item 2: the salesperson-facing flow is now the QRM 11-step wizard.
// Steps 10–11 persist generated document artifacts and use the guarded
// backend email route; text delivery remains gated by Twilio provisioning.
// Step / WizardStepMeta / WIZARD_STEPS / WIZARD_STEP_IDS / STEP_LABELS /
// isWizardStepId / wizardIndexForStep / stepForWizardIndex live in
// `../wizard/wizard-types`. STEP_STORAGE_PREFIX / readPersistedStep /
// persistStep live in `../wizard/wizard-storage`. Page-local types only
// from here down.
type BuilderMode = "workspace" | "guided";

function readinessChipLabel(missing: string): string {
  if (missing.includes("customer-facing equipment")) return "Visible machine";
  if (missing.includes("equipment selection")) return "Equipment";
  if (missing.includes("customer or prospect")) return "Customer";
  if (missing.includes("branch")) return "Branch";
  if (missing.includes("email")) return "Email";
  if (missing.includes("customer")) return "Customer";
  return missing;
}

type EquipmentAvailabilityStatus = "in_stock" | "in_transit" | "source_required";
interface CatalogEntryMatch {
  id?: string;
  sourceCatalog?: QuoteLineItemDraft["sourceCatalog"];
  sourceId?: string | null;
  dealerCost?: number | null;
  make: string;
  model: string;
  year: number | null;
  list_price?: number | null;
  stock_number?: string | null;
  serial_number?: string | null;
  condition?: string | null;
  warranty_text?: string | null;
  long_description?: string | null;
  spec_bullets?: string[] | null;
  photo_url?: string | null;
  photo_urls?: string[] | null;
  vendor_logo_url?: string | null;
  media_source?: string | null;
  media_source_id?: string | null;
  media_kind?: string | null;
  availabilityStatus?: EquipmentAvailabilityStatus;
  availability_status?: EquipmentAvailabilityStatus;
  /** ISO yard/stock receipt — forwarded to line metadata for approval bypass (stock age). */
  received_at?: string | null;
  /** When true, sets `metadata.hot_list` for approval bypass rules that require it. */
  hot_list?: boolean;
  attachments?: Array<{ id: string; name: string; price: number }>;
}

interface CatalogAttachmentMatch {
  id: string;
  name: string;
  price: number;
  brandName?: string | null;
  category?: string | null;
  universal?: boolean;
}

function availabilityStatusForEntry(entry: Pick<CatalogEntryMatch, "stock_number" | "condition" | "availabilityStatus" | "availability_status">): EquipmentAvailabilityStatus {
  if (entry.availabilityStatus) return entry.availabilityStatus;
  if (entry.availability_status) return entry.availability_status;
  const condition = entry.condition?.toLowerCase() ?? "";
  if (condition.includes("transit")) return "in_transit";
  if (entry.stock_number) return "in_stock";
  return "source_required";
}

function availabilityStatusForLine(item: QuoteLineItemDraft): EquipmentAvailabilityStatus {
  const raw = item.metadata?.availability_status;
  return raw === "in_stock" || raw === "in_transit" || raw === "source_required"
    ? raw
    : "source_required";
}

function availabilityLabel(status: EquipmentAvailabilityStatus): string {
  if (status === "in_stock") return "In stock";
  if (status === "in_transit") return "In transit";
  return "Source required";
}

function safeCatalogMediaUrl(value: unknown): string | null {
  return isSafeProposalMediaUrl(value) ? value.trim() : null;
}

function safeCatalogMediaUrls(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    const safe = safeCatalogMediaUrl(item);
    if (!safe || seen.has(safe)) return [];
    seen.add(safe);
    return [safe];
  });
}

function mediaKindForEntry(entry: CatalogEntryMatch): string | undefined {
  if (entry.media_kind) return entry.media_kind;
  if (entry.sourceCatalog === "catalog_entries" || entry.stock_number || entry.serial_number) return "actual";
  if (entry.photo_url || (entry.photo_urls?.length ?? 0) > 0) return "model_generic";
  return undefined;
}

function metadataForCatalogEntry(entry: CatalogEntryMatch): Record<string, unknown> {
  const photoUrls = safeCatalogMediaUrls(entry.photo_urls);
  const primaryPhotoUrl = safeCatalogMediaUrl(entry.photo_url) ?? photoUrls[0] ?? null;
  const allPhotoUrls = primaryPhotoUrl
    ? [primaryPhotoUrl, ...photoUrls.filter((url) => url !== primaryPhotoUrl)]
    : photoUrls;
  const vendorLogoUrl = safeCatalogMediaUrl(entry.vendor_logo_url);
  const metadata: Record<string, unknown> = {
    availability_status: availabilityStatusForEntry(entry),
    stock_number: entry.stock_number ?? null,
    serial_number: entry.serial_number ?? null,
    condition: entry.condition ?? null,
    media_source: entry.media_source ?? (entry.sourceCatalog === "catalog_entries" ? "crm_equipment" : entry.sourceCatalog ?? "qb_equipment_models"),
    media_source_id: entry.media_source_id ?? entry.sourceId ?? entry.id ?? null,
  };
  if (primaryPhotoUrl) metadata.photo_url = primaryPhotoUrl;
  if (allPhotoUrls.length > 0) metadata.photo_urls = allPhotoUrls;
  if (vendorLogoUrl) metadata.vendor_logo_url = vendorLogoUrl;
  if (entry.warranty_text) metadata.warranty_text = entry.warranty_text;
  if (entry.long_description) metadata.long_description = entry.long_description;
  if (entry.spec_bullets?.length) metadata.spec_bullets = entry.spec_bullets.filter(Boolean).slice(0, 8);
  const mediaKind = mediaKindForEntry(entry);
  if (mediaKind) metadata.media_kind = mediaKind;
  if (typeof entry.received_at === "string" && entry.received_at.trim().length > 0) {
    metadata.received_at = entry.received_at.trim();
  }
  if (entry.hot_list === true) {
    metadata.hot_list = true;
  }
  return metadata;
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function availabilityClientLineKey(item: QuoteLineItemDraft, index: number): string {
  return [
    item.sourceCatalog ?? item.kind,
    item.sourceId ?? item.id ?? item.title,
    item.make ?? "",
    item.model ?? "",
    item.year ?? "",
    index,
  ].join("|");
}

function availabilityRequestIdForLine(item: QuoteLineItemDraft): string | null {
  return metadataString(item.metadata, "availability_request_id");
}

function availabilityRequestStatusForLine(item: QuoteLineItemDraft): string | null {
  return metadataString(item.metadata, "availability_request_status");
}

function availabilityRequestCreatedAtForLine(item: QuoteLineItemDraft): string | null {
  return metadataString(item.metadata, "availability_confirmation_requested_at");
}

function availabilityRequestLabel(status: string | null): string {
  if (status === "available") return "Available";
  if (status === "available_with_conditions") return "Available with conditions";
  if (status === "alternative_recommended") return "Alternative ready";
  if (status === "not_available") return "Unavailable";
  if (status === "checking_internal_inventory") return "Checking inventory";
  if (status === "checking_vendor") return "Checking vendor";
  if (status === "pending") return "Availability pending";
  return "Request sent";
}

function buildEquipmentLine(entry: CatalogEntryMatch): QuoteLineItemDraft {
  const metadata = metadataForCatalogEntry(entry);
  if (typeof entry.list_price === "number" && Number.isFinite(entry.list_price)) {
    metadata.system_base_unit_price = entry.list_price;
  }
  return {
    kind: "equipment",
    id: entry.id,
    sourceCatalog: entry.sourceCatalog ?? "qb_equipment_models",
    sourceId: entry.sourceId ?? entry.id ?? null,
    dealerCost: entry.dealerCost ?? null,
    title: `${entry.make} ${entry.model}`,
    make: entry.make,
    model: entry.model,
    year: entry.year,
    quantity: 1,
    unitPrice: entry.list_price ?? 0,
    metadata,
  };
}

// QEP governance: Download PDF / Send Quote / Share Link are locked
// until the quote reaches an approved state via the owner-tier review
// (Ryan + Rylee McKenzie). Draft, pending_approval, changes_requested,
// and rejected quotes can't be distributed to a customer.
export function isQuoteApprovedForDistribution(status: string | null | undefined): boolean {
  return status === "approved"
    || status === "approved_with_conditions"
    || status === "sent"
    || status === "accepted";
}

function equipmentKeyForLine(item: Pick<QuoteLineItemDraft, "id" | "title" | "make" | "model" | "year">): string {
  return [
    item.id ?? "",
    item.title ?? "",
    item.make ?? "",
    item.model ?? "",
    item.year ?? "",
  ].join("|");
}

function normalizeMachineMatchLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function draftHasCustomer(draft: Pick<QuoteWorkspaceDraft, "customerName" | "customerCompany" | "contactId" | "companyId">): boolean {
  return Boolean(
    draft.customerName?.trim() ||
    draft.customerCompany?.trim() ||
    draft.contactId ||
    draft.companyId,
  );
}

function addDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function statusLabel(status: string | null | undefined): string {
  return (status ?? "draft").replace(/_/g, " ");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function splitIronOptionLines(value: string | null): string[] {
  if (!value || value === "none specified") return [];
  const normalized = value
    .replace(/\b(?:and|plus)\b/gi, ",")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return [...new Set(normalized)].slice(0, 8);
}

function buildIronQuoteIntakeSummary(handoff: IronQuoteHandoff): string {
  const lines = [
    `Iron intake: ${handoff.rawText}`,
    handoff.structuredCustomerText ? `Customer: ${handoff.structuredCustomerText}` : null,
    handoff.structuredApplicationText ? `Application/job: ${handoff.structuredApplicationText}` : null,
    handoff.structuredEquipmentText ? `Equipment: ${handoff.structuredEquipmentText}` : null,
    handoff.structuredOptionsText ? `Options/attachments: ${handoff.structuredOptionsText}` : null,
    handoff.structuredTimeframeText ? `Timeframe: ${handoff.structuredTimeframeText}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function buildIronQuoteIntakeEquipmentLine(handoff: IronQuoteHandoff): QuoteLineItemDraft | null {
  if (!handoff.structuredEquipmentText) return null;
  return {
    id: `iron-intake-equipment-${handoff.handoffId}`,
    kind: "equipment",
    sourceCatalog: "manual",
    sourceId: null,
    dealerCost: null,
    title: handoff.structuredEquipmentText,
    quantity: 1,
    unitPrice: 0,
    metadata: {
      source: "iron_quote_intake",
      application_text: handoff.structuredApplicationText,
      options_text: handoff.structuredOptionsText,
      timeframe_text: handoff.structuredTimeframeText,
      price_status: "needs_pricing",
    },
  };
}

function buildIronQuoteIntakeOptionLines(handoff: IronQuoteHandoff): QuoteLineItemDraft[] {
  return splitIronOptionLines(handoff.structuredOptionsText).map((title, index) => ({
    id: `iron-intake-option-${handoff.handoffId}-${index}`,
    kind: "option",
    sourceCatalog: "manual",
    sourceId: null,
    dealerCost: null,
    title,
    quantity: 1,
    unitPrice: 0,
    metadata: {
      source: "iron_quote_intake",
      timeframe_text: handoff.structuredTimeframeText,
      price_status: "needs_pricing",
    },
  }));
}

function appendMissingIronLines(current: QuoteLineItemDraft[], incoming: QuoteLineItemDraft[]): QuoteLineItemDraft[] {
  if (incoming.length === 0) return current;
  const titles = new Set(current.map((item) => item.title.trim().toLowerCase()).filter(Boolean));
  const additions = incoming.filter((item) => !titles.has(item.title.trim().toLowerCase()));
  return additions.length > 0 ? [...current, ...additions] : current;
}

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
  const [builderMode] = useState<BuilderMode>("guided");
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
  const equipmentSeedAppliedRef = useRef<string | null>(null);
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
  const existingQuoteHydrationKeyRef = useRef<string | null>(null);
  const voiceHandoffHydrationKeyRef = useRef<string | null>(null);
  const ironQuoteHandoffHydrationKeyRef = useRef<string | null>(null);

  const existingQuoteQuery = useQuery({
    queryKey: ["quote-builder", "saved-quote", packageId, dealId],
    queryFn: () => getSavedQuotePackage({
      packageId: packageId || undefined,
      dealId: dealId || undefined,
    }),
    enabled: Boolean(packageId || dealId),
    staleTime: 10_000,
  });

  const equipmentSeedQuery = useQuery({
    queryKey: ["quote-builder", "crm-equipment-seed", equipmentId],
    queryFn: () => getCrmEquipmentQuoteSeed(equipmentId),
    enabled: Boolean(equipmentId) && !packageId && !dealId,
    staleTime: 60_000,
  });

  const existingQuote = useMemo(() => {
    const quote = existingQuoteQuery.data?.quote;
    if (quote && typeof quote === "object" && !Array.isArray(quote)) {
      return quote as Record<string, unknown>;
    }
    return null;
  }, [existingQuoteQuery.data?.quote]);

  useEffect(() => {
    const seed = equipmentSeedQuery.data;
    if (!seed) return;
    const seedKey = seed.sourceId || seed.id || equipmentId;
    if (!seedKey || equipmentSeedAppliedRef.current === seedKey) return;

    const nextLine = buildEquipmentLine(seed);
    const nextKey = equipmentKeyForLine(nextLine);
    equipmentSeedAppliedRef.current = seedKey;
    setAvailableOptions(seed.attachments ?? []);
    setAvailableOptionsLabel(`${seed.make} ${seed.model}`.trim() || seed.long_description || "Selected equipment");
    setDraft((current) => ({
      ...current,
      equipment: current.equipment.some((item) => equipmentKeyForLine(item) === nextKey)
        ? current.equipment
        : [...current.equipment, nextLine],
    }));
  }, [equipmentId, equipmentSeedQuery.data]);

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

  useEffect(() => {
    if (draft.branchSlug || branches.length !== 1) return;
    setDraft((current) => current.branchSlug
      ? current
      : { ...current, branchSlug: branches[0]!.slug });
  }, [branches, draft.branchSlug]);

  useEffect(() => {
    if (!existingQuote) return;
    const nextKey =
      (typeof existingQuote.id === "string" && existingQuote.id.length > 0 ? existingQuote.id : "")
      || packageId
      || dealId
      || "__saved_quote__";
    if (existingQuoteHydrationKeyRef.current === nextKey) return;
    existingQuoteHydrationKeyRef.current = nextKey;
    const hydratedDraft = hydrateDraftFromSavedQuote(existingQuote);
    setDraft((current) => ({
      ...current,
      ...hydratedDraft,
      companyId: companyId || hydratedDraft.companyId,
    }));
    setStep(readPersistedStep(nextKey) ?? stepForWizardIndex(hydratedDraft.wizardStep) ?? "review");
  }, [companyId, dealId, existingQuote, packageId]);

  useEffect(() => {
    if (!prospectConverted || !companyId) return;
    if (packageId && (existingQuoteQuery.isLoading || existingQuoteQuery.isFetching)) return;
    let cancelled = false;
    (async () => {
      try {
        const hydrated = await hydrateCustomerById({ companyId });
        if (!hydrated || cancelled) return;
        setDraft((current) => ({
          ...current,
          contactId:       hydrated.contactId ?? current.contactId,
          companyId:       hydrated.companyId ?? companyId,
          customerName:    hydrated.customerName || current.customerName,
          customerCompany: hydrated.customerCompany || current.customerCompany,
          customerPhone:   hydrated.customerPhone || current.customerPhone,
          customerEmail:   hydrated.customerEmail || current.customerEmail,
          customerSignals: hydrated.signals,
          customerWarmth:  hydrated.warmth,
        }));
        const nextStep =
          readPersistedStep(packageId || null)
          ?? stepForWizardIndex(draftRef.current.wizardStep)
          ?? "customer";
        setStep(nextStep);
      } catch {
        // Non-fatal: the company id still persists on next save.
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, existingQuoteQuery.isFetching, existingQuoteQuery.isLoading, packageId, prospectConverted]);

  // Local draft persistence: lets a rep leave the builder mid-entry and
  // resume from the deal page without losing their partial work. DB save
  // requires customer + at least one equipment line, so partial drafts
  // can't be persisted server-side; we keep them in localStorage keyed
  // by (userId, deal/contact). User-scoping prevents shared-device leaks
  // where one rep would see another rep's draft after sign-in. DB quote
  // wins on hydration — local restore only runs when no saved quote
  // exists and we know who the user is.
  const userId = profile?.id ?? "";
  const localDraftKey = useMemo(
    () => userId
      ? buildLocalDraftKey({
        userId,
        dealId: dealId || draft.dealId,
        contactId: contactId || draft.contactId,
      })
      : null,
    [userId, dealId, contactId, draft.dealId, draft.contactId],
  );
  const [localDraftHydrationComplete, setLocalDraftHydrationComplete] = useState(false);
  const [localPersistEnabled, setLocalPersistEnabled] = useState(true);

  useEffect(() => {
    if (localDraftHydrationComplete) return;
    if (!localDraftKey) return;
    if (existingQuoteQuery.isFetching || existingQuoteQuery.isLoading) return;
    if (existingQuote) {
      setLocalDraftHydrationComplete(true);
      return;
    }
    if (ironQuoteHandoffId) {
      setLocalDraftHydrationComplete(true);
      return;
    }
    const stored = loadLocalDraft(localDraftKey);
    if (stored && !isDraftEmpty(stored)) {
      setDraft((current) => ({ ...current, ...stored }));
    }
    setLocalDraftHydrationComplete(true);
  }, [
    existingQuote,
    existingQuoteQuery.isFetching,
    existingQuoteQuery.isLoading,
    ironQuoteHandoffId,
    localDraftHydrationComplete,
    localDraftKey,
  ]);

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

  useEffect(() => {
    const hasTaxJurisdiction = Boolean(draft.branchSlug || draft.deliveryState);
    if (!hasTaxJurisdiction) {
      setDraft((current) => current.taxTotal === 0 ? current : { ...current, taxTotal: 0 });
      return;
    }
    if (manualTaxOverrideReady && typeof draft.taxOverrideAmount === "number") {
      const nextTaxTotal = Math.round(draft.taxOverrideAmount * 100) / 100;
      setDraft((current) => current.taxTotal === nextTaxTotal
        ? current
        : { ...current, taxTotal: nextTaxTotal });
      return;
    }
    if (typeof taxPreviewQuery.data?.total_tax !== "number") return;
    const nextTaxTotal = Math.round(taxPreviewQuery.data.total_tax * 100) / 100;
    setDraft((current) => current.taxTotal === nextTaxTotal
      ? current
      : { ...current, taxTotal: nextTaxTotal });
  }, [draft.branchSlug, draft.deliveryState, draft.taxOverrideAmount, manualTaxOverrideReady, taxPreviewQuery.data?.total_tax]);

  useEffect(() => {
    if (allFinanceScenarios.length === 0) {
      setDraft((current) => current.selectedFinanceScenario == null
        ? current
        : { ...current, selectedFinanceScenario: null });
      return;
    }
    const hasSelected = allFinanceScenarios.some((scenario) => scenario.label === draft.selectedFinanceScenario);
    if (customFinanceScenario) {
      if (draft.selectedFinanceScenario == null || draft.selectedFinanceScenario === "Cash" || !hasSelected) {
        setDraft((current) => ({ ...current, selectedFinanceScenario: customFinanceScenario.label }));
      }
      return;
    }
    if (hasSelected) return;
    setDraft((current) => ({ ...current, selectedFinanceScenario: allFinanceScenarios[0]!.label }));
  }, [allFinanceScenarios, customFinanceScenario, draft.selectedFinanceScenario]);

  // Slice 20a: when QRM deep-links into Quote Builder with ?contact_id= or
  // ?deal_id=, hydrate the customer from CRM so the Customer step renders
  // a real name/company + intel panel on arrival instead of an empty form.
  // Only runs while there is no saved quote to hydrate and no customer is
  // already present, which avoids clobbering rep-entered edits.
  useEffect(() => {
    const hasCustomer = Boolean(
      draft.customerName?.trim() || draft.customerCompany?.trim(),
    );
    if (hasCustomer) return;
    if (existingQuoteQuery.isLoading || existingQuote) return;
    if (!contactId && !companyId && !dealId) return;

    let cancelled = false;
    (async () => {
      try {
        const hydrated = await hydrateCustomerById({
          contactId: contactId || null,
          companyId: companyId || null,
          dealId:    dealId || null,
        });
        if (!hydrated || cancelled) return;
        setDraft((current) => ({
          ...current,
          contactId:       hydrated.contactId ?? current.contactId,
          companyId:       hydrated.companyId ?? current.companyId,
          customerName:    hydrated.customerName,
          customerCompany: hydrated.customerCompany,
          customerPhone:   hydrated.customerPhone,
          customerEmail:   hydrated.customerEmail,
          customerSignals: hydrated.signals,
          customerWarmth:  hydrated.warmth,
        }));
      } catch {
        // Non-fatal — rep can still search/pick manually.
      }
    })();
    return () => { cancelled = true; };
  }, [
    contactId,
    companyId,
    dealId,
    draft.customerCompany,
    draft.customerName,
    existingQuote,
    existingQuoteQuery.isLoading,
  ]);

  // Iron quote intake handoff: a lightweight bridge from Iron's natural-
  // language operator/trainer surface into Quote Builder. Saved quote/deal
  // hydration still wins; this only seeds a new draft with raw intake notes
  // and best-effort customer identity so reps verify customer first, then
  // configure equipment/options/timeframe.
  useEffect(() => {
    if (!ironQuoteHandoffId) return;
    if (packageId || dealId) return;
    if (existingQuoteQuery.isFetching || existingQuoteQuery.isLoading) return;
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
    existingQuoteQuery.isFetching,
    existingQuoteQuery.isLoading,
    ironQuoteHandoffId,
    ironQuoteHandoffState,
    packageId,
  ]);

  // Slice 14: pick up a pending voice-quote handoff only when the URL's
  // voice_session_id matches the sessionStorage payload. Saved quote/deal
  // hydration wins, so advisor/deal launches do not get overwritten by stale
  // browser handoffs.
  useEffect(() => {
    if (!voiceSessionId) return;
    if (packageId || dealId) return;
    if (existingQuoteQuery.isFetching || existingQuoteQuery.isLoading) return;
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
    applyScenarioSelection(handoff, "voice_handoff");
    // applyScenarioSelection is intentionally omitted so this remains keyed
    // only by the stable handoff id, not by render-local function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, existingQuoteQuery.isFetching, existingQuoteQuery.isLoading, packageId, voiceSessionId]);

  const saveMutation = useMutation({
    mutationFn: (): Promise<QuotePackageSaveResponse> => {
      // Slice 20e: capture the rule-based win-probability result at save
      // time so we can show it on list views + build the learning loop
      // later. We compute it here (not from the live strip state) to
      // make sure the persisted snapshot is consistent with the exact
      // draft + context we send to the edge function. Weights are
      // versioned so future scorer rewrites stay diffable against old
      // snapshots.
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
          {
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
          snapshot,
          {
            quotePackageId: persistedQuotePackageIdRef.current ?? (typeof existingQuote?.id === "string" ? existingQuote.id : null),
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
      // DB is authoritative now. Clear the local draft and stop mirroring
      // further edits so a follow-up refresh hydrates from the saved row,
      // not a stale localStorage overlay.
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
  });

  const submitApprovalMutation = useMutation({
    mutationFn: async () => {
      // Auto-save first. Two-click "save then submit" was annoying; one
      // click should do the whole journey. If the quote is already
      // saved we skip the save and go straight to submit. saveMutation
      // surfaces the real Postgres error if something rejects the write,
      // so any failure here cleanly bubbles up to the error banner.
      let quotePackageId = activeQuotePackageId;
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
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "list"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "approval-case", activeQuotePackageId] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "saved-quote"] });
    },
  });

  // Slice 15: margin-floor gate state. The gate blocks the save action
  // when the current margin is below the applicable threshold until the
  // rep provides a one-sentence reason. Threshold is looked up against
  // null brandId for MVP — the workspace default floor. Per-brand
  // lookups hang on the draft's primary equipment brand_id which we
  // don't thread yet; enable later when Slice 09's full migration ships.
  const [marginGateOpen, setMarginGateOpen] = useState(false);
  // Remember which quote+margin combo the rep already justified so we
  // don't keep re-prompting them. Keyed by quote id + margin (rounded to
  // 1 decimal) so editing the quote and making the margin worse re-asks,
  // but a simple re-save at the same margin doesn't. Resets when the
  // loaded quote changes (different rep session).
  const [marginReasonCaptured, setMarginReasonCaptured] = useState<string | null>(null);
  useEffect(() => {
    setMarginReasonCaptured(null);
  }, [existingQuote?.id]);

  function marginKeyFor(quoteId: string | null, marginPctValue: number): string {
    return `${quoteId ?? "new"}|${Math.round(marginPctValue * 10) / 10}`;
  }

  const handleSaveClick = useCallback(async () => {
    // Resolve threshold just-in-time so a new workspace-default created
    // in a sibling tab applies to this session without a refresh. If the
    // admin lookup flakes, don't silently drop the user's save — save the
    // draft and let server-side approval/readiness gates stay authoritative.
    let thresholdPct: number | null = null;
    try {
      const { threshold } = await getApplicableThreshold(null);
      thresholdPct = threshold ? Number(threshold.min_margin_pct) : null;
    } catch (error) {
      console.warn("quote-builder threshold lookup failed; saving without margin gate", error);
    }
    const key = marginKeyFor(
      (saveMutation.data?.quote?.id as string | undefined)
        ?? (typeof existingQuote?.id === "string" ? existingQuote.id : null),
      marginPct,
    );
    // Re-prompting a rep who already captured a reason for the same
    // (quote, margin) pair this session is pure annoyance — it doesn't
    // add audit value. Once captured, a straight save just goes through.
    if (isUnderThreshold(marginPct, thresholdPct) && marginReasonCaptured !== key) {
      setMarginGateOpen(true);
      return;
    }
    saveMutation.mutate();
  }, [existingQuote?.id, marginPct, marginReasonCaptured, saveMutation.data?.quote?.id, saveMutation.mutate]);

  async function handleMarginReasonConfirm(payload: {
    reason: string;
    thresholdPct: number;
    estimatedGapCents: number;
  }) {
    setMarginGateOpen(false);
    // Fire the save first so we have a quote_package_id to attach to the
    // exception. Wait for it, then log the exception; if the save fails,
    // no orphan exception row.
    try {
      const saveResult = await saveMutation.mutateAsync();
      const savedId = saveResult.quote?.id ?? saveResult.id;
      if (!savedId || !profile) return;
      await logMarginException({
        workspaceId:        profile.active_workspace_id ?? "default",
        quotePackageId:     savedId,
        brandId:            null,
        quotedMarginPct:    marginPct,
        thresholdMarginPct: payload.thresholdPct,
        estimatedGapCents:  payload.estimatedGapCents,
        reason:             payload.reason,
        repId:              profile.id,
      });
      // Lock in so subsequent saves at this margin don't re-prompt.
      setMarginReasonCaptured(marginKeyFor(savedId, marginPct));
    } catch {
      // saveMutation.error path handles user-visible feedback.
    }
  }

  const activeQuotePackageId =
    saveMutation.data?.quote?.id
    ?? saveMutation.data?.id
    ?? (typeof existingQuote?.id === "string" ? existingQuote.id : null);
  const activeQuoteRecord = useMemo(() => {
    const saved = saveMutation.data?.quote;
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? (saved as Record<string, unknown>)
      : existingQuote;
  }, [existingQuote, saveMutation.data?.quote]);
  const activeQuoteNumber = typeof activeQuoteRecord?.quote_number === "string" && activeQuoteRecord.quote_number.length > 0
    ? activeQuoteRecord.quote_number
    : null;
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

  useEffect(() => {
    persistStep(activeQuotePackageId, step);
    setDraft((current) => current.wizardStep === Math.max(current.wizardStep ?? 1, currentWizardStepNumber)
      ? current
      : { ...current, wizardStep: Math.max(current.wizardStep ?? 1, currentWizardStepNumber) });
  }, [activeQuotePackageId, currentWizardStepNumber, step]);

  useEffect(() => {
    if (step !== "details" && step !== "send") return;
    setDraft((current) => ({
      ...current,
      expiresAt: current.expiresAt ?? addDaysIso(30),
      followUpAt: current.followUpAt ?? addDaysIso(3),
      whyThisMachine: current.whyThisMachine
        ?? current.recommendation?.reasoning
        ?? current.voiceSummary
        ?? "",
      whyThisMachineConfirmed: current.whyThisMachineConfirmed ?? false,
    }));
  }, [step]);

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

  useEffect(() => {
    if (!documentFallbackGeneratedAt) return;
    if (documentDraftSignatureRef.current === draftSaveSignature) return;
    documentDraftSignatureRef.current = "";
    setDocumentFallbackGeneratedAt(null);
    setDocumentArtifact(null);
  }, [documentFallbackGeneratedAt, draftSaveSignature]);

  useEffect(() => {
    if (!localDraftHydrationComplete) return;
    if (!localPersistEnabled) return;
    if (!localDraftKey) return;
    if (isDraftEmpty(draftRef.current)) {
      clearLocalDraft(localDraftKey);
      return;
    }
    const tid = window.setTimeout(() => {
      const d = draftRef.current;
      if (!localDraftKey || isDraftEmpty(d)) return;
      saveLocalDraft(localDraftKey, d);
    }, 450);
    return () => window.clearTimeout(tid);
  }, [draftSaveSignature, localDraftHydrationComplete, localDraftKey, localPersistEnabled]);

  useEffect(() => {
    if (!localDraftHydrationComplete || !localPersistEnabled || !localDraftKey) return;
    const flush = () => {
      const key = localDraftKey;
      if (!key) return;
      const d = draftRef.current;
      if (!isDraftEmpty(d)) saveLocalDraft(key, d);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [localDraftHydrationComplete, localDraftKey, localPersistEnabled]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!packetReadiness.draft.ready || saveMutation.isPending) return;
      void handleSaveClick();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveClick, packetReadiness.draft.ready, saveMutation.isPending]);

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

  // ── Deal Assistant (Slice 05) ─────────────────────────────────────────────
  // Pre-populate form state when rep selects an AI-generated scenario.
  // Behavior: (a) set equipment from resolved model, (b) store prompt as
  // voiceSummary, (c) advance to equipment step for review — never auto-save.
  const applyScenarioSelection = (
    selection: ScenarioSelection & { at?: string },
    source: ScenarioSelectionSource,
  ) => {
    setDealAssistantOpen(false);
    setDraft((current) => ({
      ...current,
      ...buildScenarioSelectionDraftPatch(current, selection, source),
    }));

    // Slice 20a: land on the Customer step first so the rep picks who the
    // quote is for before confirming the AI-matched equipment.
    setStep("customer");
  };

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

  useEffect(() => {
    if (inboundFreightEligible) return;
    const inboundField = PRICING_ADDER_FIELDS.find((field) => field.id === "inbound_freight");
    if (!inboundField) return;
    const existingInbound = pricingLine(inboundField);
    if (!existingInbound) return;
    upsertPricingLine(inboundField, 0);
  }, [inboundFreightEligible, draft.pricingLines]);

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
      <div className="sticky top-0 z-30 rounded-xl border border-border/70 bg-background/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
              <Link to="/floor"><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to Floor</Link>
            </Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-foreground">{quoteTitle}</p>
                <span className="rounded-full border border-qep-orange/30 bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-qep-orange">
                  {statusLabel(quoteStatus)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {autoSaveState === "saving"
                    ? "Saving..."
                    : autoSaveState === "error"
                      ? "Save failed"
                      : displayedSavedLabel
                        ? `Saved ${displayedSavedLabel}`
                        : autoSaveState === "local"
                          ? "Local draft"
                          : "Not saved"}
                </span>
              </div>
              {packetReadiness.draft.ready ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Cmd-S saves. Auto-save runs every 10 seconds when the draft is server-ready.
                </p>
              ) : packetReadiness.draft.missing.length > 0 ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>Needs:</span>
                  {packetReadiness.draft.missing.map((missing) => (
                    <span
                      key={missing}
                      title={missing}
                      className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-300"
                    >
                      {readinessChipLabel(missing)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-0.5 text-[11px] text-muted-foreground">Start the quote to enable save.</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
            <div className="text-right">
              <p className="font-kpi text-2xl font-extrabold tabular-nums text-qep-orange">
                {money(customerTotal)}
              </p>
              <p className="text-[11px] text-muted-foreground">{financeMethodLabel}</p>
            </div>
            <span className="rounded-lg border border-qep-orange/30 bg-qep-orange/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-qep-orange">
              Guided wizard
            </span>
            <Button onClick={handlePrimaryAction} disabled={primaryActionDisabled}>
              {saveMutation.isPending || submitApprovalMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : approvalCaseCanSend && packetReadiness.send.ready ? (
                <Send className="mr-1 h-4 w-4" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              {primaryActionLabel}
            </Button>
          </div>
        </div>
      </div>

      {builderMode === "workspace" ? (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
          <aside className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Customer</p>
                  <p className="mt-1 text-sm text-muted-foreground">Find the account, capture the need, and keep defaults out of the rep's way.</p>
                </div>
                {hasCustomer ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                    Set
                  </span>
                ) : null}
              </div>

              <div className="mt-4 space-y-4">
                <CustomerSection
                  draft={draft}
                  onPick={(picked) => setDraft((cur) => ({
                    ...cur,
                    contactId:       picked.contactId ?? undefined,
                    companyId:       picked.companyId ?? undefined,
                    customerName:    picked.customerName,
                    customerCompany: picked.customerCompany,
                    customerPhone:   picked.customerPhone,
                    customerEmail:   picked.customerEmail,
                    customerSignals: picked.signals ?? null,
                    customerWarmth:  picked.warmth ?? null,
                  }))}
                  onManualChange={(field, value) => setDraft((cur) => ({ ...cur, [field]: value }))}
                  onClear={() => setDraft((cur) => ({
                    ...cur,
                    contactId:       undefined,
                    companyId:       undefined,
                    customerName:    "",
                    customerCompany: "",
                    customerPhone:   "",
                    customerEmail:   "",
                    customerSignals: null,
                    customerWarmth:  null,
                  }))}
                />

                <label className="block space-y-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Opportunity description</span>
                  <textarea
                    value={draft.voiceSummary ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, voiceSummary: event.target.value }))}
                    placeholder="What is the customer trying to accomplish?"
                    rows={5}
                    className="min-h-[136px] w-full resize-y rounded border border-input bg-card px-3 py-2 text-sm"
                  />
                </label>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Voice capture</span>
                    {voiceMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
                  </div>
                  <VoiceRecorder
                    onRecorded={(audioBlob, fileName) => {
                      setDraft((current) => ({ ...current, entryMode: "voice" }));
                      voiceMutation.mutate({ blob: audioBlob, fileName });
                    }}
                    disabled={voiceMutation.isPending}
                  />
                </div>

                {branches.length > 0 && (
                  <label className="block space-y-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Quoting branch</span>
                    <select
                      value={draft.branchSlug}
                      onChange={(event) => setDraft((current) => ({ ...current, branchSlug: event.target.value }))}
                      className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                    >
                      <option value="">Use branch default...</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.slug}>{branch.display_name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <button
                type="button"
                onClick={() => setDigitalTwinExpanded((value) => !value)}
                className="flex min-h-20 w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-qep-orange">Customer Digital Twin</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {draft.customerSignals
                      ? `${draft.customerSignals.openDeals} open deals, ${draft.customerSignals.pastQuoteCount} past quotes`
                      : "Collapsed until a customer is selected."}
                  </p>
                </div>
                {digitalTwinExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {digitalTwinExpanded && (
                <div className="border-t border-border/60 p-4">
                  <CustomerIntelPanel
                    customerCompany={draft.customerCompany ?? ""}
                    companyId={draft.companyId ?? null}
                    signals={draft.customerSignals ?? null}
                    warmth={draft.customerWarmth ?? null}
                  />
                </div>
              )}
            </Card>
          </aside>

          <main className="space-y-4">
            <Card className="p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Start quote</p>
                <p className="mt-1 text-sm text-muted-foreground">Describe what you want to quote. Type or use the mic in the same intake box.</p>
              </div>
              <IntakeInput
                aiPrompt={aiPrompt}
                onAiPromptChange={setAiPrompt}
                intakeRecorderOpen={intakeRecorderOpen}
                onIntakeRecorderToggle={() => setIntakeRecorderOpen((current) => !current)}
                onEntryModeChange={(mode) => setDraft((cur) => ({ ...cur, entryMode: mode }))}
                onVoiceRecorded={(audioBlob, fileName) => voiceMutation.mutate({ blob: audioBlob, fileName })}
                voiceMutationPending={voiceMutation.isPending}
                onBuildWithAi={(prompt) => aiIntakeMutation.mutate(prompt)}
                aiIntakeMutationPending={aiIntakeMutation.isPending}
                aiIntakeMessage={aiIntakeMessage}
                helperText="Use the mic to capture field notes, then build the quote from one intake stream."
                recorderHeading="Record intake"
                textareaMinHeight="104px"
                buildButtonVariant="icons"
              />
            </Card>

            <Card className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Package</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    One quote, many line items. Single equipment quotes are just a subset.
                    {" "}
                    Use <span className="font-medium text-foreground">Internal only</span> on an attachment row when it should not print on the customer proposal.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setPackageToolsOpen((value) => !value)}>
                  <PackagePlus className="mr-1 h-4 w-4" /> Add item
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                {[...draft.equipment, ...draft.attachments].length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Add equipment to start the package. Attachments, warranty, financing, and custom lines stay in the same package list.
                  </div>
                ) : (
                  <>
                    {draft.equipment.map((item, index) => (
                      <QuoteWorkspaceLineRow
                        key={`equipment-${index}-${item.id ?? item.title}`}
                        label="Equipment"
                        item={item}
                        onPriceChange={(value: number) => setDraft((current) => ({
                          ...current,
                          equipment: current.equipment.map((line, rowIndex) => (
                            rowIndex === index ? applyEquipmentOverridePrice(line, value) : line
                          )),
                        }))}
                        onRemove={() => setDraft((current) => ({
                          ...current,
                          equipment: current.equipment.filter((_, rowIndex) => rowIndex !== index),
                        }))}
                      />
                    ))}
                    {draft.attachments.map((item, index) => (
                      <QuoteWorkspaceLineRow
                        key={`attachment-${index}-${item.id ?? item.title}`}
                        label={item.title.includes(":") ? item.title.split(":")[0] ?? "Attachment" : "Attachment"}
                        item={item}
                        costVisibilityEditable
                        onCostVisibilityChange={(next) => setDraft((current) => ({
                          ...current,
                          attachments: current.attachments.map((line, rowIndex) => (
                            rowIndex === index ? { ...line, costVisibility: next } : line
                          )),
                        }))}
                        onPriceChange={(value: number) => setDraft((current) => ({
                          ...current,
                          attachments: current.attachments.map((line, rowIndex) => rowIndex === index ? { ...line, unitPrice: value } : line),
                        }))}
                        onRemove={() => setDraft((current) => ({
                          ...current,
                          attachments: current.attachments.filter((_, rowIndex) => rowIndex !== index),
                        }))}
                      />
                    ))}
                  </>
                )}
              </div>

              {packageToolsOpen && (
                <div className="mt-4 space-y-4 rounded-lg border border-border/70 bg-background/50 p-3">
                  <EquipmentSelector
                    onSelect={(entry) => {
                      addCatalogEquipment(entry);
                    }}
                    onSelectAttachment={addCatalogAttachment}
                    onRecommendation={(recommendation) => {
                      setDraft((current) => ({ ...current, recommendation }));
                    }}
                    autoLoad
                    title="Package catalog"
                    helper="Add QEP equipment, attachments, or parts without leaving the quote."
                  />

                  {availableOptions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Attachments for {availableOptionsLabel ?? "selected equipment"}
                      </p>
                      {availableOptions.map((option) => {
                        const selected = draft.attachments.some((attachment) => attachment.id === option.id);
                        return (
                          <div key={option.id} className="flex items-center justify-between gap-3 rounded border border-border/60 bg-card/60 px-3 py-2">
                            <div>
                              <p className="text-sm font-medium text-foreground">{option.name}</p>
                              <p className="text-xs text-muted-foreground">{money(option.price)}</p>
                            </div>
                            <Button
                              size="sm"
                              variant={selected ? "outline" : "default"}
                              onClick={() => setDraft((current) => ({
                                ...current,
                                attachments: selected
                                  ? current.attachments.filter((attachment) => attachment.id !== option.id)
                                  : [...current.attachments, {
                                    kind: "attachment",
                                    id: option.id,
                                    sourceCatalog: "qb_attachments",
                                    sourceId: option.id,
                                    dealerCost: null,
                                    title: option.name,
                                    quantity: 1,
                                    unitPrice: option.price,
                                  }],
                              }))}
                            >
                              {selected ? "Remove" : "Add"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid gap-2 md:grid-cols-[1fr_140px_auto_auto_auto]">
                    <input
                      value={customLineTitle}
                      onChange={(event) => setCustomLineTitle(event.target.value)}
                      placeholder="Custom, warranty, or financing line"
                      className="rounded border border-input bg-card px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={customLinePrice}
                      onChange={(event) => setCustomLinePrice(Number(event.target.value) || 0)}
                      className="rounded border border-input bg-card px-3 py-2 text-sm"
                    />
                    <Button size="sm" variant="outline" onClick={() => handleAddCustomLine("Warranty")}>Warranty</Button>
                    <Button size="sm" variant="outline" onClick={() => handleAddCustomLine("Financing")}>Financing</Button>
                    <Button size="sm" onClick={() => handleAddCustomLine("Custom")}>Custom</Button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <button
                type="button"
                onClick={() => setTradeExpanded((value) => !value)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Trade</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {draft.tradeAllowance > 0 ? `${money(draft.tradeAllowance)} trade credit applied` : "Collapsed by default. Snap photo, add manually, or mark no trade."}
                  </p>
                </div>
                {tradeExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {tradeExpanded && (
                <div className="space-y-4 border-t border-border/60 p-4">
                  <PointShootTradeCard
                    dealId={draft.dealId ?? null}
                    appliedAllowanceDollars={draft.tradeAllowance || null}
                    appliedValuationSnapshot={tradeValuationProposalQuery.data ?? null}
                    onApply={handlePointShootTradeApply}
                    onClear={() => setDraft((cur) => ({
                      ...cur,
                      tradeAllowance: 0,
                      tradeValuationId: null,
                    }))}
                  />
                  <TradeInInputCard
                    tradeAllowance={draft.tradeAllowance}
                    onChange={(value) => setDraft((current) => ({
                      ...current,
                      tradeAllowance: value,
                      tradeValuationId: null,
                    }))}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft((current) => ({ ...current, tradeAllowance: 0, tradeValuationId: null }))}
                  >
                    No Trade
                  </Button>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <button
                type="button"
                onClick={() => setTermsExpanded((value) => !value)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Commercial Terms</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Discount {money(discountTotal)} · Tax {money(taxTotal)} · Down {money(cashDown)}
                  </p>
                </div>
                {termsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {termsExpanded && (
                <div className="border-t border-border/60 p-4">
                  <FinancingCalculator
                    discountType={draft.commercialDiscountType}
                    discountValue={draft.commercialDiscountValue}
                    cashDown={draft.cashDown}
                    tradeAllowance={draft.tradeAllowance}
                    taxProfile={draft.taxProfile}
                    packageSubtotal={subtotal}
                    discountTotal={discountTotal}
                    discountedSubtotal={discountedSubtotal}
                    netTotal={netTotal}
                    taxTotal={taxTotal}
                    customerTotal={customerTotal}
                    amountFinanced={amountFinanced}
                    taxBreakdown={taxPreviewQuery.data}
                    taxLoading={taxPreviewQuery.isLoading}
                    taxError={taxPreviewQuery.isError}
                    taxEnabled={Boolean(draft.branchSlug || draft.deliveryState)}
                    financeScenarios={allFinanceScenarios}
                    financeLoading={financingPreviewQuery.isLoading}
                    financeError={financingPreviewQuery.isError}
                    selectedScenario={draft.selectedFinanceScenario}
                    customFinanceEnabled={customFinanceEnabled}
                    customFinanceRate={customFinanceRate}
                    customFinanceTermMonths={customFinanceTermMonths}
                    customFinancePreview={customFinanceScenario}
                    taxProfiles={taxProfiles}
                    onDiscountTypeChange={(value) => setDraft((current) => ({ ...current, commercialDiscountType: value }))}
                    onDiscountValueChange={(value) => setDraft((current) => ({ ...current, commercialDiscountValue: value }))}
                    onCashDownChange={(value) => setDraft((current) => ({ ...current, cashDown: value }))}
                    onTaxProfileChange={(value) => setDraft((current) => ({ ...current, taxProfile: value }))}
                    onSelectScenario={(label) => setDraft((current) => ({ ...current, selectedFinanceScenario: label }))}
                    onCustomFinanceEnabledChange={setCustomFinanceEnabled}
                    onCustomFinanceRateChange={setCustomFinanceRate}
                    onCustomFinanceTermMonthsChange={setCustomFinanceTermMonths}
                  />
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <button
                type="button"
                onClick={() => setMarginWaterfallExpanded((value) => !value)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Margin Waterfall</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Margin {marginPct.toFixed(1)}% · {money(marginAmount)} estimated net margin
                  </p>
                </div>
                {marginWaterfallExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {marginWaterfallExpanded && (
                <div className="border-t border-border/60 p-4">
                  <MarginCheckBanner
                    marginPct={marginPct}
                    waterfall={{
                      equipmentTotal: subtotal,
                      dealerCost,
                      tradeAllowance: draft.tradeAllowance,
                      netTotal,
                      marginAmount,
                    }}
                  />
                </div>
              )}
            </Card>
          </main>

          <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
            <Card className="p-3">
              <button
                type="button"
                onClick={() => setDealAssistantOpen(true)}
                aria-label="Open quote copilot chat drawer"
                title="Open quote copilot chat drawer"
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition hover:border-qep-orange/50 hover:text-foreground"
              >
                <Sparkles className="h-4 w-4 text-qep-orange" />
                <span className="min-w-0 flex-1 truncate">Ask about this quote...</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Chat drawer</span>
              </button>
            </Card>

            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Signals</p>
              <div className="mt-3">
                {signalsReady ? (
                  <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} closedHistory={shadowHistory} shadowCalibration={shadowCalibration} />
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-background/40 p-3 text-xs text-muted-foreground">
                    Score available once quote has customer + equipment.
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {!hasCustomer && (
                        <span className="rounded-full border border-border/70 px-2 py-0.5">Customer needed</span>
                      )}
                      {!hasEquipmentLine && (
                        <span className="rounded-full border border-border/70 px-2 py-0.5">Equipment needed</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Suggestions</p>
              {draft.recommendation?.machine ? (
                <div className="mt-3 rounded-lg border border-qep-orange/25 bg-qep-orange/5 p-3">
                  <p className="text-sm font-semibold text-foreground">{draft.recommendation.machine}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{draft.recommendation.reasoning}</p>
                  <p className="mt-3 rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
                    Trigger: {draft.recommendation.trigger?.sourceField
                      ? draft.recommendation.trigger.sourceField.replace(/_/g, " ")
                      : draft.entryMode === "voice"
                        ? "voice transcript"
                        : draft.entryMode === "ai_chat"
                          ? "AI chat prompt"
                          : "intake prompt"}
                    {draft.recommendation.trigger?.excerpt ? ` - "${draft.recommendation.trigger.excerpt}"` : ""}
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      if (!draft.recommendation?.machine) return;
                      void addRecommendedMachine(draft.recommendation.machine);
                    }}
                  >
                    Select Recommended
                  </Button>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Empty until a voice note, AI prompt, or quote event creates a real trigger.
                </div>
              )}
            </Card>

            <DealCoachSidebar
              draft={draft}
              computed={{ equipmentTotal, attachmentTotal, subtotal, netTotal, marginAmount, marginPct }}
              quotePackageId={activeQuotePackageId}
            />
          </aside>
        </div>
      ) : (
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

        {existingQuoteQuery.isError && (
          <Card className="border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm text-red-300">
              {existingQuoteQuery.error instanceof Error
                ? existingQuoteQuery.error.message
                : "Unable to load the saved quote."}
            </p>
          </Card>
        )}

        {!existingQuoteQuery.isError && existingQuote && (
          <Card className="border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-sm text-blue-300">
              Editing saved quote{typeof existingQuote.quote_number === "string" && existingQuote.quote_number
                ? ` ${existingQuote.quote_number}`
                : ""}. Update any step below, then save to keep working in the same quote.
            </p>
          </Card>
        )}

        <Card className="border-border/70 bg-card/80 p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-end">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-qep-orange/10 px-3 py-1 text-xs font-semibold text-qep-orange">
                  Step {currentWizardStepNumber} of {WIZARD_STEPS.length}
                </span>
                <span className="text-sm font-semibold text-foreground">{STEP_LABELS[step]}</span>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground" role="status" aria-live="polite">
                {signalsReady ? (
                  <>
                    <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Live margin </span>
                    <span className="font-semibold text-foreground">{marginPct.toFixed(1)}%</span>
                    <span> · </span>
                    <span className="font-semibold text-foreground">{money(marginAmount)}</span>
                    <span> est. net</span>
                  </>
                ) : (
                  "Live margin updates once this quote has a customer and at least one machine."
                )}
              </p>
              {wizardPricingJumpAllowed ? (
                <Button type="button" variant="link" title="Open step 5 — Pricing build" className="h-auto justify-start p-0 text-xs font-semibold text-qep-orange" onClick={() => setStep("pricing")}>
                  Pricing →
                </Button>
              ) : null}
              {branches.length > 0 && (
                <label className="block max-w-xl space-y-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Quoting branch</span>
                  <select
                    value={draft.branchSlug}
                    onChange={(event) => setDraft((current) => ({ ...current, branchSlug: event.target.value }))}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-qep-orange focus:outline-none focus:ring-2 focus:ring-qep-orange/30"
                  >
                    <option value="">Select quoting branch…</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.slug}>{branch.display_name}</option>
                    ))}
                  </select>
                </label>
              )}
              <p className="text-xs text-muted-foreground">{wizardNextHelp}</p>
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
              {previousWizardStep && (
                <Button variant="outline" className="hidden touch-manipulation md:inline-flex" onClick={() => setStep(previousWizardStep)}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Back
                </Button>
              )}
              {step === "customer" && !hasCustomer && (
                <Button variant="ghost" className="touch-manipulation" onClick={handleQuoteForProspect}>
                  Quote for prospect
                </Button>
              )}
              {nextWizardStep && (
                <Button className="hidden touch-manipulation md:inline-flex" onClick={() => setStep(nextWizardStep)} disabled={wizardNextDisabled}>
                  {nextWizardLabel} <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </Card>

      <QuoteWizardProgress
        steps={WIZARD_STEPS}
        currentStep={step}
        maxCompletedStepIndex={wizardMaxStepIndex0}
        compact
        onJumpTo={setStep}
      />

      <div className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom,0px))] z-20 flex touch-manipulation flex-col gap-2 rounded-xl border border-border/70 bg-card/95 p-3 shadow-md backdrop-blur md:hidden">
        {signalsReady ? (
          <p className="text-center text-[10px] leading-tight text-muted-foreground" role="status" aria-live="polite">
            <span className="font-semibold text-foreground">{marginPct.toFixed(1)}%</span>
            {" · "}
            <span className="font-semibold text-foreground">{money(marginAmount)}</span>
            <span> net</span>
          </p>
        ) : null}
        {wizardPricingJumpAllowed ? (
          <Button type="button" variant="outline" size="sm" className="h-7 w-full touch-manipulation text-[10px] font-semibold" title="Open step 5 — Pricing build" onClick={() => setStep("pricing")}>
            Pricing
          </Button>
        ) : null}
        <div className={`flex gap-2 ${previousWizardStep && nextWizardStep ? "" : "flex-col sm:flex-row"}`}>
          {previousWizardStep ? (
            <Button
              type="button"
              variant="outline"
              className={nextWizardStep ? "min-w-0 flex-1 touch-manipulation" : "w-full touch-manipulation"}
              onClick={() => setStep(previousWizardStep)}
            >
              <ArrowLeft className="mr-1 h-4 w-4 shrink-0" /> Back
            </Button>
          ) : (
            nextWizardStep ? <span className="flex-1" aria-hidden="true" /> : null
          )}
          {nextWizardStep ? (
            <Button
              type="button"
              className={previousWizardStep ? "min-w-0 flex-1 touch-manipulation" : "w-full touch-manipulation"}
              onClick={() => setStep(nextWizardStep)}
              disabled={wizardNextDisabled}
            >
              <span className="truncate">{nextWizardLabel}</span>
              <ArrowRight className="ml-1 h-4 w-4 shrink-0" />
            </Button>
          ) : null}
        </div>
        {step === "customer" && !hasCustomer ? (
          <Button type="button" variant="outline" className="w-full touch-manipulation" onClick={handleQuoteForProspect}>
            Quote for prospect
          </Button>
        ) : null}
      </div>

      {step === "customer" && (
        <CustomerStep
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
        />
      )}

      {step === "equipment" && (
        <EquipmentStep
          winProbContext={winProbContext}
          factorVerdicts={factorVerdicts}
          shadowHistory={shadowHistory}
          shadowCalibration={shadowCalibration}
          intelligencePanel={intelligencePanel}
          onEquipmentCatalogSelect={(entry) => {
            setAvailableOptions(entry.attachments ?? []);
            setAvailableOptionsLabel(`${entry.make} ${entry.model}`);
            const nextLine: QuoteLineItemDraft = {
              kind: "equipment",
              id: entry.id,
              sourceCatalog: entry.sourceCatalog ?? "qb_equipment_models",
              sourceId: entry.sourceId ?? entry.id ?? null,
              dealerCost: entry.dealerCost ?? null,
              title: `${entry.make} ${entry.model}`.trim(),
              make: entry.make,
              model: entry.model,
              year: entry.year,
              quantity: 1,
              unitPrice: entry.list_price || 0,
              metadata: metadataForCatalogEntry(entry),
            };
            const nextKey = equipmentKeyForLine(nextLine);
            setDraft((current) => ({
              ...current,
              equipment: current.equipment.some((item) => equipmentKeyForLine(item) === nextKey)
                ? current.equipment
                : [...current.equipment, nextLine],
            }));
          }}
          onEquipmentRecommendation={(recommendation) => {
            setDraft((current) => ({ ...current, recommendation }));
          }}
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
        />
      )}

      {step === "configure" && (
        <ConfigureStep
          configureTab={configureTab}
          setConfigureTab={setConfigureTab}
          availableOptions={availableOptions}
          availableOptionsLabel={availableOptionsLabel}
          setPackageItemSearchOpen={setPackageItemSearchOpen}
          customLineTitle={customLineTitle}
          setCustomLineTitle={setCustomLineTitle}
          customLinePrice={customLinePrice}
          setCustomLinePrice={setCustomLinePrice}
          addConfigLine={addConfigLine}
        />
      )}

      {step === "tradeIn" && (
        <TradeInStep
          appliedValuationSnapshot={tradeValuationProposalQuery.data ?? null}
          onPointShootApply={handlePointShootTradeApply}
          tradeChecklist={tradeChecklist}
          tradeCapture={tradeCapture}
          tradeManagerApprovalRequired={tradeManagerApprovalRequired}
          onOpenTradeCapture={(key) => {
            setActiveTradeCaptureKey(key);
            setTradeCaptureOpen(true);
          }}
        />
      )}

      {step === "pricing" && (
        <PricingStep
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
        />
      )}

      {step === "promotions" && (
        <PromotionsStep activeQuotePackageId={activeQuotePackageId} />
      )}

      {step === "financing" && (
        <FinancingStep
          allFinanceScenarios={allFinanceScenarios}
          customerTotal={customerTotal}
          cashDown={cashDown}
          amountFinanced={amountFinanced}
          financingPreviewLoading={financingPreviewQuery.isLoading}
          financingPreviewError={financingPreviewQuery.isError}
          leaseQuotingEnabled={leaseQuotingEnabled}
        />
      )}

      {step === "details" && (
        <DetailsStep />
      )}

      {step === "review" && (
        <ReviewStep
          branchDisplayName={selectedBranch?.display_name ?? (draft.branchSlug || "Missing")}
          financeMethodLabel={financeMethodLabel}
          availabilityAwaitingCount={sourceRequiredAwaitingConfirmation.length}
          subtotal={subtotal}
          discountTotal={discountTotal}
          taxableBasis={taxableBasis}
          taxTotal={taxTotal}
          customerTotal={customerTotal}
          cashDown={cashDown}
          amountFinanced={amountFinanced}
          netTotal={netTotal}
          marginPct={marginPct}
          dealerCost={dealerCost}
          marginAmount={marginAmount}
          activeQuotePackageId={activeQuotePackageId}
          allFinanceScenarios={allFinanceScenarios}
          sendReadiness={packetReadiness.send}
          requiresManagerApproval={approvalState.requiresManagerApproval}
          userRole={userRoleQuery.data ?? null}
          canSubmitForApproval={canSubmitForApproval}
          approvalPending={approvalPending}
          approvalGranted={approvalGranted}
          submitApprovalPending={submitApprovalMutation.isPending}
          onSubmitApproval={() => submitApprovalMutation.mutate()}
          submitApprovalData={submitApprovalMutation.data}
          quoteStatus={quoteStatus}
          onQuoteStatusChange={handleQuoteStatusChange}
        />
      )}

      {step === "document" && (
        <DocumentStep
          quoteTitle={quoteTitle}
          customerTotal={customerTotal}
          financeMethodLabel={financeMethodLabel}
          documentPersistenceLabel={documentPersistenceLabel}
          documentFallbackGeneratedAt={documentFallbackGeneratedAt}
          documentArtifact={documentArtifact}
          customerFacingDocumentBlocker={customerFacingDocumentBlocker}
          pdfGenerating={pdfGenerating}
          quoteMediaSnapshotLoading={quoteMediaSnapshotLoading}
          documentActionError={documentActionError}
          documentReady={documentReady}
          onGenerateDocument={() => void handleGenerateFallbackDocument()}
        />
      )}

      {step === "send" && (
        <SendStep
          customerFacingDocumentBlocker={customerFacingDocumentBlocker}
          approvalCaseCanSend={approvalCaseCanSend}
          approvalBlocker={approvalBlocker}
          documentReady={documentReady}
          documentPersistenceLabel={documentPersistenceLabel}
          taxResolved={taxResolved}
          taxResolutionBlocker={taxResolutionBlocker}
          whyThisMachineRequired={whyThisMachineRequired}
          whyThisMachineBlocker={whyThisMachineBlocker}
          previewReadiness={previewReadiness}
          emailReadiness={emailReadiness}
          textReadiness={textReadiness}
          textQuoteEnabled={textQuoteEnabled}
          deliveryActionBusy={deliveryActionBusy}
          pdfGenerating={pdfGenerating}
          deliveryActionMessage={deliveryActionMessage}
          deliveryActionError={deliveryActionError}
          savePending={saveMutation.isPending}
          onPreview={() => void handleQuoteSendAction("preview")}
          onEmail={() => void handleQuoteSendAction("email")}
          onText={() => void handleQuoteSendAction("text")}
          onSaveFollowUp={() => void handleSaveClick()}
        />
      )}


      <MarginFloorGate
        brandId={null}
        marginPct={marginPct}
        netTotalCents={Math.round(netTotal * 100)}
        reasonModalOpen={marginGateOpen}
        onReasonModalOpenChange={setMarginGateOpen}
        onReasonConfirm={(payload) => { void handleMarginReasonConfirm(payload); }}
      />

      {pdfError && (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{pdfError}</p>
        </Card>
      )}

      {saveMutation.isSuccess && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-sm text-emerald-400">Quote saved successfully.</p>
        </Card>
      )}

      {submitApprovalMutation.isError && (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">
            {submitApprovalMutation.error instanceof Error
              ? submitApprovalMutation.error.message
              : "Failed to submit the quote for approval."}
          </p>
        </Card>
      )}

      {saveMutation.isError && (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">
            {saveMutation.error instanceof Error
              ? saveMutation.error.message
              : "Failed to save the quote."}
          </p>
        </Card>
      )}

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
      )}

      {/* Deal Assistant / Copilot panel (Slice 05 cold-start + Slice 21
          per-quote copilot). The drawer auto-routes to the Copilot tab
          when a quote is in flight (activeQuotePackageId present) and
          falls back to Scenarios for cold-start. */}
      <ConversationalDealEngine
        open={dealAssistantOpen}
        onClose={() => setDealAssistantOpen(false)}
        onScenarioSelect={handleScenarioSelection}
        dealId={draft.dealId || undefined}
        quotePackageId={activeQuotePackageId ?? undefined}
        quoteName={
          draft.customerName || draft.customerCompany || undefined
        }
        onCopilotDraftPatch={(patch) => {
          // Merge patch into the draft reducer. customerSignals gets a
          // shallow merge so CRM-sourced numerics (openDeals, past quote
          // count, etc.) aren't overwritten by the copilot's narrower
          // surface.
          setDraft((current) => ({
            ...current,
            ...patch,
            customerSignals: patch.customerSignals
              ? { ...(current.customerSignals ?? {
                  openDeals: 0,
                  openDealValueCents: 0,
                  lastContactDaysAgo: null,
                  pastQuoteCount: 0,
                  pastQuoteValueCents: 0,
                }), ...patch.customerSignals }
              : current.customerSignals,
          }));
        }}
        onCopilotScore={(_score, _factors, _lifts) => {
          // Intentionally no-op in the reducer path: WinProbabilityStrip
          // recomputes from the patched draft, so the score surface is
          // already live. This callback is reserved for future
          // animation hooks (pulse the strip on delta, etc.).
        }}
      />

      <Dialog open={tradeCaptureOpen} onOpenChange={setTradeCaptureOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Trade capture evidence</DialogTitle>
            <DialogDescription>
              Capture the trade facts here without leaving the quote. Rows check off automatically when their evidence field has content.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            {TRADE_CHECKLIST_ITEMS.map((item) => {
              const active = activeTradeCaptureKey === item.key;
              const complete = tradeChecklist[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTradeCaptureKey(item.key)}
                  className={`rounded-lg border p-3 text-left text-sm transition ${
                    active
                      ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                      : complete
                        ? "border-emerald-500/30 bg-emerald-500/5 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {complete && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    <span className="font-semibold">{item.label}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs opacity-80">{tradeCapture[item.key] || item.prompt}</p>
                </button>
              );
            })}
          </div>

          {(() => {
            const activeItem = TRADE_CHECKLIST_ITEMS.find((item) => item.key === activeTradeCaptureKey) ?? TRADE_CHECKLIST_ITEMS[0]!;
            return (
              <div className="mt-4 rounded-xl border border-border bg-card/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{activeItem.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{activeItem.prompt}</p>
                  </div>
                  {tradeChecklist[activeItem.key] && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300">Captured</span>}
                </div>
                <textarea
                  value={tradeCapture[activeItem.key]}
                  onChange={(event) => setTradeCapture((current) => ({ ...current, [activeItem.key]: event.target.value }))}
                  placeholder={activeItem.placeholder}
                  className="mt-3 min-h-[120px] w-full rounded border border-input bg-background px-3 py-2 text-sm"
                />
                <label className="mt-3 block rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 text-foreground">
                    <Camera className="h-4 w-4 text-qep-orange" /> Optional photo evidence
                  </div>
                  <p className="mt-1 text-xs">Attach a local photo during capture. The note above is what drives checklist completion today.</p>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="mt-3 block w-full text-xs"
                    onChange={(event) => {
                      const fileName = event.target.files?.[0]?.name;
                      if (!fileName) return;
                      setTradeCapture((current) => ({
                        ...current,
                        [activeItem.key]: `${current[activeItem.key]}${current[activeItem.key].trim() ? "\n" : ""}Photo captured: ${fileName}`,
                      }));
                    }}
                  />
                </label>
                <div className="mt-4 flex flex-wrap justify-between gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setTradeCapture((current) => ({ ...current, [activeItem.key]: "" }))}
                  >
                    Clear this evidence
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setTradeCaptureOpen(false)}>Done</Button>
                    <Button
                      onClick={() => {
                        const currentIndex = TRADE_CHECKLIST_ITEMS.findIndex((item) => item.key === activeItem.key);
                        const next = TRADE_CHECKLIST_ITEMS[currentIndex + 1];
                        if (next) setActiveTradeCaptureKey(next.key);
                        else setTradeCaptureOpen(false);
                      }}
                    >
                      Save & next <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <PackageItemSearchDialog
        open={packageItemSearchOpen}
        onOpenChange={setPackageItemSearchOpen}
        kind={configureTab}
        selectedIds={draft.attachments
          .filter((item) => item.kind === configureTab)
          .flatMap((item) => [item.id, item.sourceId].filter((value): value is string => Boolean(value)))}
        compatibleItems={availableOptions.map((item) => ({
          id: item.id,
          kind: "attachment" as const,
          name: item.name,
          price: item.price,
          dealerCost: null,
          brandName: availableOptionsLabel,
          category: "Compatible attachment",
          universal: false,
          sourceCatalog: "qb_attachments" as const,
          sourceId: item.id,
          metadata: {
            catalog_kind: "compatible_attachment",
            compatibility: "selected_equipment",
            compatible_for: availableOptionsLabel,
          },
        }))}
        onAdd={addPackageCatalogItem}
      />

      <Dialog open={catalogBrowserOpen} onOpenChange={setCatalogBrowserOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Browse QEP catalog</DialogTitle>
            <DialogDescription>
              Pick equipment or parts from active QEP catalog records. AI text cannot become a quote line unless it resolves here.
            </DialogDescription>
          </DialogHeader>
          <EquipmentSelector
            onSelect={(entry) => {
              addCatalogEquipment(entry);
              setCatalogBrowserOpen(false);
              setStep("equipment");
            }}
            onSelectAttachment={(entry) => {
              addCatalogAttachment(entry);
              setCatalogBrowserOpen(false);
              setStep("configure");
            }}
            onRecommendation={(recommendation) => {
              setDraft((current) => ({ ...current, recommendation }));
            }}
            autoLoad
            title="Find quote items"
            helper="Start broad with all active QEP catalog items, then narrow by make, model, category, tractor, attachment, blade, mower, or part name."
          />
        </DialogContent>
      </Dialog>

      <Dialog open={reviewSendOpen} onOpenChange={setReviewSendOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review & Send</DialogTitle>
            <DialogDescription>
              Confirm the customer packet, choose delivery, and send without leaving the workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">PDF preview</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {draft.customerCompany || draft.customerName || "Customer proposal"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {draft.equipment.length} equipment line{draft.equipment.length === 1 ? "" : "s"} · {draft.attachments.length} commercial add-on{draft.attachments.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-kpi text-2xl font-extrabold tabular-nums text-qep-orange">{money(customerTotal)}</p>
                    <p className="text-[11px] text-muted-foreground">{financeMethodLabel}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 rounded-lg border border-border/70 bg-background/50 p-3">
                  {[...draft.equipment, ...draft.attachments].slice(0, 6).map((line, index) => (
                    <div key={`${line.title}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-muted-foreground">{line.title || `${line.make ?? ""} ${line.model ?? ""}`.trim()}</span>
                      <span className="font-medium text-foreground">{money(line.unitPrice * line.quantity)}</span>
                    </div>
                  ))}
                  <div className="border-t border-border/70 pt-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-foreground">Customer total</span>
                      <span className="font-semibold text-qep-orange">{money(customerTotal)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleDownloadPdf} disabled={pdfGenerating}>
                    {pdfGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
                    PDF
                  </Button>
                  <Button variant="outline" onClick={handleDownloadPdf} disabled={pdfGenerating}>
                    <Printer className="mr-1 h-4 w-4" /> Print
                  </Button>
                  <Button variant="outline" onClick={handleIssueShareLink} disabled={!activeQuotePackageId || shareBusy}>
                    {shareBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />}
                    Copy Link
                  </Button>
                </div>
                {shareUrl && (
                  <p className="mt-2 break-all rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                    Copied link: {shareUrl}
                  </p>
                )}
                {shareError && <p className="mt-2 text-xs text-rose-400">{shareError}</p>}
                {pdfError && <p className="mt-2 text-xs text-rose-400">{pdfError}</p>}
              </Card>

              <Card className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Delivery options</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <DeliveryOption icon={<Mail className="h-4 w-4" />} label="Email" active />
                  <DeliveryOption icon={<Smartphone className="h-4 w-4" />} label="SMS" disabled />
                  <DeliveryOption icon={<Printer className="h-4 w-4" />} label="Print" active />
                  <DeliveryOption icon={<Link2 className="h-4 w-4" />} label="Link" active />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Recipient</span>
                    <input
                      value={draft.customerName || draft.customerCompany || ""}
                      onChange={(event) => setDraft((current) => ({ ...current, customerName: event.target.value }))}
                      className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Email</span>
                    <input
                      value={draft.customerEmail ?? ""}
                      onChange={(event) => setDraft((current) => ({ ...current, customerEmail: event.target.value }))}
                      className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <label className="mt-4 block space-y-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Internal notes</span>
                  <textarea
                    value={internalNotes}
                    onChange={(event) => setInternalNotes(event.target.value)}
                    placeholder="Private note for follow-up, manager context, or delivery caveats."
                    className="min-h-[90px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
                  />
                </label>
              </Card>
            </div>

            <div className="space-y-4">
              <Card className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Readiness</p>
                <div className="mt-3 space-y-2 text-sm">
                  <ReadinessRow label="Draft" ready={packetReadiness.draft.ready} detail={packetReadiness.draft.missing.join(", ")} />
                  <ReadinessRow label="Send" ready={packetReadiness.send.ready} detail={packetReadiness.send.missing.join(", ")} />
                  <ReadinessRow label="Approval" ready={approvalGranted || !approvalState.requiresManagerApproval} detail={approvalState.reason ?? ""} />
                </div>
              </Card>

              {activeQuotePackageId ? (
                <SendQuoteSection
                  quotePackageId={activeQuotePackageId}
                  contactName={draft.customerName || draft.customerCompany || "customer"}
                  onSent={() => {
                    setDraft((current) => ({ ...current, quoteStatus: "sent" }));
                    setReviewSendOpen(false);
                  }}
                />
              ) : (
                <Card className="border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-sm font-medium text-amber-400">Save before sending</p>
                  <p className="mt-1 text-xs text-amber-300">A quote package id is required for email and share-link delivery.</p>
                </Card>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </WizardStateProvider>
  );
}

// ────────────────────────────────────────────────────────────────────────
// CustomerSection — small composite wrapping the picker / chip / manual
// fallback. Pulled out of the main component to keep the step-1 render
// focused and to make the picker→chip transition legible. Consumes the
// draft to decide which UI to show:
//
//   - No customer selected AND no manual input → picker
//   - Customer selected (has CRM contactId/companyId OR manual data) → chip
//   - "New customer" requested from picker → inline 4-field manual form
//
// Keeps state minimal: the picker's query string and whether manual
// fallback mode is active. Everything else lives in the draft.
// ────────────────────────────────────────────────────────────────────────

function DeliveryOption({
  icon,
  label,
  active,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${
      disabled
        ? "border-border/60 bg-muted/20 text-muted-foreground"
        : active
          ? "border-qep-orange/30 bg-qep-orange/5 text-foreground"
          : "border-border bg-card/40 text-muted-foreground"
    }`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {disabled ? "Backend gap" : "Available"}
      </p>
    </div>
  );
}
