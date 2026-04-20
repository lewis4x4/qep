import { useEffect, useRef, useState } from "react";
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
import { IntelligencePanel } from "../components/IntelligencePanel";
import { EquipmentSelector } from "../components/EquipmentSelector";
import { FinancingCalculator } from "../components/FinancingCalculator";
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

type Step = "entry" | "equipment" | "financing" | "review";

interface CatalogEntryMatch {
  id?: string;
  make: string;
  model: string;
  year: number | null;
  list_price?: number;
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

  useEffect(() => {
    setFinanceScenarios([]);
  }, [draft.equipment, draft.attachments, draft.tradeAllowance]);

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
    mutationFn: (): Promise<QuotePackageSaveResponse> =>
      saveQuotePackage(
        buildQuoteSavePayload(draft, {
          equipmentTotal,
          attachmentTotal,
          subtotal,
          netTotal,
          marginAmount,
          marginPct,
        }),
      ),
  });

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
      setDraft((current) => ({
        ...current,
        recommendation,
        voiceSummary: voiceResult.transcript,
        equipment: catalogMatches.length > 0
          ? [buildEquipmentLine(catalogMatches[0] as CatalogEntryMatch)]
          : current.equipment,
      }));
      setStep("equipment");
    },
  });

  const aiIntakeMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const recommendation = await getAiEquipmentRecommendation(prompt);
      const catalogMatches = await searchCatalog(recommendation.machine || prompt);
      return { recommendation, catalogMatches, prompt };
    },
    onSuccess: ({ recommendation, catalogMatches, prompt }) => {
      setDraft((current) => ({
        ...current,
        recommendation,
        voiceSummary: prompt,
        equipment: catalogMatches.length > 0
          ? [buildEquipmentLine(catalogMatches[0] as CatalogEntryMatch)]
          : current.equipment,
      }));
      setStep("equipment");
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

    setStep("equipment");
  };

  const equipmentKey = draft.equipment.map((e) => `${e.make}-${e.model}-${e.unitPrice}`).join("|");
  const firstEquipment = draft.equipment[0];

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
        {(["entry", "equipment", "financing", "review"] as Step[]).map((currentStep, index) => (
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

          <CustomerInfoCard
            customerName={draft.customerName ?? ""}
            customerCompany={draft.customerCompany ?? ""}
            customerPhone={draft.customerPhone ?? ""}
            customerEmail={draft.customerEmail ?? ""}
            onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
          />

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
                  if (mode === "manual") {
                    setStep("equipment");
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

      {step === "equipment" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Commercial workspace</h2>

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

          {/* Mobile-only intelligence panel (desktop shows in right column) */}
          <div className="lg:hidden">{intelligencePanel}</div>

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
            <Button variant="outline" onClick={() => setStep("entry")}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
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
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !packetReadiness.canSave}
              >
                <Save className="mr-1 h-4 w-4" />
                {saveMutation.isPending ? "Saving..." : "Save Quote"}
              </Button>
            </div>
          </div>

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
      {/* Right column — intelligence panel (desktop only) */}
      <aside className="hidden w-80 shrink-0 lg:block">
        <div className="sticky top-4">{intelligencePanel}</div>
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
