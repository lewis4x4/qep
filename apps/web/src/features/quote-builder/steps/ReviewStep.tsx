/**
 * PR 18 — Quote wizard Step 9 (review + approval).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Approval mutation, margin
 * totals, and workflow panels stay page-owned and pass in as props.
 */

import { Loader2, ArrowLeft, ArrowRight, Lock, Unlock } from "lucide-react";
import { useState, type ReactNode } from "react";
import type {
  QuoteAutoSendResult,
  QuoteFinanceScenario,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarginCheckBanner } from "../components/MarginCheckBanner";
import { QuoteReviewWorkflowPanels } from "../components/QuoteReviewWorkflowPanels";
import type { SendQuoteSectionResult } from "../components/SendQuoteSection";
import { ReviewSummaryBlock } from "../components/ReviewSummaryBlock";
import {
  applyEquipmentOverridePrice,
  equipmentSystemBasePrice,
} from "../lib/equipment-override-price";
import { money } from "../lib/money";
import { formatMarginFloorPct } from "../lib/quote-workspace";
import { dateInputValue } from "../lib/quote-date-input";
import { computeReviewApprovalSubmissionState, computeReviewSendGate } from "../lib/review-gates";
import { useWizard } from "../wizard/useWizard";
// WAVE quote-builder deep reflow (B5)
import { MobileSectionAccordion } from "@/features/sales/components/MobileSectionAccordion";
import { useIsMobileViewport } from "@/features/sales/hooks/useIsMobileViewport";

export interface ReviewStepProps {
  branchDisplayName: string;
  financeMethodLabel: string;
  availabilityAwaitingCount: number;
  subtotal: number;
  discountTotal: number;
  taxableBasis: number;
  taxTotal: number;
  customerTotal: number;
  cashDown: number;
  amountFinanced: number;
  netTotal: number;
  marginPct: number;
  marginFloorPct: number | null;
  marginFloorResolved: boolean;
  dealerCost: number;
  marginAmount: number;
  activeQuotePackageId: string | null;
  allFinanceScenarios: QuoteFinanceScenario[];
  leaseQuotingEnabled: boolean;
  sendReadiness: { ready: boolean; missing: string[] };
  approvalCaseCanSend: boolean;
  requiresManagerApproval: boolean;
  userRole: string | null;
  canSubmitForApproval: boolean;
  approvalPending: boolean;
  approvalGranted: boolean;
  bypassApprovedWithoutCase: boolean;
  submitApprovalPending: boolean;
  /**
   * Phase 1 quote-approval feedback loop: rep may supply an optional
   * one-line justification when the quote sits below the margin floor.
   * Note is forwarded into the submit-approval edge function so the
   * approver sees rep context alongside the case payload.
   */
  onSubmitApproval: (submissionNote: string) => void;
  submitApprovalData?: {
    status?: string;
    bypassRuleName?: string | null;
    assignedToName?: string | null;
    branchName?: string | null;
    autoSend?: QuoteAutoSendResult | null;
  };
  quoteStatus: QuoteWorkspaceDraft["quoteStatus"];
  onQuoteStatusChange: (status: QuoteWorkspaceDraft["quoteStatus"]) => void;
  onSendQuote?: () => Promise<SendQuoteSectionResult>;
  /**
   * Phase 3B quote-approval feedback loop — current viewer's user id.
   * The QuoteReviewWorkflowPanels card uses this to decide whether to
   * render the "Withdraw submission" affordance (only the submitter
   * sees it).
   */
  currentUserId?: string | null;
  /**
   * Phase 3B quote-approval feedback loop — fires when the submitter
   * confirms the withdraw dialog. The active approval-case id is
   * resolved by the workflow panel from its own queries; the optional
   * reason flows from the dialog's textarea.
   */
  onWithdrawApproval?: (input: { approvalCaseId: string; reason?: string | null }) => void;
  withdrawApprovalPending?: boolean;
}

export function ReviewStep({
  branchDisplayName,
  financeMethodLabel,
  availabilityAwaitingCount,
  subtotal,
  discountTotal,
  taxableBasis,
  taxTotal,
  customerTotal,
  cashDown,
  amountFinanced,
  netTotal,
  marginPct,
  marginFloorPct,
  marginFloorResolved,
  dealerCost,
  marginAmount,
  activeQuotePackageId,
  allFinanceScenarios,
  leaseQuotingEnabled,
  sendReadiness,
  approvalCaseCanSend,
  requiresManagerApproval,
  userRole,
  canSubmitForApproval,
  approvalPending,
  approvalGranted,
  bypassApprovedWithoutCase,
  submitApprovalPending,
  onSubmitApproval,
  submitApprovalData,
  quoteStatus,
  onQuoteStatusChange,
  onSendQuote,
  currentUserId,
  onWithdrawApproval,
  withdrawApprovalPending,
}: ReviewStepProps) {
  const { draft, setDraft, setStep } = useWizard();
  const firstEquipment = draft.equipment[0];
  // WAVE B5 deep reflow: mobile reps see a customer-total hero plus
  // the four summary blocks wrapped in collapsible numbered accordions.
  // Desktop keeps the 2x2 grid for density.
  const isMobile = useIsMobileViewport();
  const customerDisplay = draft.customerName || draft.customerCompany || "Customer";
  const statusLabel = (draft.quoteStatus ?? "draft").replace(/_/g, " ");

  // Phase 1 quote-approval feedback loop: rep justification capture.
  // Below the configured margin floor (the same threshold MarginCheckBanner
  // flags red) the textarea is required and the Submit button is
  // disabled until non-empty. Above the floor the field becomes an
  // optional disclosure so reps can still attach context.
  const [submissionNote, setSubmissionNote] = useState("");
  const [optionalNoteOpen, setOptionalNoteOpen] = useState(false);
  const SUBMISSION_NOTE_MAX = 280;
  const marginFloorLabel = marginFloorResolved ? formatMarginFloorPct(marginFloorPct) : "checking policy…";
  const trimmedNoteLength = submissionNote.trim().length;
  const reviewSendGate = computeReviewSendGate({ approvalCaseCanSend, sendReadiness });
  const reviewSubmissionState = computeReviewApprovalSubmissionState({
    canSubmitForApproval,
    submitApprovalPending,
    marginFloorResolved,
    requiresManagerApproval,
    approvalGranted,
    trimmedNoteLength,
  });
  const { ready: reviewSendReady, missing: reviewSendMissing } = reviewSendGate;
  const {
    requiresJustification,
    marginFloorPolicyBlocked,
    justificationMissing,
    submitDisabled,
  } = reviewSubmissionState;
  const showSubmissionField = canSubmitForApproval && !approvalPending && !approvalGranted;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 9: Review + approval</h2>
        <p className="mt-1 text-sm text-muted-foreground">Everything in one plain-English summary. Approval case status is the authoritative gate before document generation and customer delivery.</p>
      </div>

      {/* WAVE B5: mobile-only quote-value hero. Hidden on >= sm because the
          desktop grid already gives reps the totals at a glance. */}
      {isMobile && (
        <Card
          className="border-qep-orange/30 bg-qep-orange/5 p-4 sm:hidden"
          data-testid="review-quote-hero"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Customer total
          </p>
          <p className="mt-1 text-3xl font-bold text-qep-orange">{money(customerTotal)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-qep-orange/30 bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-qep-orange">
              {statusLabel}
            </span>
            <span className="text-xs text-muted-foreground truncate">{customerDisplay}</span>
          </div>
        </Card>
      )}

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Review vs details & document.</span>{" "}
          Dates and special terms stay in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 8 — Quote details"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("details")}
          >
            Details
          </Button>
          . Customer PDF preview and artifact storage are{" "}
          <Button
            type="button"
            variant="link"
            title="Step 10 — Document preview"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("document")}
          >
            PDF
          </Button>
          .
        </p>
      </Card>

      {(() => {
        // WAVE B5: four review summaries. Desktop renders them as the
        // existing 2x2 grid inside one Card. Mobile renders them as
        // numbered MobileSectionAccordions (Customer expanded by default)
        // with an "Edit" jump back to the source step.
        const sections: Array<{
          step: Parameters<typeof setStep>[0];
          title: string;
          rows: Array<[string, string]>;
        }> = [
          {
            step: "customer",
            title: "Customer",
            rows: [
              ["Name", draft.customerName || draft.customerCompany || "Not set"],
              ["Company", draft.customerCompany || "—"],
              ["Email", draft.customerEmail || "Missing before send"],
              ["Branch", branchDisplayName],
            ],
          },
          {
            step: "equipment",
            title: "Equipment",
            rows: [
              ["Primary", firstEquipment?.title || [firstEquipment?.make, firstEquipment?.model].filter(Boolean).join(" ") || "No equipment"],
              ["Config rows", String(draft.attachments.length)],
              ["Trade", draft.tradeAllowance > 0 ? money(draft.tradeAllowance) : "No trade"],
              ["Availability", availabilityAwaitingCount > 0 ? "Needs sourcing request" : "Ready for review"],
            ],
          },
          {
            step: "pricing",
            title: "Pricing + tax",
            rows: [
              ["Subtotal", money(subtotal)],
              ["Discounts", `-${money(discountTotal)}`],
              ["Taxable basis", money(taxableBasis)],
              ["Tax", money(taxTotal)],
              ["Customer total", money(customerTotal)],
            ],
          },
          {
            step: "details",
            title: "Finance + details",
            rows: [
              ["Scenario", financeMethodLabel],
              ["Amount financed", money(amountFinanced)],
              ["Expires", dateInputValue(draft.expiresAt) || "Default needed"],
              ["Delivery ETA", dateInputValue(draft.deliveryEta) || "TBD"],
              ["Why confirmed", draft.whyThisMachineConfirmed ? "Yes" : "Needs rep confirm"],
            ],
          },
        ];

        if (isMobile) {
          const renderEditAction = (
            stepKey: Parameters<typeof setStep>[0],
          ): ReactNode => (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-qep-orange hover:text-qep-orange"
              onClick={(event) => {
                event.stopPropagation();
                setStep(stepKey);
              }}
              data-testid={`review-edit-${stepKey}`}
            >
              Edit
            </Button>
          );
          return (
            <div className="space-y-2" data-testid="review-summary-accordions">
              {sections.map((section, index) => (
                <MobileSectionAccordion
                  key={section.title}
                  index={index + 1}
                  title={section.title}
                  defaultOpen={index === 0}
                  trailing={renderEditAction(section.step)}
                >
                  <ReviewSummaryBlock title={section.title} rows={section.rows} />
                </MobileSectionAccordion>
              ))}
            </div>
          );
        }

        return (
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.map((section) => (
                <ReviewSummaryBlock key={section.title} title={section.title} rows={section.rows} />
              ))}
            </div>
          </Card>
        );
      })()}

      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground">Equipment pricing at review</p>
        <p className="mt-1 text-xs text-muted-foreground">Final opportunity to adjust machine price before approval submission.</p>
        <div className="mt-3 space-y-2">
          {draft.equipment.length === 0 ? (
            <p className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              No equipment selected yet.
            </p>
          ) : draft.equipment.map((equipment, index) => {
            const systemBase = equipmentSystemBasePrice(equipment);
            const hasOverride = Math.abs(equipment.unitPrice - systemBase) > 0.01;
            return (
              <div key={`review-override-${equipment.id ?? equipment.title}-${index}`} className="rounded-lg border border-border/70 bg-card/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{equipment.title || `${equipment.make ?? ""} ${equipment.model ?? ""}`.trim() || "Equipment"}</p>
                  <span className="text-xs text-muted-foreground">
                    {hasOverride ? `Override active (base ${money(systemBase)})` : `Base ${money(systemBase)}`}
                  </span>
                </div>
                <label className="mt-2 flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-sm font-semibold text-foreground">
                  <span className="text-muted-foreground">$</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={equipment.unitPrice}
                    onChange={(event) => {
                      const parsed = event.target.value === "" ? 0 : Number(event.target.value);
                      if (!Number.isFinite(parsed) || parsed < 0) return;
                      setDraft((current) => ({
                        ...current,
                        equipment: current.equipment.map((item, rowIndex) => (
                          rowIndex === index ? applyEquipmentOverridePrice(item, parsed) : item
                        )),
                      }));
                    }}
                    className="w-full bg-transparent text-right outline-none"
                    aria-label={`Review price for ${equipment.title}`}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </Card>

      <MarginCheckBanner
        marginPct={marginPct}
        marginFloorPct={marginFloorPct}
        waterfall={{
          equipmentTotal: subtotal,
          dealerCost,
          netTotal,
          marginAmount,
        }}
      />

      <Card className={`p-4 ${reviewSendReady ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`} data-testid="review-send-gate">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {reviewSendReady ? (
              <Unlock className="mt-0.5 h-5 w-5 text-emerald-300" />
            ) : (
              <Lock className="mt-0.5 h-5 w-5 text-amber-300" />
            )}
            <div>
              <p className="text-sm font-semibold text-foreground">
                Customer send {reviewSendReady ? "unlocked by Review" : "locked by Review"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Review is the final send gate. Margin floor: {marginFloorLabel}; current margin: {marginPct.toFixed(1)}%.
              </p>
              {reviewSendMissing.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {[...new Set(reviewSendMissing)].map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant={reviewSendReady ? "default" : "outline"}
            disabled={!reviewSendReady}
            onClick={() => setStep("send")}
            data-testid="review-send-gate-action"
          >
            {reviewSendReady ? "Continue to send" : "Resolve Review blockers"}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Approval handoff</p>
            <p className="mt-1 text-xs text-muted-foreground">Submit routes through the existing approval-case workflow. Future document/send steps should trust activeApprovalCase.canSend, not a duplicate UI flag.</p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Workspace auto-approve rules (for example aged stocked inventory) read yard age from the primary machine line&apos;s{" "}
              <span className="font-medium text-foreground">metadata.received_at</span> when CRM provides it, optional{" "}
              <span className="font-medium text-foreground">metadata.hot_list</span> for hot-list gates, plus in-stock and margin checks.
              {" "}
              When a rule sets a max discount %, the saved quote&apos;s{" "}
              <span className="font-medium text-foreground">discount_total</span> relative to{" "}
              <span className="font-medium text-foreground">subtotal</span> must stay within that cap.
              {" "}
              If a rule matches, the server sets the quote to <span className="font-medium text-foreground">Approved</span> or{" "}
              <span className="font-medium text-foreground">Approved with conditions</span> according to that rule&apos;s{" "}
              <span className="font-medium text-foreground">bypass_to_status</span> (only those two targets are allowed).
            </p>
          </div>
          <Button
            onClick={() => onSubmitApproval(submissionNote)}
            disabled={submitDisabled}
            data-testid="review-submit-approval"
          >
            {submitApprovalPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {approvalPending ? "Approval pending" : approvalGranted ? "Approved" : "Submit for approval"}
          </Button>
        </div>
        {marginFloorPolicyBlocked && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200" data-testid="margin-floor-policy-pending">
            Checking configured margin policy before approval submission unlocks.
          </p>
        )}
        {showSubmissionField && (
          requiresJustification ? (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3" data-testid="submission-note-required">
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-red-300">
                Why does this need approval?
              </label>
              <p className="mt-1 text-[11px] text-red-200">
                Margin below {marginFloorLabel} — give your approver one line of context so they can decide fast.
              </p>
              <textarea
                value={submissionNote}
                onChange={(event) => setSubmissionNote(event.target.value.slice(0, SUBMISSION_NOTE_MAX))}
                placeholder="Door-opener — 3-store account, 18-month payback expected"
                maxLength={SUBMISSION_NOTE_MAX}
                rows={3}
                className="mt-2 w-full rounded border border-red-500/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-red-500/60"
                aria-required="true"
                aria-invalid={justificationMissing}
                data-testid="submission-note-input"
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">
                {trimmedNoteLength}/{SUBMISSION_NOTE_MAX}
              </p>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-border/60 bg-card/40" data-testid="submission-note-optional">
              <button
                type="button"
                onClick={() => setOptionalNoteOpen((open) => !open)}
                aria-expanded={optionalNoteOpen}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                <span>Add note for the approver (optional)</span>
                <span className="text-[10px]">{optionalNoteOpen ? "Hide" : "Show"}</span>
              </button>
              {optionalNoteOpen && (
                <div className="px-3 pb-3">
                  <textarea
                    value={submissionNote}
                    onChange={(event) => setSubmissionNote(event.target.value.slice(0, SUBMISSION_NOTE_MAX))}
                    placeholder="Door-opener — 3-store account, 18-month payback expected"
                    maxLength={SUBMISSION_NOTE_MAX}
                    rows={3}
                    className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-qep-orange/60"
                    data-testid="submission-note-input"
                  />
                  <p className="mt-1 text-right text-[11px] text-muted-foreground">
                    {trimmedNoteLength}/{SUBMISSION_NOTE_MAX}
                  </p>
                </div>
              )}
            </div>
          )
        )}
        <div className="mt-3 rounded-lg border border-border/70 bg-card/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Post-approval action</p>
          <p className="mt-1 text-xs text-muted-foreground">Choose whether approved quotes auto-send to the customer or route back to the rep for final delivery timing.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={(draft.postApprovalAction ?? "return_to_rep") === "return_to_rep"}
              onClick={() => setDraft((current) => ({ ...current, postApprovalAction: "return_to_rep" }))}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                (draft.postApprovalAction ?? "return_to_rep") === "return_to_rep"
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <p className="font-semibold">Return to rep</p>
              <p className="mt-1 text-[11px]">Default path. Rep reviews and manually sends to customer.</p>
            </button>
            <button
              type="button"
              aria-pressed={draft.postApprovalAction === "auto_send_customer"}
              onClick={() => setDraft((current) => ({ ...current, postApprovalAction: "auto_send_customer" }))}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                draft.postApprovalAction === "auto_send_customer"
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <p className="font-semibold">Auto-send customer</p>
              <p className="mt-1 text-[11px]">Queue approved quote for automatic customer delivery.</p>
            </button>
          </div>
        </div>
        {(bypassApprovedWithoutCase
          || ((submitApprovalData?.status === "approved" || submitApprovalData?.status === "approved_with_conditions")
            && submitApprovalData?.bypassRuleName)) && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2" role="status" data-testid="wizard-approval-auto-approved">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300">Auto-approved</p>
            <p className="mt-1 text-xs text-emerald-100">
              {submitApprovalData?.bypassRuleName
                ? (
                  <>
                    Approval bypass applied
                    {submitApprovalData.status === "approved_with_conditions" ? " — quote status is approved with conditions" : ""}
                    : <span className="font-semibold">{submitApprovalData.bypassRuleName}</span>
                  </>
                )
                : "Workspace approval bypass applied — no manager approval case required."}
            </p>
          </div>
        )}
        {submitApprovalData?.autoSend?.attempted && (
          <div className={`mt-3 rounded-lg border px-3 py-2 ${
            submitApprovalData.autoSend.sent
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          }`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.12em] ${
              submitApprovalData.autoSend.sent ? "text-emerald-300" : "text-amber-300"
            }`}>
              Post-approval auto-send
            </p>
            <p className={`mt-1 text-xs ${
              submitApprovalData.autoSend.sent ? "text-emerald-100" : "text-amber-100"
            }`}>
              {submitApprovalData.autoSend.sent
                ? "Quote was auto-sent to the customer after approval."
                : `Auto-send attempted but did not complete${submitApprovalData.autoSend.error ? `: ${submitApprovalData.autoSend.error}` : "."}`}
            </p>
          </div>
        )}
      </Card>

      {activeQuotePackageId ? (
        <QuoteReviewWorkflowPanels
          quotePackageId={activeQuotePackageId}
          draft={draft}
          financeScenarios={allFinanceScenarios}
          leaseQuotingEnabled={leaseQuotingEnabled}
          computed={{ subtotal, discountTotal, netTotal, taxTotal, customerTotal, cashDown, amountFinanced }}
          sendReadiness={sendReadiness}
          requiresManagerApproval={requiresManagerApproval}
          userRole={userRole}
          submitApprovalResult={{
            assignedToName: submitApprovalData?.assignedToName ?? null,
            branchName: submitApprovalData?.branchName ?? null,
            autoSend: submitApprovalData?.autoSend ?? null,
          }}
          quoteStatus={quoteStatus}
          onQuoteStatusChange={onQuoteStatusChange}
          showSendSection={false}
          onSendQuote={onSendQuote}
          currentUserId={currentUserId ?? null}
          onWithdrawApproval={onWithdrawApproval}
          withdrawApprovalPending={withdrawApprovalPending === true}
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
  );
}
