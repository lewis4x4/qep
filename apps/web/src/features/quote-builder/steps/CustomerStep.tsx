/**
 * PR 10 — Quote wizard Step 1 (customer + fast intake).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Reads `draft` / `setDraft` / `setStep` from `useWizard()`; parent passes
 * intake + win-probability wiring that still lives on the page.
 */

import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Search, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
// WAVE polish (Slice 2): voice dictation on Opportunity note.
// WAVE parity-close (Slice 1): MobileBottomSheet for the customer
// picker on phone; MobileSectionAccordion for guardrail copy that
// otherwise pushes the primary action below the fold.
import { MobileBottomSheet } from "@/features/sales/components/MobileBottomSheet";
import { MobileSectionAccordion } from "@/features/sales/components/MobileSectionAccordion";
import { MobileVoiceTextarea } from "@/features/sales/components/MobileVoiceTextarea";
import { useIsMobileViewport } from "@/features/sales/hooks/useIsMobileViewport";
import { CustomerIntelPanel } from "../components/CustomerIntelPanel";
import { CustomerInfoCard } from "../components/CustomerInfoCard";
import { CustomerPicker, type PickedCustomer } from "../components/CustomerPicker";
import { CustomerSection } from "../components/CustomerSection";
import { SelectedCustomerChip } from "../components/SelectedCustomerChip";
import { WinProbabilityStrip } from "../components/WinProbabilityStrip";
import { isTypoLikeRewrite } from "../lib/is-typo-like-rewrite";
import { hasQuoteCustomerIdentity } from "../lib/quote-workspace";
import { IntakeInput } from "../wizard/IntakeInput";
import { useWizard } from "../wizard/useWizard";

import type { FactorVerdict } from "../lib/factor-verdict";
import type { ShadowAgreementSummary } from "../lib/retrospective-shadow";
import type { ShadowHistoricalSnapshot } from "../lib/shadow-score";
import type { WinProbabilityContext } from "../lib/win-probability-scorer";

export interface CustomerStepProps {
  aiPrompt: string;
  setAiPrompt: Dispatch<SetStateAction<string>>;
  intakeRecorderOpen: boolean;
  setIntakeRecorderOpen: Dispatch<SetStateAction<boolean>>;
  onVoiceRecorded: (blob: Blob, fileName: string) => void;
  voiceMutationPending: boolean;
  onBuildWithAi: (prompt: string) => void;
  aiIntakeMutationPending: boolean;
  aiIntakeMessage: string | null;
  winProbContext: WinProbabilityContext;
  factorVerdicts: Map<string, FactorVerdict> | null;
  shadowHistory: ShadowHistoricalSnapshot[] | null;
  shadowCalibration: ShadowAgreementSummary | null;
  intelligencePanel: ReactNode;
}

export function CustomerStep({
  aiPrompt,
  setAiPrompt,
  intakeRecorderOpen,
  setIntakeRecorderOpen,
  onVoiceRecorded,
  voiceMutationPending,
  onBuildWithAi,
  aiIntakeMutationPending,
  aiIntakeMessage,
  winProbContext,
  factorVerdicts,
  shadowHistory,
  shadowCalibration,
  intelligencePanel,
}: CustomerStepProps) {
  const { draft, setDraft, setStep } = useWizard();
  const hasCustomer = hasQuoteCustomerIdentity(draft);
  // WAVE parity-close (Slice 1): mobile reps reach the picker through
  // a MobileBottomSheet so the inline dropdown can't fall behind the
  // iOS keyboard or get clipped by the BottomTabBar. Desktop keeps the
  // existing inline CustomerSection.
  const isMobile = useIsMobileViewport();
  const [pickerSheetOpen, setPickerSheetOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const fromCrm = Boolean(draft.contactId || draft.companyId);

  const handlePick = (picked: PickedCustomer) => {
    setDraft((cur) => ({
      ...cur,
      contactId: picked.contactId ?? undefined,
      companyId: picked.companyId ?? undefined,
      customerName: picked.customerName,
      customerCompany: picked.customerCompany,
      customerPhone: picked.customerPhone,
      customerEmail: picked.customerEmail,
      customerSignals: picked.signals ?? null,
      customerWarmth: picked.warmth ?? null,
    }));
    setPickerSheetOpen(false);
    setPickerQuery("");
    setManualMode(false);
  };

  const handleManualChange = (
    field: "customerName" | "customerCompany" | "customerPhone" | "customerEmail",
    value: string,
  ) => {
    setDraft((cur) => {
      const next = { ...cur, [field]: value };
      if (
        field === "customerCompany" &&
        cur.customerSignals &&
        cur.customerCompany &&
        !isTypoLikeRewrite(cur.customerCompany, value)
      ) {
        next.customerSignals = null;
        next.customerWarmth = null;
        next.companyId = undefined;
        next.contactId = undefined;
      }
      return next;
    });
  };

  const handleClear = () => {
    setDraft((cur) => ({
      ...cur,
      contactId: undefined,
      companyId: undefined,
      customerName: "",
      customerCompany: "",
      customerPhone: "",
      customerEmail: "",
      customerSignals: null,
      customerWarmth: null,
    }));
    setManualMode(false);
    setPickerQuery("");
  };

  return (
    <div className="space-y-4" data-testid="wizard-step-customer">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 1: Choose the customer</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Search first, then add a new customer only if there is no match. Keep the rest of the quote out of view until this is clear.
        </p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Customer vs equipment.</span>{" "}
          This step anchors CRM identity and deal signals. The primary machine row starts in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 2 — Equipment"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("equipment")}
          >
            Equipment
          </Button>
          ; catalog package lines and visibility land in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 3 — Configure the package"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("configure")}
          >
            Configure
          </Button>
          .
        </p>
      </Card>

      {isMobile ? (
        /* WAVE parity-close (Slice 1): on phone the picker lives in
           a MobileBottomSheet — the inline dropdown can fall behind
           the iOS keyboard and is hard to recover from once the rep
           types. Selected-chip + manual-entry modes stay inline. */
        <div data-testid="customer-step-mobile-surface">
          {hasCustomer && !manualMode ? (
            <SelectedCustomerChip
              customerName={draft.customerName ?? ""}
              customerCompany={draft.customerCompany ?? ""}
              customerPhone={draft.customerPhone ?? ""}
              customerEmail={draft.customerEmail ?? ""}
              fromCrm={fromCrm}
              onChange={handleClear}
            />
          ) : manualMode ? (
            <div className="space-y-3">
              <CustomerInfoCard
                customerName={draft.customerName ?? ""}
                customerCompany={draft.customerCompany ?? ""}
                customerPhone={draft.customerPhone ?? ""}
                customerEmail={draft.customerEmail ?? ""}
                onChange={handleManualChange}
              />
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px] w-full text-xs"
                onClick={() => {
                  setManualMode(false);
                  setPickerSheetOpen(true);
                }}
                data-testid="customer-step-back-to-search"
              >
                Back to search
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                type="button"
                onClick={() => setPickerSheetOpen(true)}
                className="min-h-[44px] w-full justify-center gap-2"
                data-testid="customer-step-open-picker"
              >
                <Search className="h-4 w-4" aria-hidden />
                Find a customer
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setManualMode(true)}
                className="min-h-[44px] w-full justify-center gap-2"
                data-testid="customer-step-open-manual"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Add new customer
              </Button>
            </div>
          )}

          <MobileBottomSheet
            open={pickerSheetOpen}
            onOpenChange={setPickerSheetOpen}
            title="Find a customer"
            description="Search CRM contacts and companies. New customers fall through to manual entry."
            size="tall"
          >
            <div data-testid="customer-step-picker-sheet">
              <CustomerPicker
                query={pickerQuery}
                onQueryChange={setPickerQuery}
                onPick={handlePick}
                onRequestManualEntry={(startingQuery) => {
                  handleManualChange("customerName", startingQuery);
                  setManualMode(true);
                  setPickerSheetOpen(false);
                }}
              />
            </div>
          </MobileBottomSheet>
        </div>
      ) : (
        <CustomerSection
          draft={draft}
          onPick={handlePick}
          onManualChange={handleManualChange}
          onClear={handleClear}
        />
      )}

      <Card className="p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Fast intake</p>
        <IntakeInput
          aiPrompt={aiPrompt}
          onAiPromptChange={setAiPrompt}
          intakeRecorderOpen={intakeRecorderOpen}
          onIntakeRecorderToggle={() => setIntakeRecorderOpen((open) => !open)}
          onEntryModeChange={(mode) => setDraft((current) => ({ ...current, entryMode: mode }))}
          onVoiceRecorded={onVoiceRecorded}
          voiceMutationPending={voiceMutationPending}
          onBuildWithAi={onBuildWithAi}
          aiIntakeMutationPending={aiIntakeMutationPending}
          aiIntakeMessage={aiIntakeMessage}
          helperText="Use the same intake box for typing and mic capture before AI builds the draft."
          recorderHeading="Record the customer need"
          textareaMinHeight="90px"
          buildButtonVariant="text"
          bodyOrder="recorder_then_build"
        />

        <label className="mt-4 block space-y-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Opportunity note</span>
          <MobileVoiceTextarea
            value={draft.voiceSummary ?? ""}
            onChange={(event) => setDraft((current) => ({ ...current, voiceSummary: event.target.value }))}
            placeholder="What is the customer trying to accomplish?"
            rows={3}
            className="w-full resize-y rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
          />
        </label>
      </Card>

      <WinProbabilityStrip
        draft={draft}
        context={winProbContext}
        verdicts={factorVerdicts}
        closedHistory={shadowHistory}
        shadowCalibration={shadowCalibration}
      />

      {draft.recommendation?.machine ? (
        <div className="lg:hidden">
          {intelligencePanel}
        </div>
      ) : null}

      {/* WAVE parity-close (Slice 1): guardrail copy is informational —
          collapse on phone so the rep isn't scrolling past it to hit
          the primary action. Always visible on desktop. */}
      {isMobile ? (
        <MobileSectionAccordion
          index={1}
          title="New-customer guardrails"
          caption="Search before create · Phone + last name dedupe"
          defaultOpen={false}
        >
          <div className="space-y-2 pt-2 text-xs text-blue-100/90">
            <p>
              If phone + last name match an existing customer, pick that record from search instead of creating a duplicate. Tax certificate upload stays "attach later" until document storage is wired.
            </p>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-blue-400/30 px-2 py-1">Search before create</span>
              <span className="rounded-full border border-blue-400/30 px-2 py-1">Phone + last name dedupe</span>
              <span className="rounded-full border border-blue-400/30 px-2 py-1">Resale certificate: attach later</span>
            </div>
          </div>
        </MobileSectionAccordion>
      ) : (
        <Card className="border-blue-500/20 bg-blue-500/5 p-4">
          <p className="text-sm font-semibold text-blue-200">New-customer guardrails</p>
          <p className="mt-1 text-xs text-blue-100/90">
            If phone + last name match an existing customer, pick that record from search instead of creating a duplicate. Tax certificate upload stays "attach later" until document storage is wired.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-blue-100/90">
            <span className="rounded-full border border-blue-400/30 px-2 py-1">Search before create</span>
            <span className="rounded-full border border-blue-400/30 px-2 py-1">Phone + last name dedupe</span>
            <span className="rounded-full border border-blue-400/30 px-2 py-1">Resale certificate: attach later</span>
          </div>
        </Card>
      )}

      <CustomerIntelPanel
        customerCompany={draft.customerCompany ?? ""}
        companyId={draft.companyId ?? null}
        signals={draft.customerSignals ?? null}
        warmth={draft.customerWarmth ?? null}
      />

      {!hasCustomer ? (
        <p className="text-[11px] text-muted-foreground">
          Select or add a customer, or use "Quote for prospect" from the mobile step bar below for a walk-in.
        </p>
      ) : null}
    </div>
  );
}
