import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
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
  MessageSquare,
  FileText,
  FileDown,
  ArrowRight,
  ArrowLeft,
  Save,
  MapPin,
  Loader2,
  Camera,
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
import { CustomerInfoCard } from "../components/CustomerInfoCard";
import { CustomerPicker, type PickedCustomer } from "../components/CustomerPicker";
import { SelectedCustomerChip } from "../components/SelectedCustomerChip";
import { CustomerIntelPanel } from "../components/CustomerIntelPanel";
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
import { FinancingCalculator } from "../components/FinancingCalculator";
import { DealCoachSidebar } from "../components/DealCoachSidebar";
import { IncentiveStack } from "../components/IncentiveStack";
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
  getFactorVerdicts,
  getQuoteApprovalCase,
  getSavedQuotePackage,
  logQuoteDeliveryEvent,
  saveQuotePackage,
  searchCatalog,
  submitQuoteForApproval,
  type QuotePackageSaveResponse,
  type QuoteFinancingRequest,
} from "../lib/quote-api";
import {
  computeQuoteSendActionReadiness,
  computeQuoteWorkspace,
  isQuoteWhyThisMachineConfirmationRequired,
  isTaxProfileExempt,
  type QuoteSendActionChannel,
} from "../lib/quote-workspace";
import { hydrateDraftFromSavedQuote } from "../lib/saved-quote-draft";
import { buildCatalogQueryCandidates } from "../lib/catalog-query-candidates";
import {
  buildLocalDraftKey,
  clearLocalDraft,
  isDraftEmpty,
  loadLocalDraft,
  saveLocalDraft,
} from "../lib/local-draft";
import { useActiveBranches } from "@/hooks/useBranches";
import { useQuotePDF } from "../hooks/useQuotePDF";
import { useQuoteFinancingPreview } from "../hooks/useQuoteFinancingPreview";
import { useQuoteTaxPreview } from "../hooks/useQuoteTaxPreview";
import { buildCustomFinanceScenario } from "../lib/custom-finance";
import {
  buildQuotePdfBranch,
  parsePendingScenarioSelection,
} from "../lib/quote-builder-page-normalizers";
import { AskIronAdvisorButton } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { VoiceRecorder } from "@/features/voice-qrm/components/VoiceRecorder";
import { submitVoiceToQrm } from "@/features/voice-qrm/lib/voice-qrm-api";
import {
  ConversationalDealEngine,
  DealAssistantTrigger,
  type ScenarioSelection,
} from "../components/ConversationalDealEngine";
import { issueShareToken } from "@/features/deal-room/lib/deal-room-api";
import type {
  QuoteEntryMode,
  QuoteFinanceScenario,
  QuoteLineItemDraft,
  QuoteTaxProfile,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

// Item 2: the salesperson-facing flow is now the QRM 11-step wizard.
// Steps 10–11 intentionally reuse local PDF/preview delivery while backend
// persisted document and Graph/Twilio provider artifacts are still gated.
type Step =
  | "customer"
  | "equipment"
  | "configure"
  | "tradeIn"
  | "pricing"
  | "promotions"
  | "financing"
  | "details"
  | "review"
  | "document"
  | "send";
type BuilderMode = "workspace" | "guided";
type AutoSaveState = "idle" | "local" | "saving" | "saved" | "error";

interface WizardStepMeta {
  id: Step;
  number: number;
  label: string;
  shortLabel: string;
  owner: "item-2" | "item-3" | "placeholder";
}

const WIZARD_STEPS: WizardStepMeta[] = [
  { id: "customer", number: 1, label: "Customer", shortLabel: "Customer", owner: "item-2" },
  { id: "equipment", number: 2, label: "Equipment", shortLabel: "Equipment", owner: "item-2" },
  { id: "configure", number: 3, label: "Configure", shortLabel: "Configure", owner: "item-2" },
  { id: "tradeIn", number: 4, label: "Trade-in", shortLabel: "Trade", owner: "item-2" },
  { id: "pricing", number: 5, label: "Pricing build", shortLabel: "Pricing", owner: "item-3" },
  { id: "promotions", number: 6, label: "Rebates & promos", shortLabel: "Promos", owner: "item-3" },
  { id: "financing", number: 7, label: "Financing", shortLabel: "Finance", owner: "item-3" },
  { id: "details", number: 8, label: "Quote details", shortLabel: "Details", owner: "item-3" },
  { id: "review", number: 9, label: "Review & approval", shortLabel: "Review", owner: "item-3" },
  { id: "document", number: 10, label: "Document", shortLabel: "Document", owner: "item-3" },
  { id: "send", number: 11, label: "Send & log", shortLabel: "Send", owner: "item-3" },
];

const WIZARD_STEP_IDS = WIZARD_STEPS.map((item) => item.id);

function readinessChipLabel(missing: string): string {
  if (missing.includes("customer")) return "Customer";
  if (missing.includes("equipment")) return "Equipment";
  if (missing.includes("branch")) return "Branch";
  if (missing.includes("email")) return "Email";
  return missing;
}

const STEP_STORAGE_PREFIX = "qep.quote-builder.last-step.";
const STEP_LABELS: Record<Step, string> = WIZARD_STEPS.reduce((labels, item) => {
  labels[item.id] = item.label;
  return labels;
}, {} as Record<Step, string>);

type EquipmentAvailabilityStatus = "in_stock" | "in_transit" | "source_required";
type FinanceStepTab = "cash" | "finance" | "lease";
type PricingLineKind = Extract<QuoteLineItemDraft["kind"], "pdi" | "freight" | "good_faith" | "doc_fee" | "title" | "tag" | "registration" | "discount" | "rebate_mfg" | "rebate_dealer" | "loyalty_discount">;

const PRICING_ADDER_FIELDS: Array<{ kind: PricingLineKind; title: string; helper: string; step: number }> = [
  { kind: "freight", title: "Freight", helper: "Shipping or transfer cost", step: 100 },
  { kind: "pdi", title: "PDI", helper: "Prep / delivery inspection", step: 100 },
  { kind: "good_faith", title: "1% good faith", helper: "Use when QEP policy supports it", step: 100 },
  { kind: "doc_fee", title: "Doc fee", helper: "Dealer paperwork fee", step: 25 },
  { kind: "title", title: "Title", helper: "Title processing", step: 25 },
  { kind: "tag", title: "Tag", helper: "Tag / plate fee", step: 25 },
  { kind: "registration", title: "Registration", helper: "Registration support", step: 25 },
];

const DISCOUNT_REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "competitive_match", label: "Competitive match" },
  { value: "volume_buyer", label: "Volume buyer" },
  { value: "aged_inventory", label: "Aged inventory" },
  { value: "loyalty", label: "Loyalty" },
  { value: "other", label: "Other" },
];

const PROMOTION_PLACEHOLDERS: Array<{ id: string; title: string; kind: PricingLineKind; amount: number; source: string; detail: string }> = [
  { id: "seed-mfg-support", title: "Manufacturer retail support", kind: "rebate_mfg", amount: 1000, source: "Manufacturer", detail: "Clear starter row until seeded OEM programs resolve." },
  { id: "seed-dealer-match", title: "Dealer close-the-gap promo", kind: "rebate_dealer", amount: 500, source: "Dealer", detail: "Use only when manager policy allows dealer-funded support." },
  { id: "seed-loyalty-owner", title: "Returning owner loyalty", kind: "loyalty_discount", amount: 750, source: "Loyalty", detail: "Placeholder for customer loyalty program selection." },
];

interface CatalogEntryMatch {
  id?: string;
  sourceCatalog?: QuoteLineItemDraft["sourceCatalog"];
  sourceId?: string | null;
  dealerCost?: number | null;
  make: string;
  model: string;
  year: number | null;
  list_price?: number;
  stock_number?: string | null;
  condition?: string | null;
  availabilityStatus?: EquipmentAvailabilityStatus;
  availability_status?: EquipmentAvailabilityStatus;
  attachments?: Array<{ id: string; name: string; price: number }>;
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

/**
 * Heuristic: is `next` likely a typo-fix / case-variation of `prev`,
 * not a material rewrite to a different company?
 *
 * Returns true when the edit is safe to preserve the Digital Twin
 * snapshot through (e.g. "acme landscaping" → "Acme Landscaping",
 * "Acme Ldsc" → "Acme Landscaping", trailing whitespace trims).
 * Returns false for genuine re-targeting ("Acme" → "Smith Excavation").
 *
 * We require either: (a) case-insensitive prefix match in either
 * direction, or (b) small edit distance relative to the shorter
 * string (≤20% of length). Not perfect — but correct on the demo
 * axes and safe: the worst false-positive preserves a signal that
 * the rep can still clear manually; the worst false-negative just
 * triggers a CustomerIntelPanel re-fetch.
 */
function isTypoLikeRewrite(prev: string, next: string): boolean {
  const a = prev.trim().toLowerCase();
  const b = next.trim().toLowerCase();
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  // Bounded Levenshtein — bail if length gap alone exceeds threshold.
  const shorter = Math.min(a.length, b.length);
  const threshold = Math.max(2, Math.floor(shorter * 0.2));
  if (Math.abs(a.length - b.length) > threshold) return false;
  // Small-string Levenshtein; O(a*b) but both are ≤ a few dozen chars.
  const dp: number[] = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prevDiag + cost);
      prevDiag = tmp;
    }
  }
  return (dp[b.length] ?? Infinity) <= threshold;
}

function buildEquipmentLine(entry: CatalogEntryMatch): QuoteLineItemDraft {
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
    metadata: {
      availability_status: availabilityStatusForEntry(entry),
      stock_number: entry.stock_number ?? null,
    },
  };
}

// When the catalog search misses (AI recommended a Make+Model we don't
// carry, or the match was fuzzy and the sanitized ilike returned 0 rows),
// seed the workspace with the AI's textual pick so the rep sees something
// concrete to refine — never land on an empty Equipment step after a
// successful AI intake.
function buildEquipmentLineFromRecommendation(
  machine: string | null | undefined,
): QuoteLineItemDraft | null {
  const text = (machine ?? "").trim();
  if (!text) return null;
  const [firstToken, ...rest] = text.split(/\s+/);
  return {
    kind: "equipment",
    sourceCatalog: "manual",
    sourceId: null,
    dealerCost: null,
    title: text,
    make: firstToken ?? text,
    model: rest.join(" "),
    year: null,
    quantity: 1,
    unitPrice: 0,
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

function isWizardStepId(value: string | null): value is Step {
  return Boolean(value && WIZARD_STEP_IDS.includes(value as Step));
}

function wizardIndexForStep(step: Step): number {
  return WIZARD_STEPS.find((item) => item.id === step)?.number ?? 1;
}

function stepForWizardIndex(index: number | null | undefined): Step | null {
  if (!Number.isFinite(index ?? NaN)) return null;
  return WIZARD_STEPS.find((item) => item.number === Number(index))?.id ?? null;
}

function readPersistedStep(quotePackageId: string | null): Step | null {
  if (!quotePackageId || typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(`${STEP_STORAGE_PREFIX}${quotePackageId}`);
  return isWizardStepId(raw) ? raw : null;
}

function persistStep(quotePackageId: string | null, step: Step): void {
  if (!quotePackageId || typeof window === "undefined") return;
  window.sessionStorage.setItem(`${STEP_STORAGE_PREFIX}${quotePackageId}`, step);
}

function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function shortDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateTimeInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoFromDateInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoFromDateTimeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

export function QuoteBuilderV2Page() {
  const [searchParams] = useSearchParams();
  const packageId = searchParams.get("package_id") || "";
  const dealId = searchParams.get("deal_id") || searchParams.get("crm_deal_id") || "";
  const contactId = searchParams.get("contact_id") || searchParams.get("crm_contact_id") || "";
  const [step, setStep] = useState<Step>("customer");
  const [builderMode] = useState<BuilderMode>("guided");
  const [reviewSendOpen, setReviewSendOpen] = useState(false);
  const [tradeExpanded, setTradeExpanded] = useState(false);
  const [termsExpanded, setTermsExpanded] = useState(false);
  const [digitalTwinExpanded, setDigitalTwinExpanded] = useState(false);
  const [marginWaterfallExpanded, setMarginWaterfallExpanded] = useState(false);
  const [packageToolsOpen, setPackageToolsOpen] = useState(false);
  const [customLineTitle, setCustomLineTitle] = useState("");
  const [customLinePrice, setCustomLinePrice] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>("idle");
  const [internalNotes, setInternalNotes] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [documentFallbackGeneratedAt, setDocumentFallbackGeneratedAt] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [deliveryActionMessage, setDeliveryActionMessage] = useState<string | null>(null);
  const [deliveryActionError, setDeliveryActionError] = useState<string | null>(null);
  const [deliveryActionBusy, setDeliveryActionBusy] = useState<QuoteSendActionChannel | null>(null);
  const lastAutoSaveSignatureRef = useRef<string>("");
  const documentDraftSignatureRef = useRef<string>("");
  const [customFinanceEnabled, setCustomFinanceEnabled] = useState(false);
  const [customFinanceRate, setCustomFinanceRate] = useState<number | null>(null);
  const [customFinanceTermMonths, setCustomFinanceTermMonths] = useState<number | null>(null);
  const [financeStepTab, setFinanceStepTab] = useState<FinanceStepTab>("cash");
  const [draft, setDraft] = useState<QuoteWorkspaceDraft>({
    dealId: dealId || undefined,
    contactId: contactId || undefined,
    entryMode: "manual",
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
    wizardStep: 1,
    customerName: "",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
    quoteStatus: "draft",
  });
  const [aiPrompt, setAiPrompt] = useState("");
  const [dealAssistantOpen, setDealAssistantOpen] = useState(false);
  const [availableOptions, setAvailableOptions] = useState<Array<{ id: string; name: string; price: number }>>([]);
  const [availableOptionsLabel, setAvailableOptionsLabel] = useState<string | null>(null);
  const [configureTab, setConfigureTab] = useState<"attachment" | "option" | "accessory" | "warranty">("attachment");
  const [tradeChecklist, setTradeChecklist] = useState({
    hourMeter: false,
    undercarriage: false,
    hydraulicLeaks: false,
    serviceHours: false,
    tiresTracks: false,
    photos: false,
  });
  const queryClient = useQueryClient();

  const branchesQ = useActiveBranches();
  const branches = branchesQ.data ?? [];
  const selectedBranch = branches.find((branch) => branch.slug === draft.branchSlug);
  const {
    equipmentTotal,
    attachmentTotal,
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
  } = computeQuoteWorkspace(draft);

  const { generateAndDownload: downloadPDF, generating: pdfGenerating, error: pdfError } = useQuotePDF();
  const { profile } = useAuth();
  const existingQuoteHydrationKeyRef = useRef<string | null>(null);

  const existingQuoteQuery = useQuery({
    queryKey: ["quote-builder", "saved-quote", packageId, dealId],
    queryFn: () => getSavedQuotePackage({
      packageId: packageId || undefined,
      dealId: dealId || undefined,
    }),
    enabled: Boolean(packageId || dealId),
    staleTime: 10_000,
  });

  const existingQuote = useMemo(() => {
    const quote = existingQuoteQuery.data?.quote;
    if (quote && typeof quote === "object" && !Array.isArray(quote)) {
      return quote as Record<string, unknown>;
    }
    return null;
  }, [existingQuoteQuery.data?.quote]);

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
    setDraft((current) => ({ ...current, ...hydratedDraft }));
    setStep(readPersistedStep(nextKey) ?? stepForWizardIndex(hydratedDraft.wizardStep) ?? "review");
  }, [dealId, existingQuote, packageId]);

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
    const stored = loadLocalDraft(localDraftKey);
    if (stored && !isDraftEmpty(stored)) {
      setDraft((current) => ({ ...current, ...stored }));
    }
    setLocalDraftHydrationComplete(true);
  }, [
    existingQuote,
    existingQuoteQuery.isFetching,
    existingQuoteQuery.isLoading,
    localDraftHydrationComplete,
    localDraftKey,
  ]);

  useEffect(() => {
    if (!localDraftHydrationComplete) return;
    if (!localPersistEnabled) return;
    if (!localDraftKey) return;
    if (isDraftEmpty(draft)) {
      clearLocalDraft(localDraftKey);
      return;
    }
    saveLocalDraft(localDraftKey, draft);
  }, [draft, localDraftHydrationComplete, localDraftKey, localPersistEnabled]);

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
    if (!contactId && !dealId) return;

    let cancelled = false;
    (async () => {
      try {
        const hydrated = await hydrateCustomerById({
          contactId: contactId || null,
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
    dealId,
    draft.customerCompany,
    draft.customerName,
    existingQuote,
    existingQuoteQuery.isLoading,
  ]);

  // Slice 14: pick up a pending voice-quote handoff on mount. The VoiceQuotePage
  // stashes the selected scenario in sessionStorage; we read + clear it here
  // and seed the draft via the same handler the in-place ConversationalDealEngine
  // uses. Deliberately one-shot: once consumed, the key is deleted so a browser
  // refresh doesn't re-apply it.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("qep.voiceQuote.pendingSelection");
      if (!raw) return;
      sessionStorage.removeItem("qep.voiceQuote.pendingSelection");
      const parsed = parsePendingScenarioSelection(raw);
      if (!parsed) return;
      handleScenarioSelection(parsed);
    } catch {
      // Malformed payload — ignore silently; the user is in the quote builder
      // and can proceed manually.
    }
    // Intentionally one-shot: no deps; runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        ),
      );
    },
    onSuccess: (result) => {
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
    onSuccess: () => {
      setDraft((current) => ({ ...current, quoteStatus: "pending_approval" }));
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "list"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder", "approval-case", activeQuotePackageId] });
      if (draft.dealId) {
        queryClient.invalidateQueries({ queryKey: ["quote-builder", "saved-quote", packageId, draft.dealId] });
      }
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
  const activeQuoteUpdatedAt = typeof activeQuoteRecord?.updated_at === "string"
    ? activeQuoteRecord.updated_at
    : typeof activeQuoteRecord?.created_at === "string"
      ? activeQuoteRecord.created_at
      : null;

  const activeApprovalCaseQuery = useQuery({
    queryKey: ["quote-builder", "approval-case", activeQuotePackageId],
    queryFn: () => getQuoteApprovalCase(activeQuotePackageId!),
    enabled: Boolean(activeQuotePackageId),
    staleTime: 5_000,
  });
  const activeApprovalCase = activeApprovalCaseQuery.data ?? null;
  const approvalCaseCanSend = activeApprovalCase?.canSend === true;

  const currentWizardStepNumber = wizardIndexForStep(step);

  useEffect(() => {
    persistStep(activeQuotePackageId, step);
    setDraft((current) => current.wizardStep === currentWizardStepNumber
      ? current
      : { ...current, wizardStep: currentWizardStepNumber });
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
  const approvalPending = quoteStatus === "pending_approval";
  const approvalGranted =
    quoteStatus === "approved"
    || quoteStatus === "approved_with_conditions"
    || quoteStatus === "sent"
    || quoteStatus === "accepted";
  // QEP rule: every quote requires owner approval (Ryan + Rylee).
  // Button shows whenever the draft is complete enough to save — Submit
  // auto-saves first, so the rep can go straight from "done editing"
  // to "waiting on Ryan/Rylee" in one click. Hidden once the case is
  // already past draft (pending / approved / sent / accepted).
  const canSubmitForApproval =
    packetReadiness.draft.ready
    && Boolean(draft.branchSlug)
    && quoteStatus !== "sent"
    && quoteStatus !== "accepted"
    && !approvalPending
    && quoteStatus !== "approved"
    && quoteStatus !== "approved_with_conditions";
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
  const quotePdfData = useMemo(() => ({
    dealName: draft.dealId || draft.customerCompany || draft.customerName || "Quote",
    customerName: draft.customerName || draft.customerCompany || "Customer",
    preparedBy: "QEP Sales Team",
    preparedDate: new Date().toLocaleDateString(),
    aiRecommendationSummary: draft.recommendation?.reasoning ?? null,
    equipment: draft.equipment.map((item) => ({
      make: item.make ?? "",
      model: item.model ?? item.title,
      year: item.year ?? null,
      price: item.unitPrice,
    })),
    attachments: draft.attachments.map((item) => ({ name: item.title, price: item.unitPrice })),
    equipmentTotal,
    attachmentTotal,
    subtotal,
    discountTotal,
    tradeAllowance: draft.tradeAllowance,
    taxTotal,
    customerTotal,
    cashDown,
    amountFinanced,
    netTotal,
    financing: allFinanceScenarios.map((scenario) => ({
      type: scenario.type,
      label: scenario.label,
      termMonths: scenario.termMonths ?? 0,
      rate: scenario.rate ?? scenario.apr ?? 0,
      monthlyPayment: scenario.monthlyPayment ?? 0,
      totalCost: scenario.totalCost ?? 0,
      lender: scenario.lender ?? "Preferred lender",
    })),
    selectedFinancingLabel: draft.selectedFinanceScenario,
    branch: buildQuotePdfBranch(selectedBranch),
  }), [
    allFinanceScenarios,
    amountFinanced,
    attachmentTotal,
    cashDown,
    customerTotal,
    discountTotal,
    draft.attachments,
    draft.customerCompany,
    draft.customerName,
    draft.dealId,
    draft.equipment,
    draft.recommendation?.reasoning,
    draft.selectedFinanceScenario,
    draft.tradeAllowance,
    equipmentTotal,
    netTotal,
    selectedBranch,
    subtotal,
    taxTotal,
  ]);
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

  useEffect(() => {
    if (!localDraftHydrationComplete) return;
    if (!packetReadiness.draft.ready) {
      setAutoSaveState(isDraftEmpty(draft) ? "idle" : "local");
      return;
    }
    if (saveMutation.isPending || submitApprovalMutation.isPending) return;
    if (lastAutoSaveSignatureRef.current === draftSaveSignature) return;

    const timer = window.setTimeout(() => {
      setAutoSaveState("saving");
      saveMutation.mutateAsync()
        .then(() => {
          lastAutoSaveSignatureRef.current = draftSaveSignature;
          setAutoSaveState("saved");
        })
        .catch(() => {
          setAutoSaveState("error");
        });
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [
    draft,
    draftSaveSignature,
    localDraftHydrationComplete,
    packetReadiness.draft.ready,
    saveMutation.isPending,
    saveMutation.mutateAsync,
    submitApprovalMutation.isPending,
  ]);

  useEffect(() => {
    if (!documentFallbackGeneratedAt) return;
    if (documentDraftSignatureRef.current === draftSaveSignature) return;
    documentDraftSignatureRef.current = "";
    setDocumentFallbackGeneratedAt(null);
  }, [documentFallbackGeneratedAt, draftSaveSignature]);

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
      setStep("customer");
    },
  });

  // ── Deal Assistant (Slice 05) ─────────────────────────────────────────────
  // Pre-populate form state when rep selects an AI-generated scenario.
  // Behavior: (a) set equipment from resolved model, (b) store prompt as
  // voiceSummary, (c) advance to equipment step for review — never auto-save.
  const handleScenarioSelection = (selection: ScenarioSelection) => {
    const { scenario, resolvedModelId, deliveryState, customerType, prompt, originatingLogId } = selection;
    setDealAssistantOpen(false);

    // Build equipment line from the resolved model embedded in the SSE complete event.
    // The resolved model data is in selection.scenario but we only have scenario economics,
    // not model metadata. Re-use the prompt to set voiceSummary so IntelligencePanel renders.
    setDraft((current) => ({
      ...current,
      voiceSummary: prompt,
      // Slice 09: thread the originating qb_ai_request_log id through the draft
      // so the save path can persist it on quote_packages.originating_log_id.
      originatingLogId: originatingLogId ?? current.originatingLogId ?? null,
      // If no equipment yet and we have a resolved model ID, add a placeholder.
      // The rep confirms/refines in the equipment step.
      ...(resolvedModelId && current.equipment.length === 0
        ? {
            equipment: [{
              kind:      "equipment" as const,
              id:        resolvedModelId,
              title:     `AI-matched machine (${resolvedModelId.slice(0, 8)}…)`,
              make:      "",
              model:     "",
              year:      null,
              quantity:  1,
              // customerOutOfPocketCents is the scenario price in cents — convert to dollars
              unitPrice: Math.round(scenario.customerOutOfPocketCents / 100),
            }],
          }
        : {}),
    }));

    // Slice 20a: land on the Customer step first so the rep picks who the
    // quote is for before confirming the AI-matched equipment.
    setStep("customer");
  };

  async function addRecommendedMachine(machine: string) {
    const fallback = buildEquipmentLineFromRecommendation(machine);
    // AI machine strings look like "Case SR175 (2026)". Catalog columns
    // (model_code/family/series/name_display) don't contain the year, so
    // a single ilike on the full string returns zero rows and we fall
    // back to a $0 line. Strip year tokens + parens, then try progressive
    // fallbacks (full → no year → make+model → make) so at least one of
    // them lands on a real catalog row with the real list price.
    const candidateQueries = buildCatalogQueryCandidates(machine);
    let firstMatch: CatalogEntryMatch | undefined;
    try {
      for (const query of candidateQueries) {
        const matches = await searchCatalog(query);
        if (matches.length > 0) {
          firstMatch = matches[0] as CatalogEntryMatch;
          break;
        }
      }
      const line = firstMatch ? buildEquipmentLine(firstMatch) : fallback;
      if (!line) return;
      if (firstMatch) {
        setAvailableOptions(firstMatch.attachments ?? []);
        setAvailableOptionsLabel(`${firstMatch.make} ${firstMatch.model}`);
      }
      const nextKey = equipmentKeyForLine(line);
      setDraft((current) => {
        const alreadyAdded = current.equipment.some((item) => equipmentKeyForLine(item) === nextKey);
        if (alreadyAdded) return current;
        return {
          ...current,
          equipment: [...current.equipment, line],
        };
      });
    } catch {
      if (!fallback) return;
      const nextKey = equipmentKeyForLine(fallback);
      setDraft((current) => {
        const alreadyAdded = current.equipment.some((item) => equipmentKeyForLine(item) === nextKey);
        if (alreadyAdded) return current;
        return {
          ...current,
          equipment: [...current.equipment, fallback],
        };
      });
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
    void downloadPDF(quotePdfData);
  }

  function approvalBlockerMessage(): string | null {
    if (!activeQuotePackageId) return "Save the quote package before generating customer-facing documents.";
    if (activeApprovalCaseQuery.isLoading) return "Checking the approval case before customer-facing actions unlock.";
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
    const refreshed = await activeApprovalCaseQuery.refetch();
    if (refreshed.error) return "Could not recheck owner approval after saving. Try again before customer-facing actions.";
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
    try {
      const approvalRefreshBlocker = await ensureCleanApprovalForCustomerFacing();
      if (approvalRefreshBlocker) {
        setDocumentActionError(approvalRefreshBlocker);
        return;
      }
      await downloadPDF(quotePdfData);
      const generatedAt = new Date().toISOString();
      documentDraftSignatureRef.current = draftSaveSignature;
      setDocumentFallbackGeneratedAt(generatedAt);
      if (activeQuotePackageId) {
        await logQuoteDeliveryEvent({
          quotePackageId: activeQuotePackageId,
          channel: "preview",
          status: "draft",
          provider: "local_preview",
          recipient: draft.customerEmail || draft.customerPhone || draft.customerName || draft.customerCompany || null,
          followUpAt: draft.followUpAt ?? null,
          metadata: {
            step: 10,
            fallback_document: true,
            generated_at: generatedAt,
            note: "Local PDF/print fallback only; no stored final artifact was created.",
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
        await downloadPDF(quotePdfData);
        await logQuoteDeliveryEvent({
          quotePackageId: activeQuotePackageId,
          channel: "preview",
          status: "draft",
          provider: "local_preview",
          recipient: draft.customerEmail || draft.customerPhone || draft.customerName || draft.customerCompany || null,
          followUpAt: draft.followUpAt ?? null,
          metadata: { step: 11, fallback_document: true },
        });
        setDeliveryActionMessage("Preview opened and logged. This does not mark the quote sent.");
        return;
      }

      const graphEnabled = import.meta.env.VITE_FEATURE_QRM_GRAPH_EMAIL === "true";
      const textEnabled = import.meta.env.VITE_FEATURE_QRM_TEXT_QUOTE === "true";
      const providerReady = channel === "email" ? graphEnabled : textEnabled;
      const providerName = channel === "email" ? "Microsoft Graph" : "Twilio";
      if (!providerReady) {
        setDeliveryActionMessage(`${providerName} is not configured. No customer message was sent and no delivery event was logged.`);
        return;
      }

      setDeliveryActionError(`${providerName} flag is enabled, but the send endpoint is not implemented yet. No customer message was sent or logged.`);
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
      void submitApprovalMutation.mutateAsync();
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
  const sourceRequiredAwaitingConfirmation = sourceRequiredEquipment.filter((item) => !item.metadata?.availability_confirmation_requested_at);
  const equipmentCanContinue = hasEquipmentLine && sourceRequiredAwaitingConfirmation.length === 0;
  const tradeChecklistComplete = Object.values(tradeChecklist).every(Boolean);
  const tradeManagerApprovalRequired = draft.tradeAllowance > 0 && !tradeChecklistComplete;
  const signalsReady = hasCustomer && hasEquipmentLine;

  function markAvailabilityConfirmationRequested(index: number): void {
    setDraft((current) => ({
      ...current,
      equipment: current.equipment.map((item, rowIndex) => rowIndex === index
        ? {
            ...item,
            metadata: {
              ...(item.metadata ?? {}),
              availability_status: availabilityStatusForLine(item),
              availability_confirmation_requested_at: new Date().toISOString(),
            },
          }
        : item),
    }));
  }

  function markAllAvailabilityConfirmationRequested(): void {
    setDraft((current) => ({
      ...current,
      equipment: current.equipment.map((item) => availabilityStatusForLine(item) === "source_required" && !item.metadata?.availability_confirmation_requested_at
        ? {
            ...item,
            metadata: {
              ...(item.metadata ?? {}),
              availability_status: "source_required",
              availability_confirmation_requested_at: new Date().toISOString(),
            },
          }
        : item),
    }));
  }

  function addConfigLine(kind: "attachment" | "option" | "accessory" | "warranty", input?: { id?: string; title: string; unitPrice: number }): void {
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

  function pricingLine(kind: PricingLineKind): QuoteLineItemDraft | undefined {
    return draft.pricingLines?.find((item) => item.kind === kind);
  }

  function upsertPricingLine(kind: PricingLineKind, title: string, amount: number, patch: Partial<QuoteLineItemDraft> = {}): void {
    const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    setDraft((current) => {
      const existing = current.pricingLines ?? [];
      const nextLine: QuoteLineItemDraft = {
        kind,
        id: existing.find((item) => item.kind === kind)?.id ?? `${kind}-${Date.now()}`,
        sourceCatalog: "manual",
        sourceId: null,
        dealerCost: null,
        title,
        quantity: 1,
        unitPrice: safeAmount,
        ...patch,
      };
      return {
        ...current,
        pricingLines: safeAmount <= 0
          ? existing.filter((item) => item.kind !== kind)
          : existing.some((item) => item.kind === kind)
            ? existing.map((item) => item.kind === kind ? { ...item, ...nextLine } : item)
            : [...existing, nextLine],
      };
    });
  }

  function promotionPlaceholderSelected(promo: typeof PROMOTION_PLACEHOLDERS[number]): boolean {
    return draft.pricingLines?.some((line) =>
      line.kind === promo.kind && line.metadata?.promotion_placeholder_id === promo.id) ?? false;
  }

  function togglePromotion(promo: typeof PROMOTION_PLACEHOLDERS[number]): void {
    const selected = promotionPlaceholderSelected(promo);
    setDraft((current) => {
      const existing = current.pricingLines ?? [];
      const selectedPromotionIds = (current.selectedPromotionIds ?? []).filter(isUuid);
      if (selected) {
        return {
          ...current,
          selectedPromotionIds,
          pricingLines: existing.filter((line) => line.metadata?.promotion_placeholder_id !== promo.id),
        };
      }
      const currentLine = existing.find((line) => line.metadata?.promotion_placeholder_id === promo.id);
      const nextLine: QuoteLineItemDraft = {
        kind: promo.kind,
        id: currentLine?.id ?? `${promo.kind}-${Date.now()}`,
        sourceCatalog: "manual",
        sourceId: null,
        dealerCost: null,
        title: promo.title,
        quantity: 1,
        unitPrice: promo.amount,
        metadata: {
          ...(currentLine?.metadata ?? {}),
          promotion_placeholder_id: promo.id,
          promotion_source: promo.source,
        },
      };
      return {
        ...current,
        selectedPromotionIds,
        pricingLines: currentLine
          ? existing.map((line) => line.metadata?.promotion_placeholder_id === promo.id ? nextLine : line)
          : [...existing, nextLine],
      };
    });
  }

  function saveSelectedFinanceScenario(scenario: QuoteFinanceScenario): void {
    setDraft((current) => {
      const saved = current.savedFinanceScenarios ?? [];
      const nextScenario = {
        ...scenario,
        kind: scenario.kind ?? (scenario.type === "lease" ? "lease_fmv" : scenario.type),
        isDefault: scenario.label === current.selectedFinanceScenario,
      } satisfies QuoteFinanceScenario;
      return {
        ...current,
        savedFinanceScenarios: saved.some((item) => item.label === nextScenario.label)
          ? saved.map((item) => item.label === nextScenario.label
            ? { ...item, ...nextScenario, isDefault: true }
            : { ...item, isDefault: false })
          : [...saved.map((item) => ({ ...item, isDefault: false })), { ...nextScenario, isDefault: true }],
      };
    });
  }

  const discountLine = pricingLine("discount");
  const leaseQuotingEnabled = import.meta.env.VITE_FEATURE_LEASE_QUOTING === "true";
  const financeTabScenarios = allFinanceScenarios.filter((scenario) => (
    financeStepTab === "cash"
      ? scenario.type === "cash" || scenario.kind === "cash"
      : financeStepTab === "lease"
        ? scenario.type === "lease" || scenario.kind === "lease_fmv" || scenario.kind === "lease_fppo"
        : scenario.type === "finance" || scenario.kind === "finance"
  ));

  const documentReady = Boolean(documentFallbackGeneratedAt);
  const graphEmailEnabled = import.meta.env.VITE_FEATURE_QRM_GRAPH_EMAIL === "true";
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
      onBrowseCatalog={() => setStep("equipment")}
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
  const previousWizardStep = WIZARD_STEPS[currentWizardStepNumber - 2]?.id ?? null;
  const nextWizardStep = WIZARD_STEPS[currentWizardStepNumber]?.id ?? null;
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

  function handleQuoteForProspect(): void {
    setDraft((cur) => ({
      ...cur,
      customerName:    cur.customerName    || "Walk-in prospect",
      customerCompany: cur.customerCompany || "Walk-in prospect",
      customerSignals: null,
      customerWarmth:  null,
    }));
    setStep("equipment");
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Start quote</p>
                  <p className="mt-1 text-sm text-muted-foreground">Choose the fastest entry path. All four routes land in this workspace.</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                {([
                  { mode: "voice" as QuoteEntryMode, label: "Voice", icon: Mic, body: "Record the deal and seed customer need.", action: () => setDraft((cur) => ({ ...cur, entryMode: "voice" })) },
                  { mode: "ai_chat" as QuoteEntryMode, label: "AI Chat", icon: MessageSquare, body: "Use the prompt below for recommendation.", action: () => setDraft((cur) => ({ ...cur, entryMode: "ai_chat" })) },
                  { mode: "manual" as QuoteEntryMode, label: "Manual", icon: FileText, body: "Build package lines directly.", action: () => setDraft((cur) => ({ ...cur, entryMode: "manual" })) },
                  { mode: "trade_photo" as QuoteEntryMode, label: "Trade Photo", icon: Camera, body: "Open trade capture first.", action: () => { setDraft((cur) => ({ ...cur, entryMode: "trade_photo" })); setTradeExpanded(true); } },
                ]).map(({ mode, label, icon: Icon, body, action }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={action}
                    className={`min-h-[116px] rounded-lg border p-3 text-left transition hover:border-qep-orange/60 ${
                      draft.entryMode === mode
                        ? "border-qep-orange bg-qep-orange/5"
                        : "border-border bg-card/40"
                    }`}
                  >
                    <Icon className="h-5 w-5 text-qep-orange" />
                    <p className="mt-2 text-sm font-semibold text-foreground">{label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{body}</p>
                  </button>
                ))}
              </div>
              {draft.entryMode === "ai_chat" && (
                <div className="mt-4 rounded-lg border border-border/70 bg-background/50 p-3">
                  <textarea
                    value={aiPrompt}
                    onChange={(event) => setAiPrompt(event.target.value)}
                    placeholder="Describe the job, terrain, timeline, budget, and attachments."
                    className="min-h-[88px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => aiIntakeMutation.mutate(aiPrompt.trim())}
                      disabled={aiIntakeMutation.isPending || aiPrompt.trim().length < 12}
                    >
                      {aiIntakeMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                      Build with AI
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Package</p>
                  <p className="mt-1 text-sm text-muted-foreground">One quote, many line items. Single equipment quotes are just a subset.</p>
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
                          equipment: current.equipment.map((line, rowIndex) => rowIndex === index ? { ...line, unitPrice: value } : line),
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
                      setAvailableOptions(entry.attachments ?? []);
                      setAvailableOptionsLabel(`${entry.make} ${entry.model}`);
                      const nextLine = {
                        kind: "equipment" as const,
                        id: entry.id,
                        sourceCatalog: entry.sourceCatalog ?? "qb_equipment_models",
                        sourceId: entry.sourceId ?? entry.id ?? null,
                        dealerCost: entry.dealerCost ?? null,
                        title: `${entry.make} ${entry.model}`,
                        make: entry.make,
                        model: entry.model,
                        year: entry.year,
                        quantity: 1,
                        unitPrice: entry.list_price || 0,
                        metadata: {
                          availability_status: availabilityStatusForEntry(entry),
                          stock_number: entry.stock_number ?? null,
                        },
                      };
                      const nextKey = equipmentKeyForLine(nextLine);
                      setDraft((current) => ({
                        ...current,
                        equipment: current.equipment.some((item) => equipmentKeyForLine(item) === nextKey)
                          ? current.equipment
                          : [...current.equipment, nextLine],
                      }));
                    }}
                    onRecommendation={(recommendation) => {
                      setDraft((current) => ({ ...current, recommendation }));
                    }}
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
                    onApply={(allowanceDollars, valuationId) => setDraft((cur) => ({
                      ...cur,
                      tradeAllowance: allowanceDollars,
                      tradeValuationId: valuationId,
                    }))}
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
                          : "manual recommendation request"}
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
      <div className="flex w-full max-w-2xl flex-1 flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Quote Builder</h1>
          <p className="text-sm text-muted-foreground">
            Build quotes with voice, AI chat, or manual entry. Zero-blocking and commercial-grade.
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
                <Button variant="outline" onClick={() => setStep(previousWizardStep)}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> Back
                </Button>
              )}
              {step === "customer" && !hasCustomer && (
                <Button variant="ghost" onClick={handleQuoteForProspect}>
                  Quote for prospect
                </Button>
              )}
              {nextWizardStep && (
                <Button onClick={() => setStep(nextWizardStep)} disabled={wizardNextDisabled}>
                  {nextWizardLabel} <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </Card>

      <QuoteWizardProgress
        steps={WIZARD_STEPS}
        currentStep={step}
        onJumpBack={setStep}
      />

      {step === "customer" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 1: Choose the customer</h2>
            <p className="mt-1 text-sm text-muted-foreground">Search first, then add a new customer only if there is no match. Keep the rest of the quote out of view until this is clear.</p>
          </div>

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
            onManualChange={(field, value) => setDraft((cur) => {
              // Preserve signals on typo fixes (phone, email, name punctuation)
              // but *clear* them when the company name is materially rewritten —
              // keeping Acme's open-deal count attached to "Smith Excavation"
              // would poison the intel panel and the saved quote. Heuristic:
              // clear when the field is customerCompany, a snapshot exists,
              // and the new value is clearly a different company (not a
              // prefix / not a case variation of the old).
              const next = { ...cur, [field]: value };
              if (
                field === "customerCompany" &&
                cur.customerSignals &&
                cur.customerCompany &&
                !isTypoLikeRewrite(cur.customerCompany, value)
              ) {
                next.customerSignals = null;
                next.customerWarmth  = null;
                // The companyId/contactId referred to the prior customer;
                // drop them so downstream reads don't cross-attribute.
                next.companyId = undefined;
                next.contactId = undefined;
              }
              return next;
            })}
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

          <Card className="p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Fast intake</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {([
                { mode: "manual" as QuoteEntryMode, label: "Manual", body: "Use search and simple fields." },
                { mode: "voice" as QuoteEntryMode, label: "Voice", body: "Record the need, then confirm." },
                { mode: "ai_chat" as QuoteEntryMode, label: "AI chat", body: "Describe the job in plain English." },
                { mode: "trade_photo" as QuoteEntryMode, label: "Trade photo", body: "Start with trade context." },
              ]).map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, entryMode: option.mode }))}
                  className={`rounded-lg border p-3 text-left transition ${
                    draft.entryMode === option.mode
                      ? "border-qep-orange bg-qep-orange/5"
                      : "border-border bg-card/40 hover:border-qep-orange/40"
                  }`}
                >
                  <p className="text-sm font-semibold text-foreground">{option.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{option.body}</p>
                </button>
              ))}
            </div>

            {draft.entryMode === "voice" && (
              <div className="mt-4 space-y-2 rounded-lg border border-border/70 bg-background/60 p-3">
                <p className="text-sm font-medium text-foreground">Record the customer need</p>
                <VoiceRecorder
                  onRecorded={(audioBlob, fileName) => {
                    setDraft((current) => ({ ...current, entryMode: "voice" }));
                    voiceMutation.mutate({ blob: audioBlob, fileName });
                  }}
                  disabled={voiceMutation.isPending}
                />
                {voiceMutation.isPending && <p className="text-xs text-muted-foreground">Processing voice note…</p>}
              </div>
            )}

            {draft.entryMode === "ai_chat" && (
              <div className="mt-4 space-y-2 rounded-lg border border-border/70 bg-background/60 p-3">
                <textarea
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  placeholder="Example: Customer needs a compact track loader for land clearing with a mulcher."
                  className="min-h-[88px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => aiIntakeMutation.mutate(aiPrompt.trim())}
                    disabled={aiIntakeMutation.isPending || aiPrompt.trim().length < 12}
                  >
                    {aiIntakeMutation.isPending ? "Building…" : "Build with AI"}
                  </Button>
                </div>
              </div>
            )}

            <label className="mt-4 block space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Opportunity note</span>
              <textarea
                value={draft.voiceSummary ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, voiceSummary: event.target.value }))}
                placeholder="What is the customer trying to accomplish?"
                rows={3}
                className="w-full resize-y rounded border border-input bg-card px-3 py-2 text-sm"
              />
            </label>
          </Card>

          {/* Slice 20c: always-on win-probability strip. Rule-based today;
              becomes the rule-baseline for Move 2's counterfactual engine. */}
          <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} closedHistory={shadowHistory} shadowCalibration={shadowCalibration} />

          {draft.recommendation?.machine && (
            <div className="lg:hidden">
              {intelligencePanel}
            </div>
          )}

          <Card className="border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-sm font-semibold text-blue-200">New-customer guardrails</p>
            <p className="mt-1 text-xs text-blue-100/90">If phone + last name match an existing customer, pick that record from search instead of creating a duplicate. Tax certificate upload stays “attach later” until document storage is wired.</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-blue-100/90">
              <span className="rounded-full border border-blue-400/30 px-2 py-1">Search before create</span>
              <span className="rounded-full border border-blue-400/30 px-2 py-1">Phone + last name dedupe</span>
              <span className="rounded-full border border-blue-400/30 px-2 py-1">Resale certificate: attach later</span>
            </div>
          </Card>

          <CustomerIntelPanel
            customerCompany={draft.customerCompany ?? ""}
            companyId={draft.companyId ?? null}
            signals={draft.customerSignals ?? null}
            warmth={draft.customerWarmth ?? null}
          />

          {!hasCustomer && (
            <p className="text-[11px] text-muted-foreground">
              Select or add a customer, or use "Quote for prospect" from the controls above for a walk-in.
            </p>
          )}
        </div>
      )}

      {step === "equipment" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 2: Pick the machine</h2>
            <p className="mt-1 text-sm text-muted-foreground">Search first. Add one machine, confirm whether it is ready to sell, then move on.</p>
          </div>

          <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} closedHistory={shadowHistory} shadowCalibration={shadowCalibration} />

          {draft.recommendation?.machine && (
            <div className="lg:hidden">
              {intelligencePanel}
            </div>
          )}

          <EquipmentSelector
            onSelect={(entry) => {
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
                metadata: {
                  availability_status: availabilityStatusForEntry(entry),
                  stock_number: entry.stock_number ?? null,
                },
              };
              const nextKey = equipmentKeyForLine(nextLine);
              setDraft((current) => ({
                ...current,
                equipment: current.equipment.some((item) => equipmentKeyForLine(item) === nextKey)
                  ? current.equipment
                  : [...current.equipment, nextLine],
              }));
            }}
            onRecommendation={(recommendation) => {
              setDraft((current) => ({ ...current, recommendation }));
            }}
          />

          {draft.equipment.length > 0 ? (
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Selected equipment</p>
                  <p className="mt-1 text-sm text-muted-foreground">Availability is a simple placeholder until inventory sourcing is fully automated.</p>
                </div>
                {sourceRequiredAwaitingConfirmation.length > 0 && (
                  <Button size="sm" variant="outline" onClick={markAllAvailabilityConfirmationRequested}>
                    Request availability check
                  </Button>
                )}
              </div>
              <div className="mt-3 space-y-2">
                {draft.equipment.map((equipment, index) => {
                  const status = availabilityStatusForLine(equipment);
                  const confirmationRequested = Boolean(equipment.metadata?.availability_confirmation_requested_at);
                  return (
                    <div key={`${equipment.title}-${index}`} className="rounded-lg border border-border/70 bg-card/50 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {equipment.title || `${equipment.make ?? ""} ${equipment.model ?? ""}`.trim() || "Equipment"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {equipment.year ? `${equipment.year} · ` : ""}{equipment.metadata?.stock_number ? `Stock #${equipment.metadata.stock_number}` : "No stock number on file"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                            status === "source_required"
                              ? "bg-amber-500/10 text-amber-300"
                              : "bg-emerald-500/10 text-emerald-400"
                          }`}>
                            {confirmationRequested ? "Request sent" : availabilityLabel(status)}
                          </span>
                          {status === "source_required" && !confirmationRequested && (
                            <Button size="sm" variant="outline" onClick={() => markAvailabilityConfirmationRequested(index)}>
                              Request availability check
                            </Button>
                          )}
                          <label className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1 font-semibold text-foreground">
                            <span className="text-muted-foreground">$</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={100}
                              value={equipment.unitPrice}
                              onChange={(event) => {
                                const parsed = event.target.value === "" ? 0 : Number(event.target.value);
                                if (!Number.isFinite(parsed) || parsed < 0) return;
                                setDraft((current) => ({
                                  ...current,
                                  equipment: current.equipment.map((item, rowIndex) => rowIndex === index ? { ...item, unitPrice: parsed } : item),
                                }));
                              }}
                              className="w-24 bg-transparent text-right text-sm outline-none"
                              aria-label={`Unit price for ${equipment.title}`}
                            />
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const removedLabel = `${equipment.make ?? ""} ${equipment.model ?? ""}`.trim();
                              if (removedLabel.length > 0 && availableOptionsLabel === removedLabel) {
                                setAvailableOptions([]);
                                setAvailableOptionsLabel(null);
                              }
                              setDraft((current) => ({
                                ...current,
                                equipment: current.equipment.filter((_, rowIndex) => rowIndex !== index),
                              }));
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : (
            <Card className="border-dashed p-4 text-sm text-muted-foreground">Select equipment to unlock configuration.</Card>
          )}

          {sourceRequiredAwaitingConfirmation.length > 0 && (
            <Card className="border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-amber-300">Availability needs one click.</p>
              <p className="mt-1 text-xs text-amber-200">This machine must be sourced. Send the availability request before moving forward; verified sourcing will be wired by a later slice.</p>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("customer")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("configure")} disabled={!equipmentCanContinue}>
              Configure <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
          {!equipmentCanContinue && (
            <p className="text-right text-[11px] text-muted-foreground">Select equipment and resolve any source-required availability note.</p>
          )}
        </div>
      )}

      {step === "configure" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 3: Configure the package</h2>
            <p className="mt-1 text-sm text-muted-foreground">Attachments, options, accessories, and warranty stay separated so reps do not scroll through one overloaded list.</p>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap gap-2">
              {([
                { id: "attachment", label: "Attachments" },
                { id: "option", label: "Options" },
                { id: "accessory", label: "Accessories" },
                { id: "warranty", label: "Warranty" },
              ] as Array<{ id: typeof configureTab; label: string }>).map((tab) => {
                const count = draft.attachments.filter((item) => item.kind === tab.id).length;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setConfigureTab(tab.id)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                      configureTab === tab.id
                        ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}{count > 0 ? ` (${count})` : ""}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-3">
              {configureTab === "attachment" && availableOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Compatible for {availableOptionsLabel ?? "selected equipment"}</p>
                  {availableOptions.map((option) => {
                    const selected = draft.attachments.some((attachment) => attachment.id === option.id);
                    return (
                      <div key={option.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/50 p-3">
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

              {draft.attachments.filter((item) => item.kind === configureTab).map((item, index) => {
                const realIndex = draft.attachments.findIndex((candidate) => candidate === item);
                return (
                  <QuoteWorkspaceLineRow
                    key={`${item.kind}-${item.id ?? item.title}-${index}`}
                    label={configureTab}
                    item={item}
                    onPriceChange={(value) => setDraft((current) => ({
                      ...current,
                      attachments: current.attachments.map((line, rowIndex) => rowIndex === realIndex ? { ...line, unitPrice: value } : line),
                    }))}
                    onRemove={() => setDraft((current) => ({
                      ...current,
                      attachments: current.attachments.filter((_, rowIndex) => rowIndex !== realIndex),
                    }))}
                  />
                );
              })}

              {configureTab !== "attachment" || availableOptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  {configureTab === "attachment"
                    ? "No compatible attachment list is loaded yet. Add a manual item below if needed."
                    : `${STEP_LABELS.configure} supports manual ${configureTab} rows until catalog data is seeded.`}
                </div>
              ) : null}

              <div className="grid gap-2 md:grid-cols-[1fr_140px_auto]">
                <input
                  value={customLineTitle}
                  onChange={(event) => setCustomLineTitle(event.target.value)}
                  placeholder={`Add ${configureTab} name`}
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
                <Button
                  size="sm"
                  onClick={() => {
                    addConfigLine(configureTab, { title: customLineTitle, unitPrice: customLinePrice });
                    setCustomLineTitle("");
                    setCustomLinePrice(0);
                  }}
                >
                  Add {configureTab}
                </Button>
              </div>
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("equipment")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("tradeIn")}>Trade-in <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "tradeIn" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 4: Trade-in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Capture the trade once. If the provisional checklist is not complete, this screen shows manager-approval-required messaging for the handoff.</p>
          </div>

          {draft.dealId && (
            <TradeInSection
              dealId={draft.dealId}
              onTradeValueChange={(value, valId) => {
                setDraft((current) => ({
                  ...current,
                  tradeAllowance: value || 0,
                  tradeValuationId: valId,
                }));
              }}
            />
          )}

          <PointShootTradeCard
            dealId={draft.dealId ?? null}
            appliedAllowanceDollars={draft.tradeAllowance || null}
            onApply={(allowanceDollars, valuationId) => setDraft((cur) => ({
              ...cur,
              tradeAllowance: allowanceDollars,
              tradeValuationId: valuationId,
            }))}
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

          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground">Provisional trade checklist</p>
            <p className="mt-1 text-xs text-muted-foreground">This is the temporary SOP surface. Complete what you know; persistence and approval routing for checklist details land in a later slice.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {([
                ["hourMeter", "Hour meter captured"],
                ["undercarriage", "Undercarriage / frame checked"],
                ["hydraulicLeaks", "Hydraulic leaks checked"],
                ["serviceHours", "Engine hours / service noted"],
                ["tiresTracks", "Tires or tracks condition noted"],
                ["photos", "Visible damage photos captured"],
              ] as Array<[keyof typeof tradeChecklist, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded border border-border/70 bg-card/50 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tradeChecklist[key]}
                    onChange={(event) => setTradeChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                    className="h-4 w-4"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </Card>

          {tradeManagerApprovalRequired && (
            <Card className="border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-amber-300">Manager approval required for trade allowance.</p>
              <p className="mt-1 text-xs text-amber-200">The trade value stays in the quote; this checklist note is a provisional handoff until the Trade SOP is finalized.</p>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("configure")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("pricing")}>Pricing placeholder <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "pricing" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 5: Build the price</h2>
            <p className="mt-1 text-sm text-muted-foreground">A simple waterfall: machine, configuration, adders, discount, trade, tax, and customer total.</p>
          </div>

          <Card className="overflow-hidden border-qep-orange/20">
            <div className="bg-qep-orange/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pricing waterfall</p>
              <div className="mt-3 space-y-2 text-sm">
                <SummaryRow label="Equipment" value={money(equipmentTotal)} />
                <SummaryRow label="Configuration" value={money(attachmentTotal)} />
                <SummaryRow label="Freight / PDI / fees" value={money(pricingLineTotal)} />
                <SummaryRow label="Subtotal" value={money(subtotal)} emphasize />
                <SummaryRow label="Discounts + promos" value={`-${money(discountTotal)}`} positive />
                <SummaryRow label="Trade allowance" value={`-${money(draft.tradeAllowance)}`} positive />
                <SummaryRow label="Taxable basis" value={money(taxableBasis)} emphasize />
                <SummaryRow label="Estimated tax" value={money(taxTotal)} />
                <SummaryRow label="Customer total" value={money(customerTotal)} emphasize />
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Price adders</p>
                <p className="mt-1 text-xs text-muted-foreground">Only fill what applies. Empty rows stay out of the quote payload.</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => upsertPricingLine("good_faith", "1% good faith", Math.round(subtotal * 0.01))}
              >
                Set 1% good faith
              </Button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PRICING_ADDER_FIELDS.map((field) => {
                const line = pricingLine(field.kind);
                return (
                  <label key={field.kind} className="rounded-lg border border-border/70 bg-card/50 p-3 text-sm">
                    <span className="font-medium text-foreground">{field.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{field.helper}</span>
                    <div className="mt-2 flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
                      <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="number"
                        min={0}
                        step={field.step}
                        value={line?.unitPrice ?? ""}
                        onChange={(event) => upsertPricingLine(field.kind, field.title, Number(event.target.value) || 0)}
                        placeholder="0"
                        className="w-full bg-transparent text-right text-sm font-semibold outline-none"
                      />
                    </div>
                  </label>
                );
              })}
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground">Discount with reason code</p>
            <p className="mt-1 text-xs text-muted-foreground">A manual discount requires a reason so approval and future review do not guess why margin changed.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Legacy type</span>
                <select
                  value={draft.commercialDiscountType}
                  onChange={(event) => setDraft((current) => ({ ...current, commercialDiscountType: event.target.value as typeof current.commercialDiscountType }))}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="flat">Flat</option>
                  <option value="percent">Percent</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Existing quote discount</span>
                <div className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
                  <span className="text-sm text-muted-foreground">{draft.commercialDiscountType === "percent" ? "%" : "$"}</span>
                  <input
                    type="number"
                    min={0}
                    step={draft.commercialDiscountType === "percent" ? 0.5 : 100}
                    value={draft.commercialDiscountValue || ""}
                    onChange={(event) => setDraft((current) => ({ ...current, commercialDiscountValue: Number(event.target.value) || 0 }))}
                    placeholder="0"
                    className="w-full bg-transparent text-right text-sm font-semibold outline-none"
                  />
                </div>
              </label>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft((current) => ({ ...current, commercialDiscountValue: 0 }))}
                >
                  Clear
                </Button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Saved legacy quote-level discounts remain editable here so older drafts do not hide a margin change. New manual discounts below carry a reason code.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Discount amount</span>
                <div className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={discountLine?.unitPrice ?? ""}
                    onChange={(event) => upsertPricingLine(
                      "discount",
                      "Manual discount",
                      Number(event.target.value) || 0,
                      { reasonCode: discountLine?.reasonCode ?? "competitive_match" },
                    )}
                    placeholder="0"
                    className="w-full bg-transparent text-right text-sm font-semibold outline-none"
                  />
                </div>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Reason code</span>
                <select
                  value={discountLine?.reasonCode ?? "competitive_match"}
                  onChange={(event) => upsertPricingLine(
                    "discount",
                    "Manual discount",
                    discountLine?.unitPrice ?? 0,
                    { reasonCode: event.target.value },
                  )}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                >
                  {DISCOUNT_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground">Tax preview</p>
            <p className="mt-1 text-xs text-muted-foreground">Florida delivery uses delivery county/state when provided. Override only with a clear reason.</p>
            <div className="mt-3 grid gap-2">
              {taxProfiles.map((profile) => {
                const selected = profile.value === draft.taxProfile;
                return (
                  <button
                    key={profile.value}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, taxProfile: profile.value }))}
                    className={`rounded-lg border p-3 text-left transition ${selected ? "border-qep-orange bg-qep-orange/5" : "border-border bg-card/40 hover:border-qep-orange/40"}`}
                  >
                    <p className="text-sm font-medium text-foreground">{profile.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{profile.detail}</p>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Delivery state</span>
                <input
                  value={draft.deliveryState ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, deliveryState: event.target.value.toUpperCase() || null }))}
                  placeholder={selectedBranch?.state_province ?? "FL"}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Delivery county</span>
                <input
                  value={draft.deliveryCounty ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, deliveryCounty: event.target.value || null }))}
                  placeholder="County for FL surtax preview"
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Tax override amount</span>
                <input
                  type="number"
                  min={0}
                  step={25}
                  value={draft.taxOverrideAmount ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, taxOverrideAmount: event.target.value === "" ? null : Number(event.target.value) || 0 }))}
                  placeholder="Leave blank for calculated tax"
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Override reason</span>
                <input
                  value={draft.taxOverrideReason ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, taxOverrideReason: event.target.value || null }))}
                  placeholder="Required when overriding tax"
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-4">
              <TaxBreakdown
                data={taxPreviewQuery.data}
                isLoading={taxPreviewQuery.isLoading}
                isError={taxPreviewQuery.isError}
                enabled={Boolean(draft.branchSlug || draft.deliveryState)}
              />
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("tradeIn")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("promotions")}>Promotions <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "promotions" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 6: Rebates & promotions</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use seeded incentives when they exist. If no program data is present, these clear starter rows keep the skeleton moving.</p>
          </div>

          {activeQuotePackageId ? (
            <IncentiveStack quotePackageId={activeQuotePackageId} />
          ) : (
            <Card className="border-dashed p-4 text-sm text-muted-foreground">Save the draft to run the existing incentive resolver against this quote.</Card>
          )}

          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground">Manual promotion choices</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {PROMOTION_PLACEHOLDERS.map((promo) => {
                const selected = promotionPlaceholderSelected(promo);
                return (
                  <button
                    key={promo.id}
                    type="button"
                    onClick={() => togglePromotion(promo)}
                    className={`rounded-lg border p-3 text-left transition ${
                      selected ? "border-emerald-500/50 bg-emerald-500/10" : "border-border bg-card/40 hover:border-qep-orange/40"
                    }`}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-qep-orange">{promo.source}</p>
                    <p className="mt-2 text-sm font-semibold text-foreground">{promo.title}</p>
                    <p className="mt-1 text-lg font-bold text-emerald-400">−{money(promo.amount)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{promo.detail}</p>
                    <span className="mt-3 inline-flex rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
                      {selected ? "Selected" : "Tap to apply"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("pricing")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("financing")}>Financing <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "financing" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 7: Financing scenarios</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick cash, finance, or view the disabled lease path. Payment math is an estimate and includes TILA guidance.</p>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap gap-2">
              {([
                ["cash", "Cash"],
                ["finance", "Finance"],
                ["lease", "Lease"],
              ] as Array<[FinanceStepTab, string]>).map(([tab, label]) => {
                const disabled = tab === "lease" && !leaseQuotingEnabled;
                return (
                  <button
                    key={tab}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setFinanceStepTab(tab);
                      if (tab === "cash") {
                        const cashScenario = allFinanceScenarios.find((scenario) => scenario.type === "cash" || scenario.kind === "cash");
                        setDraft((current) => ({ ...current, selectedFinanceScenario: cashScenario?.label ?? null }));
                      }
                    }}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                      financeStepTab === tab
                        ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                        : disabled
                          ? "border-border/60 bg-muted/30 text-muted-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}{disabled ? " — unavailable" : ""}
                  </button>
                );
              })}
            </div>

            {financeStepTab === "cash" && (
              <div className="mt-4 rounded-lg border border-border/70 bg-card/50 p-4">
                <p className="text-sm font-semibold text-foreground">Cash quote</p>
                <p className="mt-1 text-xs text-muted-foreground">Customer total due at delivery: {money(customerTotal)}. Down payment remains optional for internal tracking.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <SummaryRow label="Customer total" value={money(customerTotal)} emphasize />
                  <SummaryRow label="Deposit / cash down" value={money(cashDown)} />
                </div>
              </div>
            )}

            {financeStepTab === "finance" && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Cash down</span>
                    <input
                      type="number"
                      min={0}
                      step={500}
                      value={draft.cashDown || ""}
                      onChange={(event) => setDraft((current) => ({ ...current, cashDown: Number(event.target.value) || 0 }))}
                      className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Amount financed</p>
                    <p className="mt-1 text-xl font-semibold text-qep-orange">{money(amountFinanced)}</p>
                  </div>
                </div>

                {financingPreviewQuery.isLoading && <p className="text-xs text-muted-foreground">Calculating scenarios…</p>}
                {financingPreviewQuery.isError && <p className="text-xs text-red-400">Financing preview failed. Continue with cash or try again.</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {financeTabScenarios.length > 0 ? financeTabScenarios.map((scenario) => {
                    const selected = draft.selectedFinanceScenario === scenario.label;
                    return (
                      <button
                        key={scenario.label}
                        type="button"
                        onClick={() => setDraft((current) => ({ ...current, selectedFinanceScenario: scenario.label }))}
                        className={`rounded-lg border p-3 text-left transition ${selected ? "border-qep-orange bg-qep-orange/5" : "border-border bg-card/40 hover:border-qep-orange/40"}`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-qep-orange">{scenario.label}</p>
                        <p className="mt-2 text-lg font-semibold text-foreground">
                          {scenario.monthlyPayment == null ? money(scenario.totalCost ?? customerTotal) : `${money(scenario.monthlyPayment)}/mo`}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {scenario.termMonths ?? 0} months · {(scenario.apr ?? scenario.rate ?? 0).toFixed(2)}% APR · {scenario.lender ?? "Preferred lender"}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={(event) => {
                            event.stopPropagation();
                            saveSelectedFinanceScenario(scenario);
                          }}
                        >
                          Save scenario
                        </Button>
                      </button>
                    );
                  }) : (
                    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No finance scenario seed is available yet. The quote can still proceed as cash/TBD.</div>
                  )}
                </div>
              </div>
            )}

            {financeStepTab === "lease" && (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-4">
                <p className="text-sm font-semibold text-foreground">Lease quoting is not enabled yet</p>
                <p className="mt-1 text-xs text-muted-foreground">FMV and FPPO lease cards stay disabled until feature flag, OEM list, lease rate sheets, and residual tables are seeded.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-card/40 p-3 opacity-70">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">FMV lease</p>
                    <p className="mt-2 text-sm text-muted-foreground">Awaiting residual table.</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card/40 p-3 opacity-70">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">FPPO lease</p>
                    <p className="mt-2 text-sm text-muted-foreground">Awaiting purchase option rules.</p>
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card className="border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-sm font-semibold text-blue-200">TILA estimate disclaimer</p>
            <p className="mt-1 text-xs text-blue-100/90">Payment examples are estimates for discussion only, not a commitment to lend. Final APR, fees, approval, and disclosures come from the lender.</p>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("promotions")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("details")}>Quote details <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "details" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 8: Quote details</h2>
            <p className="mt-1 text-sm text-muted-foreground">Set the handoff details the customer will ask about before anyone sends a document.</p>
          </div>

          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Expiration date</span>
                <input
                  type="date"
                  value={dateInputValue(draft.expiresAt)}
                  onChange={(event) => setDraft((current) => ({ ...current, expiresAt: isoFromDateInput(event.target.value) }))}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
                <span className="text-[11px] text-muted-foreground">Defaults to 30 days when this step opens.</span>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Follow-up reminder</span>
                <input
                  type="datetime-local"
                  value={dateTimeInputValue(draft.followUpAt)}
                  onChange={(event) => setDraft((current) => ({ ...current, followUpAt: isoFromDateTimeInput(event.target.value) }))}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
                <span className="text-[11px] text-muted-foreground">Defaults to 3 days. Final send/log will require it.</span>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Delivery ETA</span>
                <input
                  type="date"
                  value={dateInputValue(draft.deliveryEta)}
                  onChange={(event) => setDraft((current) => ({ ...current, deliveryEta: isoFromDateInput(event.target.value) }))}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Deposit placeholder</span>
                <input
                  type="number"
                  min={0}
                  step={250}
                  value={draft.depositRequiredAmount ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, depositRequiredAmount: event.target.value === "" ? null : Number(event.target.value) || 0 }))}
                  placeholder="Awaiting deposit SOP"
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="mt-4 block space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Special terms</span>
              <textarea
                value={draft.specialTerms ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, specialTerms: event.target.value || null }))}
                placeholder="Subject to availability, freight confirmation, manager approval, or customer-specific terms."
                className="min-h-[90px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
              />
            </label>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-semibold text-foreground">Why this machine</p>
            <p className="mt-1 text-xs text-muted-foreground">QRM can suggest a reason, but the rep must edit or confirm it before customer-facing send.</p>
            <textarea
              value={draft.whyThisMachine ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, whyThisMachine: event.target.value, whyThisMachineConfirmed: false }))}
              placeholder="Explain why this unit fits the customer's job, terrain, timeline, and budget."
              className="mt-3 min-h-[120px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
            />
            <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.whyThisMachineConfirmed === true}
                onChange={(event) => setDraft((current) => ({ ...current, whyThisMachineConfirmed: event.target.checked }))}
                className="h-4 w-4"
              />
              I reviewed this language and confirm it is rep-approved.
            </label>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("financing")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("review")}>Review <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 9: Review + approval</h2>
            <p className="mt-1 text-sm text-muted-foreground">Everything in one plain-English summary. Approval case status is the authoritative gate before any future send step.</p>
          </div>

          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewSummaryBlock title="Customer" rows={[
                ["Name", draft.customerName || draft.customerCompany || "Not set"],
                ["Company", draft.customerCompany || "—"],
                ["Email", draft.customerEmail || "Missing before send"],
                ["Branch", selectedBranch?.display_name ?? (draft.branchSlug || "Missing")],
              ]} />
              <ReviewSummaryBlock title="Equipment" rows={[
                ["Primary", firstEquipment?.title || [firstEquipment?.make, firstEquipment?.model].filter(Boolean).join(" ") || "No equipment"],
                ["Config rows", String(draft.attachments.length)],
                ["Trade", draft.tradeAllowance > 0 ? money(draft.tradeAllowance) : "No trade"],
                ["Availability", sourceRequiredAwaitingConfirmation.length > 0 ? "Needs sourcing request" : "Ready for review"],
              ]} />
              <ReviewSummaryBlock title="Pricing + tax" rows={[
                ["Subtotal", money(subtotal)],
                ["Discounts", `-${money(discountTotal)}`],
                ["Taxable basis", money(taxableBasis)],
                ["Tax", money(taxTotal)],
                ["Customer total", money(customerTotal)],
              ]} />
              <ReviewSummaryBlock title="Finance + details" rows={[
                ["Scenario", financeMethodLabel],
                ["Amount financed", money(amountFinanced)],
                ["Expires", dateInputValue(draft.expiresAt) || "Default needed"],
                ["Delivery ETA", dateInputValue(draft.deliveryEta) || "TBD"],
                ["Why confirmed", draft.whyThisMachineConfirmed ? "Yes" : "Needs rep confirm"],
              ]} />
            </div>
          </Card>

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

          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Approval handoff</p>
                <p className="mt-1 text-xs text-muted-foreground">Submit routes through the existing approval-case workflow. Future document/send steps should trust activeApprovalCase.canSend, not a duplicate UI flag.</p>
              </div>
              <Button onClick={() => void submitApprovalMutation.mutateAsync()} disabled={!canSubmitForApproval || submitApprovalMutation.isPending}>
                {submitApprovalMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {approvalPending ? "Approval pending" : approvalGranted ? "Approved" : "Submit for approval"}
              </Button>
            </div>
          </Card>

          {activeQuotePackageId ? (
            <QuoteReviewWorkflowPanels
              quotePackageId={activeQuotePackageId}
              draft={draft}
              financeScenarios={allFinanceScenarios}
              computed={{ subtotal, discountTotal, netTotal, taxTotal, customerTotal, cashDown, amountFinanced }}
              sendReadiness={packetReadiness.send}
              requiresManagerApproval={approvalState.requiresManagerApproval}
              userRole={userRoleQuery.data ?? null}
              quoteStatus={quoteStatus}
              onQuoteStatusChange={handleQuoteStatusChange}
              showSendSection={false}
            />
          ) : (
            <Card className="border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-amber-300">Save required for approval case details</p>
              <p className="mt-1 text-xs text-amber-200">Autosave starts once customer and equipment are present, or use Save Draft above.</p>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("details")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button variant="outline" onClick={() => setStep("document")}>Document <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "document" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 10: Document preview</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Generate a customer-facing PDF preview. Until stored document artifacts are wired, this is a local PDF/print fallback and not a final persisted artifact.
            </p>
          </div>

          <Card className="border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-sm font-semibold text-blue-100">Preview/fallback mode</p>
            <p className="mt-1 text-xs text-blue-100/90">
              The wizard reuses the existing Quote PDF renderer and printable fallback. No R2/object-storage artifact is created in this slice.
            </p>
          </Card>

          {customerFacingDocumentBlocker && (
            <Card className="border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-amber-300">Document blocked</p>
              <p className="mt-1 text-xs text-amber-200">{customerFacingDocumentBlocker}</p>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Quote document preview</p>
                <p className="mt-2 text-base font-semibold text-foreground">{quoteTitle}</p>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <SummaryRow label="Customer" value={draft.customerName || draft.customerCompany || "Customer"} />
                  <SummaryRow label="Customer total" value={money(customerTotal)} emphasize />
                  <SummaryRow label="Equipment lines" value={String(draft.equipment.length)} />
                  <SummaryRow label="Financing" value={financeMethodLabel} />
                </div>
                <div className="mt-4 rounded-lg border border-border/70 bg-background/50 p-3 text-xs text-muted-foreground">
                  {documentFallbackGeneratedAt
                    ? `Preview generated ${shortDateTime(documentFallbackGeneratedAt)}. This confirms only the local fallback document, not stored final artifact persistence.`
                    : "Click Generate Preview PDF to open/download the current proposal preview."}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                <Button onClick={() => void handleGenerateFallbackDocument()} disabled={Boolean(customerFacingDocumentBlocker) || pdfGenerating}>
                  {pdfGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
                  Generate Preview PDF
                </Button>
                <Button variant="outline" onClick={() => void handleGenerateFallbackDocument()} disabled={Boolean(customerFacingDocumentBlocker) || pdfGenerating}>
                  <Printer className="mr-1 h-4 w-4" /> Print Preview
                </Button>
              </div>
            </div>
            {documentActionError && <p className="mt-3 text-xs text-rose-400">{documentActionError}</p>}
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("review")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("send")} disabled={!documentReady}>Send & log <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "send" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Step 11: Send & log</h2>
            <p className="mt-1 text-sm text-muted-foreground">Preview, email, or text the quote only after clean approval and a follow-up date are present.</p>
          </div>

          {customerFacingDocumentBlocker && (
            <Card className="border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-amber-300">Customer send blocked</p>
              <p className="mt-1 text-xs text-amber-200">{customerFacingDocumentBlocker}</p>
            </Card>
          )}

          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <ReadinessRow label="Approval case" ready={approvalCaseCanSend} detail={approvalBlocker ?? "canSend is true"} />
              <ReadinessRow label="Document" ready={documentReady} detail={documentReady ? "Local preview fallback generated" : "Generate Step 10 preview first"} />
              <ReadinessRow label="Follow-up" ready={Boolean(draft.followUpAt)} detail={draft.followUpAt ? (shortDateTime(draft.followUpAt) ?? "Scheduled") : "Required before email/text"} />
              <ReadinessRow label="Tax" ready={taxResolved} detail={taxResolutionBlocker ?? "Tax preview resolved"} />
              <ReadinessRow label="Why this machine" ready={!whyThisMachineRequired || draft.whyThisMachineConfirmed === true} detail={whyThisMachineBlocker ?? "Rep confirmed or not required"} />
            </div>
            <label className="mt-4 block space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Required follow-up date</span>
              <input
                type="date"
                value={dateInputValue(draft.followUpAt)}
                onChange={(event) => setDraft((current) => ({ ...current, followUpAt: isoFromDateInput(event.target.value) }))}
                className="w-full rounded border border-input bg-card px-3 py-2 text-sm sm:max-w-xs"
              />
              <span className="block text-xs text-muted-foreground">Defaults to +3 days when absent. Email/text send/log remains blocked without this date.</span>
            </label>
          </Card>

          <Card className="p-4">
            <div className="grid gap-3 lg:grid-cols-3">
              <QuoteSendActionCard
                icon={<FileText className="h-4 w-4" />}
                title="Preview Quote"
                detail="Open the local PDF/print fallback and log a preview event. Does not mark sent."
                readiness={previewReadiness}
                busy={deliveryActionBusy === "preview" || pdfGenerating}
                onClick={() => void handleQuoteSendAction("preview")}
              />
              <QuoteSendActionCard
                icon={<Mail className="h-4 w-4" />}
                title="Email Quote"
                detail={graphEmailEnabled ? "Graph flag enabled, but provider endpoint must be wired before customer send." : "Microsoft Graph email is not configured; no email will be sent."}
                readiness={emailReadiness}
                setupBlocked={!graphEmailEnabled}
                busy={deliveryActionBusy === "email"}
                onClick={() => void handleQuoteSendAction("email")}
              />
              <QuoteSendActionCard
                icon={<Smartphone className="h-4 w-4" />}
                title="Text Quote"
                detail={textQuoteEnabled ? "Twilio flag enabled, but provider endpoint must be wired before customer send." : "Twilio text delivery is not configured; no text will be sent."}
                readiness={textReadiness}
                setupBlocked={!textQuoteEnabled}
                busy={deliveryActionBusy === "text"}
                onClick={() => void handleQuoteSendAction("text")}
              />
            </div>
            {deliveryActionMessage && <p className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">{deliveryActionMessage}</p>}
            {deliveryActionError && <p className="mt-3 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{deliveryActionError}</p>}
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("document")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button variant="outline" onClick={() => void handleSaveClick()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Save follow-up
            </Button>
          </div>
        </div>
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
      <aside className="hidden w-80 shrink-0 lg:block">
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

function QuoteWorkspaceLineRow({
  label,
  item,
  onPriceChange,
  onRemove,
}: {
  label: string;
  item: QuoteLineItemDraft;
  onPriceChange: (value: number) => void;
  onRemove: () => void;
}) {
  const title = item.title || [item.make, item.model].filter(Boolean).join(" ") || "Line item";
  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-card/50 p-3 sm:grid-cols-[120px_minmax(0,1fr)_150px_auto] sm:items-center">
      <span className="rounded-full bg-muted px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">Qty {item.quantity}</p>
      </div>
      <label className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
        <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="number"
          min={0}
          step={100}
          value={item.unitPrice}
          onChange={(event) => onPriceChange(Number(event.target.value) || 0)}
          className="w-full bg-transparent text-right text-sm font-semibold outline-none"
          aria-label={`Price for ${title}`}
        />
      </label>
      <Button size="icon" variant="ghost" onClick={onRemove} aria-label={`Remove ${title}`}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

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

function SummaryRow({
  label,
  value,
  emphasize = false,
  positive = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  positive?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${emphasize ? "border-t border-border pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${emphasize ? "text-qep-orange" : positive ? "text-emerald-400" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function ReviewSummaryBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <div className="mt-3 space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">{label}</span>
            <span className="max-w-[60%] text-right font-medium text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadinessRow({
  label,
  ready,
  detail,
}: {
  label: string;
  ready: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-border/60 bg-background/50 px-3 py-2">
      <div>
        <p className="font-medium text-foreground">{label}</p>
        {!ready && detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
        ready ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300"
      }`}>
        {ready ? "ready" : "open"}
      </span>
    </div>
  );
}

function QuoteWizardProgress({
  steps,
  currentStep,
  onJumpBack,
}: {
  steps: WizardStepMeta[];
  currentStep: Step;
  onJumpBack: (step: Step) => void;
}) {
  const currentIndex = steps.findIndex((item) => item.id === currentStep);
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Wizard progress</p>
          <p className="mt-1 text-sm font-medium text-foreground">{steps[currentIndex]?.label ?? "Customer"}</p>
        </div>
        <span className="rounded-full bg-qep-orange/10 px-3 py-1 text-xs font-semibold text-qep-orange">
          Step {Math.max(1, currentIndex + 1)} of {steps.length}
        </span>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Finished steps remain editable. Use the green buttons to jump back without losing later draft work.
      </p>
      <div className="mt-3 grid grid-flow-col gap-2 overflow-x-auto pb-1 [grid-auto-columns:minmax(7.5rem,1fr)]">
        {steps.map((item, index) => {
          const isCurrent = item.id === currentStep;
          const isComplete = index < currentIndex;
          const isFuture = index > currentIndex;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { if (!isFuture) onJumpBack(item.id); }}
              disabled={isFuture}
              className={`min-h-[4.25rem] rounded-lg border px-3 py-2 text-left text-[11px] leading-tight transition ${
                isCurrent
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange shadow-[0_0_0_1px_rgba(249,115,22,0.25)]"
                  : isComplete
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:border-emerald-400/60"
                    : "border-border/60 bg-muted/20 text-muted-foreground"
              }`}
            >
              <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">{item.number}.</span>
              <span className="mt-1 block whitespace-normal break-words font-semibold">{item.shortLabel}</span>
              <span className="mt-1 block text-[10px] opacity-80">
                {isCurrent ? "Now" : isComplete ? "Edit" : item.owner === "placeholder" ? "Later" : "Locked"}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function QuoteSendActionCard({
  icon,
  title,
  detail,
  readiness,
  setupBlocked,
  busy,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  readiness: { ready: boolean; missing: string[] };
  setupBlocked?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/50 p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-qep-orange/10 p-2 text-qep-orange">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="mt-3 rounded border border-border/60 bg-card/50 px-3 py-2 text-xs">
        {readiness.ready ? (
          <span className="text-emerald-300">Ready to log this action.</span>
        ) : (
          <span className="text-amber-300">Blocked: {readiness.missing.join(", ")}</span>
        )}
      </div>
      {setupBlocked && (
        <p className="mt-2 text-xs text-blue-200">Setup blocked — this button logs a draft/setup-blocked event only; it does not send to the customer.</p>
      )}
      <Button className="mt-4 w-full" variant={setupBlocked ? "outline" : "default"} onClick={onClick} disabled={busy || !readiness.ready}>
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        {setupBlocked ? "Log setup-blocked" : title}
      </Button>
    </div>
  );
}

function CustomerSection({
  draft,
  onPick,
  onManualChange,
  onClear,
}: {
  draft: QuoteWorkspaceDraft;
  onPick: (picked: PickedCustomer) => void;
  onManualChange: (
    field: "customerName" | "customerCompany" | "customerPhone" | "customerEmail",
    value: string,
  ) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const hasCustomer = Boolean(
    draft.customerCompany?.trim() || draft.customerName?.trim(),
  );
  const fromCrm = Boolean(draft.contactId || draft.companyId);

  // Chip view — something's selected / entered
  if (hasCustomer && !manualMode) {
    return (
      <SelectedCustomerChip
        customerName={draft.customerName ?? ""}
        customerCompany={draft.customerCompany ?? ""}
        customerPhone={draft.customerPhone ?? ""}
        customerEmail={draft.customerEmail ?? ""}
        fromCrm={fromCrm}
        onChange={() => {
          onClear();
          setQuery("");
          setManualMode(false);
        }}
      />
    );
  }

  // Manual mode — 4-field form for brand-new customers
  if (manualMode) {
    return (
      <CustomerInfoCard
        customerName={draft.customerName ?? ""}
        customerCompany={draft.customerCompany ?? ""}
        customerPhone={draft.customerPhone ?? ""}
        customerEmail={draft.customerEmail ?? ""}
        onChange={onManualChange}
      />
    );
  }

  // Default — picker
  return (
    <CustomerPicker
      query={query}
      onQueryChange={setQuery}
      onPick={(picked) => {
        onPick(picked);
        setQuery("");
      }}
      onRequestManualEntry={(startingQuery) => {
        // Seed customer name with what the rep was typing so they don't
        // have to retype it in the manual form
        onManualChange("customerName", startingQuery);
        setManualMode(true);
      }}
    />
  );
}
