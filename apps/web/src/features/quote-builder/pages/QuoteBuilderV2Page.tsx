import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { SendQuoteSection } from "../components/SendQuoteSection";
import { MarginFloorGate } from "../components/MarginFloorGate";
import { useAuth } from "@/hooks/useAuth";
import {
  getApplicableThreshold,
  isUnderThreshold,
  logMarginException,
} from "@/features/admin/lib/pricing-discipline-api";
import { MarginCheckBanner } from "../components/MarginCheckBanner";
import { TradeInSection } from "../components/TradeInSection";
import { TaxBreakdown } from "../components/TaxBreakdown";
import {
  buildQuoteSavePayload,
  getAiEquipmentRecommendation,
  getClosedDealsAudit,
  getFactorVerdicts,
  getSavedQuotePackage,
  saveQuotePackage,
  searchCatalog,
  submitQuoteForApproval,
  type QuotePackageSaveResponse,
  type QuoteFinancingRequest,
} from "../lib/quote-api";
import { computeQuoteWorkspace } from "../lib/quote-workspace";
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
import { BranchDocumentHeader, BranchDocumentFooter } from "@/components/BranchDocumentHeader";
import { useQuotePDF } from "../hooks/useQuotePDF";
import { useQuoteFinancingPreview } from "../hooks/useQuoteFinancingPreview";
import { useQuoteTaxPreview } from "../hooks/useQuoteTaxPreview";
import { buildCustomFinanceScenario } from "../lib/custom-finance";
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

// Slice 20a: customer is its own step between intake and equipment. Before
// this change the CustomerSection lived on the entry screen alongside the
// intake-mode picker, and AI/Voice mutations auto-advanced straight to
// equipment — so reps submitting via AI chat were jumping past customer
// selection entirely. Splitting the step makes "who is this quote for?"
// explicit and is the anchor for the Customer Digital Twin intel panel.
type Step = "entry" | "customer" | "equipment" | "tradeIn" | "financing" | "review";
type BuilderMode = "workspace" | "guided";
type AutoSaveState = "idle" | "local" | "saving" | "saved" | "error";

const STEP_STORAGE_PREFIX = "qep.quote-builder.last-step.";
const STEP_LABELS: Record<Step, string> = {
  entry: "Entry",
  customer: "Customer",
  equipment: "Equipment",
  tradeIn: "Trade-In",
  financing: "Financing",
  review: "Review",
};

interface CatalogEntryMatch {
  id?: string;
  sourceCatalog?: QuoteLineItemDraft["sourceCatalog"];
  sourceId?: string | null;
  dealerCost?: number | null;
  make: string;
  model: string;
  year: number | null;
  list_price?: number;
  attachments?: Array<{ id: string; name: string; price: number }>;
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

function readPersistedStep(quotePackageId: string | null): Step | null {
  if (!quotePackageId || typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(`${STEP_STORAGE_PREFIX}${quotePackageId}`);
  if (raw === "entry" || raw === "customer" || raw === "equipment" || raw === "tradeIn" || raw === "financing" || raw === "review") {
    return raw;
  }
  return null;
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

function statusLabel(status: string | null | undefined): string {
  return (status ?? "draft").replace(/_/g, " ");
}

const QuoteReviewWorkflowPanels = lazy(() =>
  import("../components/QuoteReviewWorkflowPanels").then((module) => ({
    default: module.QuoteReviewWorkflowPanels,
  }))
);

export function QuoteBuilderV2Page() {
  const [searchParams] = useSearchParams();
  const packageId = searchParams.get("package_id") || "";
  const dealId = searchParams.get("deal_id") || searchParams.get("crm_deal_id") || "";
  const contactId = searchParams.get("contact_id") || searchParams.get("crm_contact_id") || "";
  const [step, setStep] = useState<Step>("entry");
  const [builderMode, setBuilderMode] = useState<BuilderMode>("workspace");
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
  const lastAutoSaveSignatureRef = useRef<string>("");
  const [customFinanceEnabled, setCustomFinanceEnabled] = useState(false);
  const [customFinanceRate, setCustomFinanceRate] = useState<number | null>(null);
  const [customFinanceTermMonths, setCustomFinanceTermMonths] = useState<number | null>(null);
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
  const queryClient = useQueryClient();

  const branchesQ = useActiveBranches();
  const branches = branchesQ.data ?? [];
  const selectedBranch = branches.find((branch) => branch.slug === draft.branchSlug);
  const {
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
    setDraft((current) => ({ ...current, ...hydrateDraftFromSavedQuote(existingQuote) }));
    setStep(readPersistedStep(nextKey) ?? "review");
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
  });

  useEffect(() => {
    const nextTaxTotal = draft.branchSlug ? Math.round((taxPreviewQuery.data?.total_tax ?? 0) * 100) / 100 : 0;
    setDraft((current) => current.taxTotal === nextTaxTotal
      ? current
      : { ...current, taxTotal: nextTaxTotal });
  }, [draft.branchSlug, taxPreviewQuery.data?.total_tax]);

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
      const parsed = JSON.parse(raw) as ScenarioSelection & { at?: string };
      // Older-than-10-minute handoffs are suspicious (closed tab, came back later)
      if (parsed.at) {
        const ageMs = Date.now() - new Date(parsed.at).getTime();
        if (ageMs > 10 * 60 * 1000) return;
      }
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

  async function handleSaveClick() {
    // Resolve threshold just-in-time so a new workspace-default created
    // in a sibling tab applies to this session without a refresh.
    const { threshold } = await getApplicableThreshold(null);
    const thresholdPct = threshold ? Number(threshold.min_margin_pct) : null;
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
  }

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

  useEffect(() => {
    persistStep(activeQuotePackageId, step);
  }, [activeQuotePackageId, step]);

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
  const showQuoteActions = Boolean(activeQuotePackageId);
  const displayedSavedAt = lastSavedAt ?? activeQuoteUpdatedAt;
  const displayedSavedLabel = shortDateTime(displayedSavedAt);
  const financeMethodLabel =
    selectedFinanceScenario?.label
    ?? draft.selectedFinanceScenario
    ?? (amountFinanced > 0 ? "Cash / TBD" : "Cash");
  const quoteTitle =
    activeQuoteNumber
    ?? (activeQuotePackageId ? `Quote ${activeQuotePackageId.slice(0, 8)}` : "New quote");
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
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!packetReadiness.draft.ready || saveMutation.isPending) return;
      void handleSaveClick();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
    void downloadPDF({
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
      branch: (() => {
        const branch = selectedBranch as unknown as Record<string, unknown> | undefined;
        return {
          name: (branch?.display_name as string) ?? "Quality Equipment & Parts",
          address: (branch?.address_line1 as string) ?? undefined,
          city: (branch?.city as string) ?? undefined,
          state: (branch?.state_province as string) ?? undefined,
          postalCode: (branch?.postal_code as string) ?? undefined,
          phone: (branch?.phone_main as string) ?? undefined,
          email: (branch?.email_main as string) ?? undefined,
          website: (branch?.website_url as string) ?? undefined,
          footerText: (branch?.doc_footer_text as string) ?? undefined,
        };
      })(),
    });
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
    if (approvalGranted && packetReadiness.send.ready) {
      setReviewSendOpen(true);
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
        : approvalGranted && packetReadiness.send.ready
          ? "Review & Send"
          : canSubmitForApproval
            ? "Submit Approval"
            : "Save Draft";
  const primaryActionDisabled =
    saveMutation.isPending
    || submitApprovalMutation.isPending
    || (!packetReadiness.draft.ready && primaryActionLabel !== "Review & Send");

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
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {packetReadiness.draft.ready
                  ? "Cmd-S saves. Auto-save runs every 10 seconds when the draft is server-ready."
                  : packetReadiness.draft.missing.length > 0
                    ? `Missing: ${packetReadiness.draft.missing.join(", ")}`
                    : "Start the quote to enable save."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
            <div className="text-right">
              <p className="font-kpi text-2xl font-extrabold tabular-nums text-qep-orange">
                {money(customerTotal)}
              </p>
              <p className="text-[11px] text-muted-foreground">{financeMethodLabel}</p>
            </div>
            <div className="flex rounded-lg border border-border bg-muted/30 p-1">
              {(["workspace", "guided"] as BuilderMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBuilderMode(mode)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    builderMode === mode
                      ? "bg-qep-orange text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "workspace" ? "Workspace" : "Guided"}
                </button>
              ))}
            </div>
            <Button onClick={handlePrimaryAction} disabled={primaryActionDisabled}>
              {saveMutation.isPending || submitApprovalMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : approvalGranted && packetReadiness.send.ready ? (
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
                    className="min-h-[96px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
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
                  { mode: "manual" as QuoteEntryMode, label: "Trade Photo", icon: Camera, body: "Open trade capture first.", action: () => { setDraft((cur) => ({ ...cur, entryMode: "manual" })); setTradeExpanded(true); } },
                ]).map(({ mode, label, icon: Icon, body, action }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={action}
                    className={`min-h-[116px] rounded-lg border p-3 text-left transition hover:border-qep-orange/60 ${
                      draft.entryMode === mode && label !== "Trade Photo"
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
                    taxEnabled={Boolean(draft.branchSlug)}
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
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition hover:border-qep-orange/50 hover:text-foreground"
              >
                <Sparkles className="h-4 w-4 text-qep-orange" />
                Ask about this quote...
              </button>
            </Card>

            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Signals</p>
              <div className="mt-3">
                <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} closedHistory={shadowHistory} shadowCalibration={shadowCalibration} />
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

      <div className="flex gap-2">
        {([
          { id: "entry", label: "Entry" },
          { id: "customer", label: "Customer" },
          { id: "equipment", label: "Equipment" },
          { id: "tradeIn", label: "Trade-In" },
          { id: "financing", label: "Financing" },
          { id: "review", label: "Review" },
        ] as Array<{ id: Step; label: string }>).map((currentStep, index) => (
          <button
            key={currentStep.id}
            onClick={() => setStep(currentStep.id)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              step === currentStep.id
                ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                : "border-border text-muted-foreground hover:border-foreground/20"
            }`}
          >
            {index + 1}. {currentStep.label}
          </button>
        ))}
      </div>

      {step === "entry" && (
        <div className="space-y-4">
          {branches.length > 0 && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <select
                value={draft.branchSlug}
                onChange={(event) => setDraft((current) => ({ ...current, branchSlug: event.target.value }))}
                className="rounded border px-2 py-1.5 text-sm bg-background"
              >
                <option value="">Select quoting branch…</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.slug}>{branch.display_name}</option>
                ))}
              </select>
            </div>
          )}

          <h2 className="text-sm font-semibold text-foreground">How would you like to build this quote?</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {([
              { mode: "voice" as QuoteEntryMode, icon: Mic, label: "Voice", desc: "Record a deal description — AI populates the quote workspace" },
              { mode: "ai_chat" as QuoteEntryMode, icon: MessageSquare, label: "AI Chat", desc: "Type the opportunity — AI recommends the setup" },
              { mode: "manual" as QuoteEntryMode, icon: FileText, label: "Manual", desc: "Build the quote directly from the commercial workspace" },
              { mode: "trade_photo" as QuoteEntryMode, icon: Camera, label: "Trade Photo", desc: "Start with Point-Shoot-Trade, then finish the quote" },
            ]).map(({ mode, icon: Icon, label, desc }) => (
              <button
                key={mode}
                onClick={() => {
                  setDraft((current) => ({ ...current, entryMode: mode }));
                  // Slice 20a: manual mode now advances to the Customer
                  // step (not equipment) so "who is this for?" happens
                  // before the rep builds line items.
                  if (mode === "manual") {
                    setStep("customer");
                  } else if (mode === "trade_photo") {
                    setStep("tradeIn");
                  }
                }}
                className={`rounded-xl border p-4 text-left transition hover:border-qep-orange/50 ${
                  draft.entryMode === mode ? "border-qep-orange bg-qep-orange/5" : "border-border"
                }`}
              >
                <Icon className="h-6 w-6 text-qep-orange" />
                <p className="mt-2 font-semibold text-foreground">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
              </button>
            ))}
          </div>

          {draft.entryMode === "voice" && (
            <Card className="p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Voice intake</p>
              <p className="text-xs text-muted-foreground">
                Record the customer need and let the voice-to-QRM pipeline seed the commercial workspace with usable field intelligence.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">What to listen for</p>
                  <p className="mt-1 text-sm text-foreground">Decision timing, equipment intent, budget friction, and the next promised follow-up.</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Why it matters</p>
                  <p className="mt-1 text-sm text-foreground">A strong voice note should reduce manual entry and sharpen the next pipeline move.</p>
                </div>
              </div>
              <VoiceRecorder
                onRecorded={(audioBlob, fileName) => {
                  voiceMutation.mutate({ blob: audioBlob, fileName });
                }}
                disabled={voiceMutation.isPending}
              />
              {voiceMutation.isPending && (
                <p className="text-xs text-muted-foreground">Processing voice note and commercial recommendation…</p>
              )}
              {voiceMutation.isError && (
                <p className="text-xs text-red-400">
                  {voiceMutation.error instanceof Error ? voiceMutation.error.message : "Voice processing failed"}
                </p>
              )}
            </Card>
          )}

          {draft.entryMode === "ai_chat" && (
            <Card className="space-y-3 p-4">
              <p className="text-sm font-medium text-foreground">AI chat intake</p>
              <p className="text-xs text-muted-foreground">
                Describe the customer need in plain language. QEP will recommend the machine setup and seed the commercial workspace.
              </p>
              <textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="Example: Customer needs a compact track loader for land clearing with mulching attachment and financing options under $2,500/month."
                className="min-h-[120px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
              />
              {aiIntakeMutation.isError && (
                <p className="text-xs text-red-400">
                  {aiIntakeMutation.error instanceof Error ? aiIntakeMutation.error.message : "AI intake failed"}
                </p>
              )}
              <div className="flex justify-end">
                <Button
                  onClick={() => aiIntakeMutation.mutate(aiPrompt.trim())}
                  disabled={aiIntakeMutation.isPending || aiPrompt.trim().length < 12}
                >
                  {aiIntakeMutation.isPending ? "Building workspace..." : "Build with AI"}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {step === "customer" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Who is this quote for?</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick an existing customer for Digital Twin signals, or add a brand-new one. Quotes for walk-in prospects can use a placeholder name.
            </p>
          </div>

          {/* Slice 20c: always-on win-probability strip. Rule-based today;
              becomes the rule-baseline for Move 2's counterfactual engine. */}
          <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} closedHistory={shadowHistory} shadowCalibration={shadowCalibration} />

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

          <CustomerIntelPanel
            customerCompany={draft.customerCompany ?? ""}
            companyId={draft.companyId ?? null}
            signals={draft.customerSignals ?? null}
            warmth={draft.customerWarmth ?? null}
          />

          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" onClick={() => setStep("entry")}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div className="flex items-center gap-2">
              {/* "Quote for prospect" escape hatch — seeds a placeholder
                  so reps can build a spec quote for a walk-in without a
                  real CRM match. Rep can edit the name later on this
                  step; the save path stores it as a normal quote. */}
              {!hasCustomer && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft((cur) => ({
                      ...cur,
                      customerName:    cur.customerName    || "Walk-in prospect",
                      customerCompany: cur.customerCompany || "Walk-in prospect",
                      customerSignals: null,
                      customerWarmth:  null,
                    }));
                    setStep("equipment");
                  }}
                >
                  Quote for prospect
                </Button>
              )}
              <Button onClick={() => setStep("equipment")} disabled={!hasCustomer}>
                Equipment <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
          {!hasCustomer && (
            <p className="text-right text-[11px] text-muted-foreground">
              Select or add a customer, or use "Quote for prospect" for a walk-in.
            </p>
          )}
        </div>
      )}

      {step === "equipment" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Commercial workspace</h2>

          <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} closedHistory={shadowHistory} shadowCalibration={shadowCalibration} />

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

          {/* Mobile-only intelligence panel + Deal Coach (desktop shows in right column) */}
          <div className="space-y-3 lg:hidden">
            {intelligencePanel}
            {draft.equipment.length > 0 && (
              <DealCoachSidebar
                draft={draft}
                computed={{ equipmentTotal, attachmentTotal, subtotal, netTotal, marginAmount, marginPct }}
                quotePackageId={activeQuotePackageId}
              />
            )}
          </div>

          {draft.equipment.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Selected Equipment</p>
              {draft.equipment.map((equipment, index) => (
                <div key={`${equipment.title}-${index}`} className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <div>
                    <span className="text-sm font-medium">
                      {equipment.make} {equipment.model} {equipment.year ? `(${equipment.year})` : ""}
                    </span>
                    <div className="mt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
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
                  <label className="flex items-center gap-1 font-semibold text-foreground">
                    <span className="text-muted-foreground">$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={100}
                      value={equipment.unitPrice}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        const parsed = nextValue === "" ? 0 : Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) return;
                        setDraft((current) => ({
                          ...current,
                          equipment: current.equipment.map((item, rowIndex) =>
                            rowIndex === index
                              ? { ...item, unitPrice: parsed }
                              : item,
                          ),
                        }));
                      }}
                      aria-label={`Unit price for ${equipment.make ?? ""} ${equipment.model ?? ""}`.trim()}
                      className="w-28 rounded border border-input bg-card px-2 py-1 text-right text-sm focus:border-primary focus:outline-none"
                    />
                  </label>
                </div>
              ))}
            </Card>
          )}

          {availableOptions.length > 0 && (
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Base &amp; Options</p>
                  <p className="mt-1 text-sm text-foreground">
                    Compatible options for {availableOptionsLabel ?? "the selected base"}.
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {availableOptions.map((option) => {
                  const selected = draft.attachments.some((attachment) => attachment.id === option.id);
                  return (
                    <div
                      key={option.id}
                      className="flex items-center justify-between rounded-lg border border-border/70 bg-card/50 p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{option.name}</p>
                        <p className="text-xs text-muted-foreground">
                          ${option.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={selected ? "outline" : "default"}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            attachments: selected
                              ? current.attachments.filter((attachment) => attachment.id !== option.id)
                              : [
                                  ...current.attachments,
                                  {
                                    kind: "attachment",
                                    id: option.id,
                                    sourceCatalog: "qb_attachments",
                                    sourceId: option.id,
                                    dealerCost: null,
                                    title: option.name,
                                    quantity: 1,
                                    unitPrice: option.price,
                                  },
                                ],
                          }))
                        }
                      >
                        {selected ? "Remove" : "Add"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card className="border-qep-orange/20 bg-qep-orange/5 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-qep-orange">Commercial Readiness</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Quote Workspace</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {draft.equipment.length > 0 ? "Machine selected" : "Select a machine to continue"}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Decision Rail</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {approvalState.requiresManagerApproval ? "Manager review likely" : "Commercially clear so far"}
                </p>
              </div>
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("customer")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button
              onClick={() => setStep("tradeIn")}
              disabled={draft.equipment.length === 0}
            >
              Trade-In <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === "tradeIn" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Trade-In</h2>
          <p className="text-xs text-muted-foreground">
            Capture the customer trade once here. This is the only trade-in source used by financing, review, and save.
          </p>

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

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("equipment")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("financing")}>Financing <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "financing" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Financing</h2>

          {branches.length > 1 && !draft.branchSlug && (
            <Card className="border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-medium text-amber-400">Select a quoting branch to calculate tax</p>
              <p className="mt-1 text-xs text-amber-300">
                Draft save stays enabled, but tax and send readiness remain unresolved until a branch is selected.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-amber-300" />
                <select
                  value={draft.branchSlug}
                  onChange={(event) => setDraft((current) => ({ ...current, branchSlug: event.target.value }))}
                  className="rounded border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="">Select quoting branch…</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.slug}>{branch.display_name}</option>
                  ))}
                </select>
              </div>
            </Card>
          )}

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
            taxEnabled={Boolean(draft.branchSlug)}
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

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("tradeIn")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("review")}>Review <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Review Quote</h2>

          <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} closedHistory={shadowHistory} shadowCalibration={shadowCalibration} />

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

          <Card className="p-4 space-y-3">
            {draft.branchSlug && (
              <BranchDocumentHeader branchSlug={draft.branchSlug} className="pb-3 border-b mb-2" />
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Equipment</span>
              <span className="font-medium">${equipmentTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Attachments</span>
              <span className="font-medium">${attachmentTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold">${subtotal.toLocaleString()}</span>
            </div>
            {discountTotal > 0 && (
              <div className="flex justify-between text-sm text-emerald-400">
                <span>Commercial Discount</span>
                <span>-${discountTotal.toLocaleString()}</span>
              </div>
            )}
            {draft.tradeAllowance > 0 && (
              <div className="flex justify-between text-sm text-emerald-400">
                <span>Trade-In Credit</span>
                <span>-${draft.tradeAllowance.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="font-bold text-foreground">Net Before Tax</span>
              <span className="text-lg font-bold text-qep-orange">${netTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Estimated Tax</span>
              <span className="font-medium">${taxTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="font-bold text-foreground">Customer Total</span>
              <span className="text-lg font-bold text-qep-orange">${customerTotal.toLocaleString()}</span>
            </div>
            {cashDown > 0 && (
              <div className="flex justify-between text-sm text-emerald-400">
                <span>Cash Down</span>
                <span>-${cashDown.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="font-bold text-foreground">Amount Financed</span>
              <span className="text-lg font-bold text-qep-orange">${amountFinanced.toLocaleString()}</span>
            </div>
            {draft.branchSlug && <BranchDocumentFooter branchSlug={draft.branchSlug} />}
          </Card>

          {selectedFinanceScenario && selectedFinanceScenario.type !== "cash" && (
            <Card className="p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Selected Financing Option</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This optional payment structure will be included on the quote sheet.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Option</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">{selectedFinanceScenario.label}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Monthly payment</p>
                  <p className="mt-2 text-sm font-semibold text-qep-orange">
                    ${(selectedFinanceScenario.monthlyPayment ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">APR / term</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {((selectedFinanceScenario.rate ?? selectedFinanceScenario.apr ?? 0)).toFixed(2)}% · {selectedFinanceScenario.termMonths ?? 0} mo
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-card/50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Total paid</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    ${(selectedFinanceScenario.totalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {draft.branchSlug && subtotal > 0 && (
            <TaxBreakdown
              data={taxPreviewQuery.data}
              isLoading={taxPreviewQuery.isLoading}
              isError={taxPreviewQuery.isError}
              enabled={true}
            />
          )}

          <Card className="border-qep-orange/20 bg-qep-orange/5 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-qep-orange">Commercial Readiness</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Approval</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {approvalPending
                    ? "Submitted to sales manager"
                    : approvalGranted && approvalState.requiresManagerApproval
                      ? "Manager approved"
                      : approvalState.requiresManagerApproval
                        ? "Manager approval required"
                        : "Ready to proceed"}
                </p>
                {(approvalState.reason || approvalPending || approvalGranted) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {approvalPending
                      ? "The quote is waiting in Approval Center for manager review."
                      : approvalGranted && approvalState.requiresManagerApproval
                        ? "Approval is complete. You can now send the quote."
                        : approvalState.reason}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Draft Readiness</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {packetReadiness.draft.ready ? "Ready to save" : "Needs completion"}
                </p>
                {!packetReadiness.draft.ready && packetReadiness.draft.missing.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Missing: {packetReadiness.draft.missing.join(", ")}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Send Readiness</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {packetReadiness.send.ready ? "Ready to send" : "Needs completion"}
                </p>
                {!packetReadiness.send.ready && packetReadiness.send.missing.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Missing: {packetReadiness.send.missing.join(", ")}
                  </p>
                )}
              </div>
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("financing")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <div className="flex gap-2">
              {canSubmitForApproval && (
                <Button
                  variant="outline"
                  onClick={() => { void submitApprovalMutation.mutateAsync(); }}
                  disabled={submitApprovalMutation.isPending || !packetReadiness.draft.ready}
                >
                  {submitApprovalMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                  {submitApprovalMutation.isPending ? "Submitting..." : "Submit for Approval"}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => downloadPDF({
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
                  branch: (() => {
                    const branch = selectedBranch as unknown as Record<string, unknown> | undefined;
                    return {
                      name: (branch?.display_name as string) ?? "Quality Equipment & Parts",
                      address: (branch?.address_line1 as string) ?? undefined,
                      city: (branch?.city as string) ?? undefined,
                      state: (branch?.state_province as string) ?? undefined,
                      postalCode: (branch?.postal_code as string) ?? undefined,
                      phone: (branch?.phone_main as string) ?? undefined,
                      email: (branch?.email_main as string) ?? undefined,
                      website: (branch?.website_url as string) ?? undefined,
                      footerText: (branch?.doc_footer_text as string) ?? undefined,
                    };
                  })(),
                })}
                disabled={pdfGenerating || !isQuoteApprovedForDistribution(draft.quoteStatus)}
                title={isQuoteApprovedForDistribution(draft.quoteStatus) ? undefined : "PDF unlocks after owner approval"}
              >
                {pdfGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
                {pdfGenerating ? "Generating..." : "Download PDF"}
              </Button>
              <Button
                onClick={() => { void handleSaveClick(); }}
                disabled={saveMutation.isPending || submitApprovalMutation.isPending || !packetReadiness.draft.ready}
              >
                <Save className="mr-1 h-4 w-4" />
                {saveMutation.isPending ? "Saving..." : "Save Quote"}
              </Button>
            </div>
          </div>

          {/* Slice 15: margin-floor gate — renders banner when under floor,
              and hosts the reason modal opened by handleSaveClick. */}
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

          {showQuoteActions && activeQuotePackageId && (
            <Suspense
              fallback={(
                <Card className="border-border/60 bg-card/60 p-4">
                  <p className="text-sm text-muted-foreground">Loading review workflow…</p>
                </Card>
              )}
            >
              <QuoteReviewWorkflowPanels
                quotePackageId={activeQuotePackageId}
                draft={draft}
                financeScenarios={allFinanceScenarios}
                computed={{
                  subtotal,
                  discountTotal,
                  netTotal,
                  taxTotal,
                  customerTotal,
                  cashDown,
                  amountFinanced,
                }}
                sendReadiness={packetReadiness.send}
                requiresManagerApproval={approvalState.requiresManagerApproval}
                userRole={userRoleQuery.data ?? null}
                submitApprovalResult={submitApprovalMutation.data}
                quoteStatus={quoteStatus}
                onQuoteStatusChange={(nextStatus) => {
                  setDraft((current) => current.quoteStatus === nextStatus
                    ? current
                    : { ...current, quoteStatus: nextStatus });
                }}
              />
            </Suspense>
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
