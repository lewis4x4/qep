import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AskIronAdvisorButton } from "@/components/primitives";
import { cn } from "@/lib/utils";

import { MobileBottomSheet } from "@/features/sales/components/MobileBottomSheet";

import { DealAssistantTrigger } from "./ConversationalDealEngine";
import { DealCoachSidebar } from "./DealCoachSidebar";
import { MarginFloorGate } from "./MarginFloorGate";
import { QuoteBuilderOverlays } from "./QuoteBuilderOverlays";
import { QuoteBuilderStatusBanners } from "./QuoteBuilderStatusBanners";
import type { QuoteBuilderV2PageShellProps } from "./QuoteBuilderV2PageShell";
import { useWizard } from "../wizard/useWizard";
import { WIZARD_STEPS, type AutoSaveState, type Step } from "../wizard/wizard-types";

type SectionId = "who_what" | "price" | "refine" | "send";

interface SectionDef {
  id: SectionId;
  label: string;
  steps: Step[];
}

type MobileSectionTone = {
  frameClassName: string;
  eyebrowClassName: string;
};

const SECTIONS: readonly SectionDef[] = [
  { id: "who_what", label: "Who & What", steps: ["customer", "equipment", "configure", "tradeIn"] },
  { id: "price", label: "Price", steps: ["pricing", "promotions", "financing"] },
  { id: "refine", label: "Refine", steps: ["details", "review"] },
  { id: "send", label: "Send", steps: ["document", "send"] },
];

const MOBILE_SECTION_TONES: Record<SectionId, MobileSectionTone> = {
  who_what: {
    frameClassName: "border-white/[0.08] bg-foreground/[0.03]",
    eyebrowClassName: "text-qep-orange",
  },
  price: {
    frameClassName: "border-qep-orange/25 bg-qep-orange/[0.06]",
    eyebrowClassName: "text-qep-orange",
  },
  refine: {
    frameClassName: "border-white/[0.08] bg-foreground/[0.03]",
    eyebrowClassName: "text-qep-orange",
  },
  send: {
    frameClassName: "border-qep-orange/25 bg-qep-orange/[0.06]",
    eyebrowClassName: "text-qep-orange",
  },
};

function sectionForStep(step: Step): SectionDef {
  return SECTIONS.find((section) => section.steps.includes(step)) ?? SECTIONS[0];
}

export function mobileSectionToneForStep(step: Step): MobileSectionTone {
  return MOBILE_SECTION_TONES[sectionForStep(step).id];
}

function autosaveDisplay(state: AutoSaveState, savedLabel: string | null): {
  label: string;
  tone: "saved" | "saving" | "error" | "idle" | "local";
} {
  if (state === "saving") return { label: "Saving…", tone: "saving" };
  if (state === "error") return { label: "Error", tone: "error" };
  if (state === "local") return { label: "Local", tone: "local" };
  if (state === "saved") return { label: savedLabel ? `Saved ${savedLabel}` : "Saved", tone: "saved" };
  return { label: "Idle", tone: "idle" };
}

function autosaveDotClass(tone: "saved" | "saving" | "error" | "idle" | "local"): string {
  switch (tone) {
    case "saved":
      return "bg-emerald-400";
    case "local":
      return "bg-emerald-300";
    case "saving":
      return "bg-amber-400";
    case "error":
      return "bg-red-500";
    default:
      return "bg-slate-500";
  }
}

function autosaveTextClass(tone: "saved" | "saving" | "error" | "idle" | "local"): string {
  switch (tone) {
    case "saved":
    case "local":
      return "text-emerald-300";
    case "saving":
      return "text-amber-300";
    case "error":
      return "text-red-300";
    default:
      return "text-slate-400";
  }
}

interface SheetSectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function SheetSection({ title, open, onToggle, children }: SheetSectionProps) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-foreground/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-foreground">
          {title}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t border-white/[0.04] px-4 py-3">{children}</div>}
    </section>
  );
}

export function QuoteBuilderV2PageMobileShell({
  autoSaveState,
  displayedSavedLabel,
  primaryActionLabel,
  primaryActionDisabled,
  primaryActionPending,
  primaryActionShowsSendIcon,
  onPrimaryAction,
  draft,
  step,
  dealAssistantOpen,
  onDealAssistantOpenChange,
  activeQuotePackageId,
  activeQuoteNumber,
  existingQuoteLoadError,
  existingQuoteEditingMessage,
  currentWizardStepNumber,
  marginPct,
  marginAmount,
  marginFloorPct,
  marginFloorSource,
  hasCustomer,
  onQuoteForProspect,
  wizardStepRouter,
  equipmentTotal,
  attachmentTotal,
  subtotal,
  netTotal,
  marginGateOpen,
  onMarginGateOpenChange,
  onMarginReasonConfirm,
  pdfError,
  saveSuccess,
  saveErrorMessage,
  submitApprovalErrorMessage,
  onRecoveryAction,
  intelligencePanel,
  tradeMarketContext,
  tradeMarketContextLoading,
  tradeWalkaroundHref,
  overlays,
  quoteStatus,
}: QuoteBuilderV2PageShellProps) {
  const navigate = useNavigate();
  const wizard = useWizard();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [openSection, setOpenSection] = useState<"iron" | "coach" | "talk" | null>(null);

  const activeSection = sectionForStep(step);
  const activeSectionTone = mobileSectionToneForStep(step);
  const totalSteps = WIZARD_STEPS.length;
  const autosave = autosaveDisplay(autoSaveState, displayedSavedLabel);

  const previousStep: Step | null = wizard.previousWizardStep;

  function toggleSection(id: "iron" | "coach" | "talk") {
    setOpenSection((current) => (current === id ? null : id));
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--background))]">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2 mb-2">
          <button
            type="button"
            onClick={() => navigate("/sales/quotes")}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to quotes"
          >
            <ChevronLeft className="h-4 w-4" />
            Quotes
          </button>
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("h-2 w-2 rounded-full", autosaveDotClass(autosave.tone))}
            />
            <span className={cn("text-[10px]", autosaveTextClass(autosave.tone))}>
              {autosave.label}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {SECTIONS.map((section) => {
            const sectionLastStep = section.steps[section.steps.length - 1];
            const lastIndex = WIZARD_STEPS.findIndex((s) => s.id === sectionLastStep);
            const currentIndex = currentWizardStepNumber - 1;
            const isActive = section.id === activeSection.id;
            const isComplete = !isActive && currentIndex > lastIndex;
            return (
              <div
                key={section.id}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  isComplete
                    ? "bg-qep-orange"
                    : isActive
                      ? "bg-qep-orange ring-1 ring-qep-orange/40"
                      : "bg-white/[0.06]",
                )}
              />
            );
          })}
        </div>
        <div className="flex items-baseline justify-between mt-2">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            {activeSection.label}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {currentWizardStepNumber} of {totalSteps}
          </p>
        </div>
      </div>

      {activeQuotePackageId && (
        <div className="border-y border-qep-orange/20 bg-qep-orange/5 px-4 py-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-foreground">
              Editing {activeQuoteNumber ?? "draft"}
            </span>
            <span className="rounded-full border border-qep-orange/30 bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-qep-orange">
              {(quoteStatus ?? "draft").replace(/_/g, " ")}
            </span>
          </div>
        </div>
      )}

      <main
        className="min-h-0 flex-1 overflow-y-auto pb-[calc(var(--sales-shell-bottom-offset)+5rem)]"
        data-testid="quote-mobile-scroll-root"
      >
        <div className="px-4 pt-3">
          <section
            className={cn(
              "rounded-2xl border p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]",
              activeSectionTone.frameClassName,
            )}
            data-testid="quote-mobile-active-section-frame"
            data-section-id={activeSection.id}
          >
            <p
              className={cn(
                "mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em]",
                activeSectionTone.eyebrowClassName,
              )}
            >
              {activeSection.label} section
            </p>
            {wizardStepRouter}
          </section>
        </div>

        <div className="px-4 pt-4">
          <QuoteBuilderStatusBanners
            existingQuoteLoadError={existingQuoteLoadError}
            existingQuoteEditingMessage={existingQuoteEditingMessage}
          />
        </div>

        <MarginFloorGate
          brandId={null}
          marginPct={marginPct}
          netTotalCents={Math.round(netTotal * 100)}
          marginFloorPct={marginFloorPct}
          marginFloorSource={marginFloorSource}
          reasonModalOpen={marginGateOpen}
          onReasonModalOpenChange={onMarginGateOpenChange}
          onReasonConfirm={(payload) => {
            onMarginReasonConfirm(payload);
          }}
        />

        <div className="px-4 pt-4">
          <QuoteBuilderStatusBanners
            pdfError={pdfError}
            saveSuccess={saveSuccess}
            saveErrorMessage={saveErrorMessage}
            submitApprovalErrorMessage={submitApprovalErrorMessage}
            onRecoveryAction={onRecoveryAction}
          />
        </div>
      </main>

      <div
        className="fixed inset-x-0 bottom-16 z-40 border-t border-white/[0.06] bg-[hsl(var(--background))]/95 backdrop-blur-lg"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center gap-2 p-3">
          {!hasCustomer && step === "customer" ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 border-qep-orange/40 text-qep-orange hover:bg-qep-orange/10 hover:text-qep-orange"
              onClick={onQuoteForProspect}
            >
              Quote for prospect
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1"
              disabled={!previousStep}
              onClick={() => {
                if (previousStep) wizard.setStep(previousStep);
              }}
            >
              Back
            </Button>
          )}
          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            aria-label="Open assistant"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-qep-orange/40 bg-qep-orange/10 text-qep-orange hover:bg-qep-orange/20 transition-colors"
          >
            <Sparkles className="h-5 w-5" />
          </button>
          <Button
            type="button"
            className="h-11 flex-[2]"
            disabled={primaryActionDisabled}
            onClick={onPrimaryAction}
          >
            {primaryActionPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : primaryActionShowsSendIcon ? (
              <Send className="mr-1 h-4 w-4" />
            ) : null}
            {primaryActionLabel}
          </Button>
        </div>
      </div>

      <MobileBottomSheet
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        size="tall"
        title="Assistant"
        description="Iron's read on this step"
      >
        <div className="flex flex-col gap-3">
          <SheetSection
            title="Iron's take on this step"
            open={openSection === "iron"}
            onToggle={() => toggleSection("iron")}
          >
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Urgency signal
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {draft.voiceSummary
                    ? "Fresh field signal captured and ready to steer the quote workspace."
                    : draft.entryMode === "voice"
                      ? "Waiting on the field note that should shape the quote."
                      : "No voice signal attached yet."}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Next move
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {draft.voiceSummary
                    ? "Confirm the recommendation, tighten the equipment mix, and move toward pricing."
                    : "Capture the customer need clearly so QRM can seed the workspace correctly."}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Pipeline carry-through
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {draft.dealId
                    ? "This quote is already anchored to a QRM deal."
                    : "Deal linkage should happen before this opportunity goes cold."}
                </p>
              </div>
              {intelligencePanel && (
                <div className="pt-2">{intelligencePanel}</div>
              )}
            </div>
          </SheetSection>

          <SheetSection
            title="Deal Coach"
            open={openSection === "coach"}
            onToggle={() => toggleSection("coach")}
          >
            {draft.equipment.length > 0 ? (
              <DealCoachSidebar
                draft={draft}
                computed={{
                  equipmentTotal,
                  attachmentTotal,
                  subtotal,
                  netTotal,
                  marginAmount,
                  marginPct,
                }}
                quotePackageId={activeQuotePackageId}
                tradeMarketContext={tradeMarketContext}
                tradeMarketContextLoading={tradeMarketContextLoading}
                tradeWalkaroundHref={tradeWalkaroundHref}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Add equipment to unlock the Deal Coach.
              </p>
            )}
          </SheetSection>

          <SheetSection
            title="Talk to Iron"
            open={openSection === "talk"}
            onToggle={() => toggleSection("talk")}
          >
            <div className="flex flex-col gap-2">
              <DealAssistantTrigger
                onClick={() => onDealAssistantOpenChange(true)}
                active={dealAssistantOpen}
              />
              <AskIronAdvisorButton
                contextType="quote"
                contextId={draft.dealId || undefined}
                variant="inline"
              />
            </div>
          </SheetSection>
        </div>
      </MobileBottomSheet>

      <QuoteBuilderOverlays {...overlays} />
    </div>
  );
}
