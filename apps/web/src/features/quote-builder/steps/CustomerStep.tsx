/**
 * PR 10 — Quote wizard Step 1 (customer + fast intake).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Reads `draft` / `setDraft` / `setStep` from `useWizard()`; parent passes
 * intake + win-probability wiring that still lives on the page.
 */

import type { Dispatch, ReactNode, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CustomerIntelPanel } from "../components/CustomerIntelPanel";
import { CustomerSection } from "../components/CustomerSection";
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
          const next = { ...cur, [field]: value };
          if (
            field === "customerCompany" &&
            cur.customerSignals &&
            cur.customerCompany &&
            !isTypoLikeRewrite(cur.customerCompany, value)
          ) {
            next.customerSignals = null;
            next.customerWarmth  = null;
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
          <textarea
            value={draft.voiceSummary ?? ""}
            onChange={(event) => setDraft((current) => ({ ...current, voiceSummary: event.target.value }))}
            placeholder="What is the customer trying to accomplish?"
            rows={3}
            className="w-full resize-y rounded border border-input bg-card px-3 py-2 text-sm"
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

      <Card className="border-blue-500/20 bg-blue-500/5 p-4">
        <p className="text-sm font-semibold text-blue-200">New-customer guardrails</p>
        <p className="mt-1 text-xs text-blue-100/90">
          If phone + last name match an existing customer, pick that record from search instead of creating a duplicate. Tax certificate upload stays “attach later” until document storage is wired.
        </p>
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

      {!hasCustomer ? (
        <p className="text-[11px] text-muted-foreground">
          Select or add a customer, or use "Quote for prospect" from the mobile step bar below for a walk-in.
        </p>
      ) : null}
    </div>
  );
}
