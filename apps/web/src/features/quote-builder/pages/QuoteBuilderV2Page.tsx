import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  PenTool,
} from "lucide-react";
import { CustomerInfoCard } from "../components/CustomerInfoCard";
import { CustomerPicker, type PickedCustomer } from "../components/CustomerPicker";
import { SelectedCustomerChip } from "../components/SelectedCustomerChip";
import { CustomerIntelPanel } from "../components/CustomerIntelPanel";
import { PointShootTradeCard } from "../components/PointShootTradeCard";
import { WinProbabilityStrip } from "../components/WinProbabilityStrip";
import { getMarginBaseline } from "../lib/coach-api";
import { computeWinProbability } from "../lib/win-probability-scorer";
import { hydrateCustomerById } from "../lib/customer-search-api";
import { IntelligencePanel } from "../components/IntelligencePanel";
import { EquipmentSelector } from "../components/EquipmentSelector";
import { FinancingCalculator } from "../components/FinancingCalculator";
import { DealCoachSidebar } from "../components/DealCoachSidebar";
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
import { IncentiveStack } from "../components/IncentiveStack";
import { SendQuoteSection } from "../components/SendQuoteSection";
import {
  buildPortalRevisionQuoteData,
  buildQuoteSavePayload,
  calculateFinancing,
  getAiEquipmentRecommendation,
  getFactorVerdicts,
  getPortalRevision,
  publishPortalRevision,
  returnPortalRevisionToDraft,
  saveQuotePackage,
  saveQuoteSignature,
  savePortalRevisionDraft,
  searchCatalog,
  submitPortalRevision,
  type QuotePackageSaveResponse,
} from "../lib/quote-api";
import { computeQuoteWorkspace } from "../lib/quote-workspace";
import { useActiveBranches } from "@/hooks/useBranches";
import { BranchDocumentHeader, BranchDocumentFooter } from "@/components/BranchDocumentHeader";
import { useQuotePDF } from "../hooks/useQuotePDF";
import { AskIronAdvisorButton } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { VoiceRecorder } from "@/features/voice-qrm/components/VoiceRecorder";
import { submitVoiceToQrm } from "@/features/voice-qrm/lib/voice-qrm-api";
import {
  ConversationalDealEngine,
  DealAssistantTrigger,
  type ScenarioSelection,
} from "../components/ConversationalDealEngine";
import {
  PortalSignaturePad,
  signatureDataUrlToRawBase64,
  type PortalSignaturePadHandle,
} from "@/features/portal/components/PortalSignaturePad";
import type {
  QuoteEntryMode,
  QuoteFinanceScenario,
  QuoteFinancingPreview,
  QuoteLineItemDraft,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

// Slice 20a: customer is its own step between intake and equipment. Before
// this change the CustomerSection lived on the entry screen alongside the
// intake-mode picker, and AI/Voice mutations auto-advanced straight to
// equipment — so reps submitting via AI chat were jumping past customer
// selection entirely. Splitting the step makes "who is this quote for?"
// explicit and is the anchor for the Customer Digital Twin intel panel.
type Step = "entry" | "customer" | "equipment" | "financing" | "review";

interface CatalogEntryMatch {
  id?: string;
  make: string;
  model: string;
  year: number | null;
  list_price?: number;
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
    title: text,
    make: firstToken ?? text,
    model: rest.join(" "),
    year: null,
    quantity: 1,
    unitPrice: 0,
  };
}

export function QuoteBuilderV2Page() {
  const [searchParams] = useSearchParams();
  const dealId = searchParams.get("deal_id") || searchParams.get("crm_deal_id") || "";
  const contactId = searchParams.get("contact_id") || searchParams.get("crm_contact_id") || "";
  const [step, setStep] = useState<Step>("entry");
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
    customerName: "",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
  });
  const [financeScenarios, setFinanceScenarios] = useState<QuoteFinanceScenario[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [dealAssistantOpen, setDealAssistantOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [dealerMessage, setDealerMessage] = useState("");
  const [revisionSummary, setRevisionSummary] = useState("");
  const sigRef = useRef<PortalSignaturePadHandle>(null);
  const queryClient = useQueryClient();

  const branchesQ = useActiveBranches();
  const branches = branchesQ.data ?? [];
  const selectedBranch = branches.find((branch) => branch.slug === draft.branchSlug);
  const {
    equipmentTotal,
    attachmentTotal,
    subtotal,
    netTotal,
    dealerCost,
    marginAmount,
    marginPct,
    approvalState,
    packetReadiness,
  } = computeQuoteWorkspace(draft);

  const { generateAndDownload: downloadPDF, generating: pdfGenerating, error: pdfError } = useQuotePDF();
  const { profile } = useAuth();

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
  const winProbContext = useMemo(
    () => ({ marginPct, marginBaselineMedianPct }),
    [marginPct, marginBaselineMedianPct],
  );

  useEffect(() => {
    setFinanceScenarios([]);
  }, [draft.equipment, draft.attachments, draft.tradeAllowance]);

  // Slice 20a: when QRM deep-links into Quote Builder with ?contact_id= or
  // ?deal_id=, hydrate the customer from CRM so the Customer step renders
  // a real name/company + intel panel on arrival instead of an empty form.
  // Intentionally one-shot: only fires if no customer is already set (avoids
  // clobbering what the AI/Voice intake or rep typed).
  useEffect(() => {
    const hasCustomer = Boolean(
      draft.customerName?.trim() || draft.customerCompany?.trim(),
    );
    if (hasCustomer) return;
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
    // Intentionally one-shot on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          { equipmentTotal, attachmentTotal, subtotal, netTotal, marginAmount, marginPct },
          snapshot,
        ),
      );
    },
  });

  // Slice 15: margin-floor gate state. The gate blocks the save action
  // when the current margin is below the applicable threshold until the
  // rep provides a one-sentence reason. Threshold is looked up against
  // null brandId for MVP — the workspace default floor. Per-brand
  // lookups hang on the draft's primary equipment brand_id which we
  // don't thread yet; enable later when Slice 09's full migration ships.
  const [marginGateOpen, setMarginGateOpen] = useState(false);

  async function handleSaveClick() {
    // Resolve threshold just-in-time so a new workspace-default created
    // in a sibling tab applies to this session without a refresh.
    const { threshold } = await getApplicableThreshold(null);
    const thresholdPct = threshold ? Number(threshold.min_margin_pct) : null;
    if (isUnderThreshold(marginPct, thresholdPct)) {
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
    } catch {
      // saveMutation.error path handles user-visible feedback.
    }
  }

  const savedQuotePackageId = saveMutation.data?.quote?.id ?? saveMutation.data?.id ?? null;

  const portalRevisionQuery = useQuery({
    queryKey: ["quote-builder", "portal-revision", draft.dealId],
    queryFn: () => getPortalRevision(draft.dealId!),
    enabled: Boolean(savedQuotePackageId && draft.dealId),
    staleTime: 5_000,
  });

  useEffect(() => {
    const revisionDraft = portalRevisionQuery.data?.draft;
    if (revisionDraft) {
      setDealerMessage(revisionDraft.dealerMessage ?? "");
      setRevisionSummary(revisionDraft.revisionSummary ?? "");
      return;
    }
    const currentVersion = portalRevisionQuery.data?.review?.current_version;
    setDealerMessage(currentVersion?.dealer_message ?? "");
    setRevisionSummary(currentVersion?.revision_summary ?? "");
  }, [portalRevisionQuery.data]);

  const voiceMutation = useMutation({
    mutationFn: async (payload: { blob: Blob; fileName: string }) => {
      const voiceResult = await submitVoiceToQrm({
        audioBlob: payload.blob,
        fileName: payload.fileName,
        dealId: dealId || undefined,
      });
      if (!("transcript" in voiceResult) || !voiceResult.transcript) {
        throw new Error("Voice note did not return a usable transcript.");
      }
      const recommendation = await getAiEquipmentRecommendation(voiceResult.transcript);
      const catalogMatches = await searchCatalog(recommendation.machine || voiceResult.transcript);
      return { voiceResult, recommendation, catalogMatches };
    },
    onSuccess: ({ voiceResult, recommendation, catalogMatches }) => {
      setDraft((current) => {
        const fallback = buildEquipmentLineFromRecommendation(recommendation.machine);
        const seededEquipment = catalogMatches.length > 0
          ? [buildEquipmentLine(catalogMatches[0] as CatalogEntryMatch)]
          : fallback
            ? [fallback]
            : current.equipment;
        return {
          ...current,
          recommendation,
          voiceSummary: voiceResult.transcript,
          equipment: seededEquipment,
        };
      });
      // Slice 20a: land on the Customer step instead of Equipment. The AI
      // has picked a machine, but we still don't know who the quote is
      // for — rep confirms/picks customer next.
      setStep("customer");
    },
  });

  const aiIntakeMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const recommendation = await getAiEquipmentRecommendation(prompt);
      const catalogMatches = await searchCatalog(recommendation.machine || prompt);
      return { recommendation, catalogMatches, prompt };
    },
    onSuccess: ({ recommendation, catalogMatches, prompt }) => {
      setDraft((current) => {
        const fallback = buildEquipmentLineFromRecommendation(recommendation.machine);
        const seededEquipment = catalogMatches.length > 0
          ? [buildEquipmentLine(catalogMatches[0] as CatalogEntryMatch)]
          : fallback
            ? [fallback]
            : current.equipment;
        return {
          ...current,
          recommendation,
          voiceSummary: prompt,
          equipment: seededEquipment,
        };
      });
      setStep("customer");
    },
  });

  const financingMutation = useMutation({
    mutationFn: () => calculateFinancing(netTotal, marginPct, draft.equipment[0]?.make),
    onSuccess: (preview: QuoteFinancingPreview) => setFinanceScenarios(preview.scenarios ?? []),
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      const quotePackageId = saveMutation.data?.quote?.id ?? saveMutation.data?.id;
      if (!quotePackageId) throw new Error("Save the quote before capturing signature.");
      const dataUrl = sigRef.current?.toDataUrl();
      const base64 = dataUrl ? signatureDataUrlToRawBase64(dataUrl) : "";
      return saveQuoteSignature({
        quote_package_id: quotePackageId,
        deal_id: draft.dealId,
        signer_name: signerName,
        signer_email: draft.contactId || null,
        signature_png_base64: base64.length > 100 ? base64 : null,
      });
    },
  });

  const revisionDraftMutation = useMutation({
    mutationFn: async () => {
      if (!draft.dealId || !savedQuotePackageId) throw new Error("Save the quote before drafting a portal revision.");
      return savePortalRevisionDraft({
        deal_id: draft.dealId,
        quote_package_id: savedQuotePackageId,
        quote_data: buildPortalRevisionQuoteData(
          draft,
          { subtotal, netTotal },
          financeScenarios,
          dealerMessage,
          revisionSummary,
        ),
        dealer_message: dealerMessage || null,
        revision_summary: revisionSummary || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["quote-builder", "portal-revision", draft.dealId] });
    },
  });

  const revisionSubmitMutation = useMutation({
    mutationFn: async () => {
      if (!draft.dealId) throw new Error("Save the quote before submitting a portal revision.");
      return submitPortalRevision({ deal_id: draft.dealId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["quote-builder", "portal-revision", draft.dealId] });
    },
  });

  const revisionReturnMutation = useMutation({
    mutationFn: async () => {
      if (!draft.dealId) throw new Error("No portal revision draft found.");
      return returnPortalRevisionToDraft({ deal_id: draft.dealId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["quote-builder", "portal-revision", draft.dealId] });
    },
  });

  const revisionPublishMutation = useMutation({
    mutationFn: async () => {
      if (!draft.dealId) throw new Error("No portal revision draft found.");
      return publishPortalRevision({ deal_id: draft.dealId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["quote-builder", "portal-revision", draft.dealId] });
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

  const equipmentKey = draft.equipment.map((e) => `${e.make}-${e.model}-${e.unitPrice}`).join("|");
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
        const alreadyAdded = draft.equipment.some((e) => e.title === draft.recommendation!.machine);
        if (!alreadyAdded) {
          setDraft((current) => ({
            ...current,
            equipment: [
              ...current.equipment,
              { kind: "equipment", title: current.recommendation!.machine, quantity: 1, unitPrice: 0 },
            ],
          }));
        }
        setStep("equipment");
      }}
      onSelectAlternative={draft.recommendation?.alternative?.machine ? () => {
        const alt = draft.recommendation!.alternative!;
        setDraft((current) => ({
          ...current,
          equipment: [
            ...current.equipment,
            { kind: "equipment", title: alt.machine, quantity: 1, unitPrice: 0 },
          ],
        }));
        setStep("equipment");
      } : undefined}
      onBrowseCatalog={() => setStep("equipment")}
      netTotal={netTotal}
      marginPct={marginPct}
      equipmentMake={firstEquipment?.make}
      equipmentKey={equipmentKey}
      hasDeal={Boolean(dealId)}
      tradeAllowance={draft.tradeAllowance}
      onTradeChange={(value) => setDraft((current) => ({ ...current, tradeAllowance: value }))}
      userRole={userRoleQuery.data ?? null}
      equipmentModel={firstEquipment?.model}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
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

      <div className="flex gap-2">
        {(["entry", "customer", "equipment", "financing", "review"] as Step[]).map((currentStep, index) => (
          <button
            key={currentStep}
            onClick={() => setStep(currentStep)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              step === currentStep
                ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                : "border-border text-muted-foreground hover:border-foreground/20"
            }`}
          >
            {index + 1}. {currentStep.charAt(0).toUpperCase() + currentStep.slice(1)}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              { mode: "voice" as QuoteEntryMode, icon: Mic, label: "Voice", desc: "Record a deal description — AI populates the quote workspace" },
              { mode: "ai_chat" as QuoteEntryMode, icon: MessageSquare, label: "AI Chat", desc: "Type the opportunity — AI recommends the setup" },
              { mode: "manual" as QuoteEntryMode, icon: FileText, label: "Manual", desc: "Build the quote directly from the commercial workspace" },
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
          <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} />

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

          {/* Slice 20b: Point, Shoot, Trade — inline trade-in capture once
              a customer is selected. Rep snaps a photo on their phone; we
              identify the machine, fetch a multi-source book-value range,
              and drop a trade credit into the draft without leaving the
              wizard. Gated on hasCustomer so the flow is: pick customer →
              see intel → capture their trade → pick their new machine. */}
          {hasCustomer && (
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
          )}

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

          <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} />

          <EquipmentSelector
            onSelect={(entry) => {
              setDraft((current) => ({
                ...current,
                equipment: [
                  ...current.equipment,
                  {
                    kind: "equipment",
                    id: entry.id,
                    title: `${entry.make} ${entry.model}`,
                    make: entry.make,
                    model: entry.model,
                    year: entry.year,
                    quantity: 1,
                    unitPrice: entry.list_price || 0,
                  },
                ],
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
                quotePackageId={savedQuotePackageId}
              />
            )}
          </div>

          {draft.equipment.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Selected Equipment</p>
              {draft.equipment.map((equipment, index) => (
                <div key={`${equipment.title}-${index}`} className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm font-medium">
                    {equipment.make} {equipment.model} {equipment.year ? `(${equipment.year})` : ""}
                  </span>
                  <span className="font-semibold text-foreground">${equipment.unitPrice.toLocaleString()}</span>
                </div>
              ))}
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
              onClick={() => {
                financingMutation.mutate();
                setStep("financing");
              }}
              disabled={draft.equipment.length === 0}
            >
              Financing <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === "financing" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Financing & Trade-In</h2>

          {dealId && (
            <TradeInSection
              dealId={dealId}
              onTradeValueChange={(value, valId) => {
                setDraft((current) => ({
                  ...current,
                  tradeAllowance: value || 0,
                  tradeValuationId: valId,
                }));
              }}
            />
          )}

          <FinancingCalculator totalAmount={netTotal} marginPct={marginPct} />

          {financingMutation.isError && (
            <Card className="border-red-500/30 bg-red-500/5 p-4">
              <p className="text-sm text-red-400">
                {financingMutation.error instanceof Error
                  ? financingMutation.error.message
                  : "Financing preview failed. Try again."}
              </p>
            </Card>
          )}

          {financeScenarios.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Financing Preview</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {financeScenarios.map((scenario) => (
                  <div key={scenario.label} className="rounded-lg border border-border/70 bg-card/50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-qep-orange">{scenario.label}</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">
                      {scenario.monthlyPayment == null ? "—" : `$${Math.round(scenario.monthlyPayment).toLocaleString()}/mo`}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {scenario.termMonths ? `${scenario.termMonths} months` : scenario.type}
                      {scenario.apr != null ? ` · ${scenario.apr.toFixed(2)}% APR` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("equipment")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep("review")}>Review <ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Review Quote</h2>

          <WinProbabilityStrip draft={draft} context={winProbContext} verdicts={factorVerdicts} />

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
            {draft.tradeAllowance > 0 && (
              <div className="flex justify-between text-sm text-emerald-400">
                <span>Trade-In Credit</span>
                <span>-${draft.tradeAllowance.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-border pt-2">
              <span className="font-bold text-foreground">Net Total</span>
              <span className="text-lg font-bold text-qep-orange">${netTotal.toLocaleString()}</span>
            </div>
            {draft.branchSlug && <BranchDocumentFooter branchSlug={draft.branchSlug} />}
          </Card>

          {dealId && netTotal > 0 && (
            <TaxBreakdown
              dealId={dealId}
              branchSlug={draft.branchSlug || undefined}
              equipmentCost={netTotal}
              enabled={true}
            />
          )}

          <Card className="border-qep-orange/20 bg-qep-orange/5 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-qep-orange">Commercial Readiness</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Approval</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {approvalState.requiresManagerApproval ? "Manager approval required" : "Ready to proceed"}
                </p>
                {approvalState.reason && (
                  <p className="mt-1 text-xs text-muted-foreground">{approvalState.reason}</p>
                )}
              </div>
              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Packet Readiness</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {packetReadiness.canSend ? "Ready to send" : "Needs completion"}
                </p>
                {!packetReadiness.canSend && packetReadiness.missing.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Missing: {packetReadiness.missing.join(", ")}
                  </p>
                )}
              </div>
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("financing")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => downloadPDF({
                  dealName: draft.dealId || "Quote",
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
                  tradeAllowance: draft.tradeAllowance,
                  netTotal,
                  financing: financeScenarios.map((scenario) => ({
                    type: scenario.type,
                    termMonths: scenario.termMonths ?? 0,
                    rate: scenario.rate ?? scenario.apr ?? 0,
                    monthlyPayment: scenario.monthlyPayment ?? 0,
                    totalCost: scenario.totalCost ?? 0,
                    lender: scenario.lender ?? "Preferred lender",
                  })),
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
                    };
                  })(),
                })}
                disabled={pdfGenerating}
              >
                {pdfGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
                {pdfGenerating ? "Generating..." : "Download PDF"}
              </Button>
              <Button
                onClick={() => { void handleSaveClick(); }}
                disabled={saveMutation.isPending || !packetReadiness.canSave}
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
            <>
              <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
                <p className="text-sm text-emerald-400">Quote saved successfully.</p>
              </Card>
              {(() => {
                const savedId = saveMutation.data?.quote?.id ?? saveMutation.data?.id;
                const canPublish = ["manager", "owner"].includes(userRoleQuery.data ?? "");
                const portalRevision = portalRevisionQuery.data;
                const compareSnapshot = portalRevision?.draft?.compareSnapshot;
                const publicationStatus = portalRevision?.publishState?.publicationStatus ?? "none";
                return savedId ? (
                  <>
                    <IncentiveStack quotePackageId={savedId} />
                    <SendQuoteSection quotePackageId={savedId} />
                    {portalRevision?.review && (
                      <Card className="border-border/60 bg-card/60 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">Portal Revision</p>
                            <p className="text-xs text-muted-foreground">
                              Publish a revised customer proposal from this quote workflow with manager approval.
                            </p>
                          </div>
                          <span className="rounded-full bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-qep-orange">
                            {publicationStatus.replace(/_/g, " ")}
                          </span>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Current portal proposal</p>
                            <p className="mt-2 text-sm font-semibold text-foreground">
                              {portalRevision.review.current_version?.version_number
                                ? `Version ${portalRevision.review.current_version.version_number}`
                                : "Legacy live proposal"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Last dealer summary: {portalRevision.review.current_version?.revision_summary ?? "None recorded"}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Latest customer request</p>
                            <p className="mt-2 text-sm text-foreground">
                              {portalRevision.publishState?.latestCustomerRequestSnapshot ?? "No requested changes are recorded on the active portal proposal."}
                            </p>
                          </div>
                        </div>

                        <label className="block space-y-1 text-sm">
                          <span className="text-muted-foreground">Dealer response message</span>
                          <textarea
                            value={dealerMessage}
                            onChange={(event) => setDealerMessage(event.target.value)}
                            className="min-h-[90px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
                            placeholder="Explain what changed and what the customer should notice in the revised proposal."
                          />
                        </label>

                        <label className="block space-y-1 text-sm">
                          <span className="text-muted-foreground">Revision summary</span>
                          <textarea
                            value={revisionSummary}
                            onChange={(event) => setRevisionSummary(event.target.value)}
                            className="min-h-[90px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
                            placeholder="Summarize the revision in one concise line."
                          />
                        </label>

                        {compareSnapshot?.hasChanges && (
                          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Compare preview</p>
                            <div className="mt-2 space-y-2 text-sm text-foreground">
                              {(compareSnapshot.priceChanges ?? []).map((line: string) => <p key={line}>{line}</p>)}
                              {(compareSnapshot.equipmentChanges ?? []).map((line: string) => <p key={line}>{line}</p>)}
                              {(compareSnapshot.financingChanges ?? []).map((line: string) => <p key={line}>{line}</p>)}
                              {(compareSnapshot.termsChanges ?? []).map((line: string) => <p key={line}>{line}</p>)}
                              {compareSnapshot.dealerMessageChange ? <p>{compareSnapshot.dealerMessageChange}</p> : null}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            onClick={() => revisionDraftMutation.mutate()}
                            disabled={revisionDraftMutation.isPending || !dealerMessage.trim() || !revisionSummary.trim()}
                          >
                            {revisionDraftMutation.isPending ? "Saving..." : "Save draft"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => revisionSubmitMutation.mutate()}
                            disabled={revisionSubmitMutation.isPending || publicationStatus === "awaiting_approval"}
                          >
                            {revisionSubmitMutation.isPending ? "Submitting..." : "Submit for approval"}
                          </Button>
                          {canPublish && publicationStatus === "awaiting_approval" && (
                            <Button
                              variant="outline"
                              onClick={() => revisionReturnMutation.mutate()}
                              disabled={revisionReturnMutation.isPending}
                            >
                              {revisionReturnMutation.isPending ? "Returning..." : "Return to draft"}
                            </Button>
                          )}
                          {canPublish && (
                            <Button
                              onClick={() => revisionPublishMutation.mutate()}
                              disabled={revisionPublishMutation.isPending || publicationStatus === "none"}
                            >
                              {revisionPublishMutation.isPending ? "Publishing..." : "Approve & publish"}
                            </Button>
                          )}
                        </div>

                        {(revisionDraftMutation.error || revisionSubmitMutation.error || revisionReturnMutation.error || revisionPublishMutation.error) && (
                          <p className="text-xs text-red-400">
                            {[
                              revisionDraftMutation.error,
                              revisionSubmitMutation.error,
                              revisionReturnMutation.error,
                              revisionPublishMutation.error,
                            ].find(Boolean) instanceof Error
                              ? ([
                                revisionDraftMutation.error,
                                revisionSubmitMutation.error,
                                revisionReturnMutation.error,
                                revisionPublishMutation.error,
                              ].find(Boolean) as Error).message
                              : "Portal revision action failed"}
                          </p>
                        )}
                      </Card>
                    )}
                    <Card className="border-border/60 bg-card/60 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <PenTool className="h-4 w-4 text-qep-orange" />
                        <p className="text-sm font-medium text-foreground">E-signature</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Capture signer name, IP, timestamp, and signature image for the quote package.
                      </p>
                      <Input
                        value={signerName}
                        onChange={(event) => setSignerName(event.target.value)}
                        placeholder="Signer full name"
                      />
                      <PortalSignaturePad ref={sigRef} />
                      <Button
                        onClick={() => signMutation.mutate()}
                        disabled={signMutation.isPending || !signerName.trim()}
                      >
                        {signMutation.isPending ? "Saving signature..." : "Capture Signature"}
                      </Button>
                      {signMutation.isSuccess && (
                        <p className="text-xs text-emerald-400">Signature captured successfully.</p>
                      )}
                      {signMutation.isError && (
                        <p className="text-xs text-red-400">
                          {signMutation.error instanceof Error ? signMutation.error.message : "Signature save failed"}
                        </p>
                      )}
                    </Card>
                  </>
                ) : null;
              })()}
            </>
          )}

          {saveMutation.isError && (
            <Card className="border-red-500/30 bg-red-500/5 p-4">
              <p className="text-sm text-red-400">Failed to save quote. Try again.</p>
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
              quotePackageId={savedQuotePackageId}
            />
          )}
        </div>
      </aside>

      {/* Deal Assistant panel (Slice 05) */}
      <ConversationalDealEngine
        open={dealAssistantOpen}
        onClose={() => setDealAssistantOpen(false)}
        onScenarioSelect={handleScenarioSelection}
        dealId={dealId || undefined}
      />
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
