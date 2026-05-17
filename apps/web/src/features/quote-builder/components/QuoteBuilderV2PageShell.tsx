/**
 * Post–PR 21 orchestrator slimming: layout chrome from `QuoteBuilderV2Page.tsx`.
 */

import { Link } from "react-router-dom";
import type { ComponentProps, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DealAssistantTrigger } from "./ConversationalDealEngine";
import { AskIronAdvisorButton } from "@/components/primitives";
import { QuoteBuilderStickyBar } from "./QuoteBuilderStickyBar";
import { QuoteBuilderStatusBanners } from "./QuoteBuilderStatusBanners";
import { QuoteBuilderOverlays } from "./QuoteBuilderOverlays";
import { MarginFloorGate } from "./MarginFloorGate";
import { DealCoachSidebar } from "./DealCoachSidebar";
import { MobileIntelligencePanelHost } from "./MobileIntelligencePanelHost";
import { WizardShell, type QuotingBranchOption } from "../wizard/WizardShell";
import { STEP_LABELS, type AutoSaveState, type Step } from "../wizard/wizard-types";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import type { QuotePacketReadiness } from "../../../../../../shared/qep-moonshot-contracts";

export type QuoteBuilderOverlaysProps = ComponentProps<typeof QuoteBuilderOverlays>;

export interface QuoteBuilderV2PageShellProps {
  quoteTitle: string;
  quoteStatus: string;
  autoSaveState: AutoSaveState;
  displayedSavedLabel: string | null;
  packetReadiness: QuotePacketReadiness;
  customerTotal: number;
  financeMethodLabel: string;
  primaryActionLabel: string;
  primaryActionDisabled: boolean;
  primaryActionPending: boolean;
  primaryActionShowsSendIcon: boolean;
  onPrimaryAction: () => void;
  draft: QuoteWorkspaceDraft;
  step: Step;
  dealAssistantOpen: boolean;
  onDealAssistantOpenChange: (open: boolean) => void;
  activeQuotePackageId: string | null;
  activeQuoteNumber: string | null;
  activeQuoteUpdatedAt: string | null;
  existingQuoteLoadError: string | null;
  existingQuoteEditingMessage: string | null;
  currentWizardStepNumber: number;
  signalsReady: boolean;
  marginPct: number;
  marginAmount: number;
  wizardPricingJumpAllowed: boolean;
  branches: QuotingBranchOption[];
  wizardNextHelp: string;
  previousWizardStep: Step | null;
  nextWizardStep: Step | null;
  wizardNextDisabled: boolean;
  nextWizardLabel: string | null;
  hasCustomer: boolean;
  onQuoteForProspect: () => void;
  wizardMaxStepIndex0: number;
  wizardStepRouter: ReactNode;
  equipmentTotal: number;
  attachmentTotal: number;
  subtotal: number;
  netTotal: number;
  marginGateOpen: boolean;
  onMarginGateOpenChange: (open: boolean) => void;
  onMarginReasonConfirm: (payload: {
    reason: string;
    thresholdPct: number;
    estimatedGapCents: number;
  }) => void;
  pdfError: string | null;
  saveSuccess: boolean;
  saveErrorMessage: string | null;
  submitApprovalErrorMessage: string | null;
  intelligencePanel: ReactNode;
  overlays: QuoteBuilderOverlaysProps;
}

export function QuoteBuilderV2PageShell({
  quoteTitle,
  quoteStatus,
  autoSaveState,
  displayedSavedLabel,
  packetReadiness,
  customerTotal,
  financeMethodLabel,
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
  activeQuoteUpdatedAt,
  existingQuoteLoadError,
  existingQuoteEditingMessage,
  currentWizardStepNumber,
  signalsReady,
  marginPct,
  marginAmount,
  wizardPricingJumpAllowed,
  branches,
  wizardNextHelp,
  previousWizardStep,
  nextWizardStep,
  wizardNextDisabled,
  nextWizardLabel,
  hasCustomer,
  onQuoteForProspect,
  wizardMaxStepIndex0,
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
  intelligencePanel,
  overlays,
}: QuoteBuilderV2PageShellProps) {
  return (
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
        primaryActionPending={primaryActionPending}
        primaryActionShowsSendIcon={primaryActionShowsSendIcon}
        onPrimaryAction={onPrimaryAction}
      />

      <div className="flex w-full gap-6">
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
                onClick={() => onDealAssistantOpenChange(true)}
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
                      {(quoteStatus ?? "draft").replace(/_/g, " ")}
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
                    <Link to="/sales/quotes">Open Quotes</Link>
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
            existingQuoteLoadError={existingQuoteLoadError}
            existingQuoteEditingMessage={existingQuoteEditingMessage}
          />

          {/*
            WAVE phase 1: surface right-rail intelligence panels via
            chip-triggered bottom sheets on viewports below `xl`. The
            desktop sidebar below still renders the same panels at xl+.
          */}
          <MobileIntelligencePanelHost
            intelligencePanel={intelligencePanel}
            dealCoachPanel={
              draft.equipment.length > 0 ? (
                <DealCoachSidebar
                  draft={draft}
                  computed={{ equipmentTotal, attachmentTotal, subtotal, netTotal, marginAmount, marginPct }}
                  quotePackageId={activeQuotePackageId}
                />
              ) : null
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
            onQuoteForProspect={onQuoteForProspect}
            wizardMaxStepIndex0={wizardMaxStepIndex0}
          >
            {wizardStepRouter}
          </WizardShell>

          <MarginFloorGate
            brandId={null}
            marginPct={marginPct}
            netTotalCents={Math.round(netTotal * 100)}
            reasonModalOpen={marginGateOpen}
            onReasonModalOpenChange={onMarginGateOpenChange}
            onReasonConfirm={(payload) => { onMarginReasonConfirm(payload); }}
          />

          <QuoteBuilderStatusBanners
            pdfError={pdfError}
            saveSuccess={saveSuccess}
            saveErrorMessage={saveErrorMessage}
            submitApprovalErrorMessage={submitApprovalErrorMessage}
          />
        </div>

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

      <QuoteBuilderOverlays {...overlays} />
    </div>
  );
}
