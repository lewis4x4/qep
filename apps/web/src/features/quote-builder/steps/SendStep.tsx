/**
 * PR 20 — Quote wizard Step 11 (send & log).
 */

import { ArrowLeft, CheckCircle2, FileText, Loader2, Mail, Save, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
// WAVE parity-close (Slice 3): readiness diagnostics collapse into an
// accordion on phone, the sticky footer pins Save follow-up with a
// safe-area inset, and a successful send fills the viewport with a
// full-bleed confirmation banner.
import { MobileSectionAccordion } from "@/features/sales/components/MobileSectionAccordion";
import { useIsMobileViewport } from "@/features/sales/hooks/useIsMobileViewport";
import { QuoteSendActionCard } from "../components/QuoteSendActionCard";
import { ReadinessRow } from "../components/ReadinessRow";
import { dateTimeInputValue, isoFromDateTimeInput, shortDateTime } from "../lib/quote-date-input";
import { QUOTE_FOLLOW_UP_DEFAULT_DAYS, quoteLifecycleWarning } from "../lib/quote-lifecycle-policy";
import type { QuoteReadinessState } from "../../../../../../shared/qep-moonshot-contracts";
import type { QuoteSendActionChannel } from "../lib/quote-workspace";
import { useWizard } from "../wizard/useWizard";

export interface SendStepProps {
  customerFacingDocumentBlocker: string | null;
  approvalCaseCanSend: boolean;
  approvalBlocker: string | null;
  documentReady: boolean;
  documentPersistenceLabel: string;
  taxResolved: boolean;
  taxResolutionBlocker: string | null;
  whyThisMachineRequired: boolean;
  whyThisMachineBlocker: string | null;
  previewReadiness: QuoteReadinessState;
  emailReadiness: QuoteReadinessState;
  textReadiness: QuoteReadinessState;
  textQuoteEnabled: boolean;
  deliveryActionBusy: QuoteSendActionChannel | null;
  pdfGenerating: boolean;
  deliveryActionMessage: string | null;
  deliveryActionError: string | null;
  savePending: boolean;
  onPreview: () => void;
  onEmail: () => void;
  onText: () => void;
  onSaveFollowUp: () => void;
}

export function SendStep({
  customerFacingDocumentBlocker,
  approvalCaseCanSend,
  approvalBlocker,
  documentReady,
  documentPersistenceLabel,
  taxResolved,
  taxResolutionBlocker,
  whyThisMachineRequired,
  whyThisMachineBlocker,
  previewReadiness,
  emailReadiness,
  textReadiness,
  textQuoteEnabled,
  deliveryActionBusy,
  pdfGenerating,
  deliveryActionMessage,
  deliveryActionError,
  savePending,
  onPreview,
  onEmail,
  onText,
  onSaveFollowUp,
}: SendStepProps) {
  const { draft, setDraft, setStep } = useWizard();
  const isMobile = useIsMobileViewport();
  const followUpWarning = quoteLifecycleWarning({ followUpAt: draft.followUpAt, expiresAt: draft.expiresAt });
  const followUpReady = Boolean(draft.followUpAt) && !followUpWarning;
  const readinessAllReady =
    approvalCaseCanSend &&
    documentReady &&
    followUpReady &&
    taxResolved &&
    (!whyThisMachineRequired || draft.whyThisMachineConfirmed === true);
  const readinessSummary = readinessAllReady ? "All gates clear" : "Action needed";

  const readinessRows = (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="send-step-readiness-rows">
      <ReadinessRow label="Approval case" ready={approvalCaseCanSend} detail={approvalBlocker ?? "canSend is true"} />
      <ReadinessRow label="Document" ready={documentReady} detail={documentReady ? documentPersistenceLabel : "Generate Step 10 preview first"} />
      <ReadinessRow label="Follow-up" ready={followUpReady} detail={followUpWarning ?? (draft.followUpAt ? (shortDateTime(draft.followUpAt) ?? "Scheduled") : "Required before email/text")} />
      <ReadinessRow label="Tax" ready={taxResolved} detail={taxResolutionBlocker ?? "Tax preview resolved"} />
      <ReadinessRow label="Why this machine" ready={!whyThisMachineRequired || draft.whyThisMachineConfirmed === true} detail={whyThisMachineBlocker ?? "Rep confirmed or not required"} />
    </div>
  );

  const postApprovalRouting = (
    <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Post-approval routing</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {(draft.postApprovalAction ?? "return_to_rep") === "auto_send_customer"
          ? "Auto-send to customer is selected. Once approval clears, the system attempts immediate customer delivery."
          : "Return-to-rep is selected. Approval clears the quote, but the rep controls final customer send timing."}
      </p>
    </div>
  );

  const followUpInput = (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">Required follow-up reminder</span>
      <input
        type="datetime-local"
        value={dateTimeInputValue(draft.followUpAt)}
        onChange={(event) => setDraft((current) => ({ ...current, followUpAt: isoFromDateTimeInput(event.target.value) }))}
        className="min-h-[44px] w-full rounded border border-input bg-card px-3 py-2 text-base sm:max-w-xs sm:text-sm"
        data-testid="send-step-followup-input"
      />
      <span className="block text-xs text-muted-foreground">Defaults to +{QUOTE_FOLLOW_UP_DEFAULT_DAYS} days when absent. Email/text send/log remains blocked without a scheduled follow-up before expiration.</span>
      {followUpWarning ? <span className="block text-xs font-medium text-amber-300">{followUpWarning}</span> : null}
    </label>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 11: Send & log</h2>
        <p className="mt-1 text-sm text-muted-foreground">Preview, email, or text the quote only after clean approval and a follow-up date are present.</p>
      </div>

      <Card className="border-border/70 bg-muted/20 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Send vs document & review.</span>{" "}
          Regenerate the customer PDF in{" "}
          <Button
            type="button"
            variant="link"
            title="Step 10 — Document preview"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("document")}
          >
            PDF
          </Button>
          . If totals or approval change, return to{" "}
          <Button
            type="button"
            variant="link"
            title="Step 9 — Review + approval"
            className="h-auto min-h-0 inline p-0 text-xs font-semibold leading-relaxed"
            onClick={() => setStep("review")}
          >
            Review
          </Button>
          .
        </p>
      </Card>

      {customerFacingDocumentBlocker && (
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-300">Customer send blocked</p>
          <p className="mt-1 text-xs text-amber-200">{customerFacingDocumentBlocker}</p>
        </Card>
      )}

      {isMobile ? (
        <MobileSectionAccordion
          index={1}
          title="Readiness gates"
          caption={readinessSummary}
          defaultOpen={!readinessAllReady}
        >
          <div className="space-y-3 pt-2">
            {readinessRows}
            {postApprovalRouting}
            {followUpInput}
          </div>
        </MobileSectionAccordion>
      ) : (
        <Card className="p-4">
          {readinessRows}
          <div className="mt-4">{postApprovalRouting}</div>
          <div className="mt-4">{followUpInput}</div>
        </Card>
      )}

      {/* WAVE parity-close (Slice 3): on mobile a successful send fills
          the upper viewport with a full-bleed banner so the rep sees
          the confirmation without scrolling; desktop renders the
          existing inline success/error strip below the cards. */}
      {isMobile && deliveryActionMessage ? (
        <div
          className="-mx-4 border-y border-emerald-500/30 bg-emerald-500/10 px-4 py-5 text-center sm:hidden"
          role="status"
          aria-live="polite"
          data-testid="send-step-mobile-success"
        >
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-300" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-emerald-100">{deliveryActionMessage}</p>
        </div>
      ) : null}

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <QuoteSendActionCard
            icon={<FileText className="h-4 w-4" />}
            title="Preview Quote"
            detail="Open the latest quote PDF/print preview and log a preview event. Does not mark sent."
            readiness={previewReadiness}
            busy={deliveryActionBusy === "preview" || pdfGenerating}
            onClick={onPreview}
          />
          <QuoteSendActionCard
            icon={<Mail className="h-4 w-4" />}
            title="Email Quote"
            detail="Send the guarded customer proposal email through the existing backend email route and log the delivery event."
            readiness={emailReadiness}
            busy={deliveryActionBusy === "email"}
            onClick={onEmail}
          />
          <QuoteSendActionCard
            icon={<Smartphone className="h-4 w-4" />}
            title="Text proposal link"
            detail={textQuoteEnabled ? "SMS delivery is not connected yet. Prepared template: ‘Quality Equipment & Parts: Your proposal is ready to review at {{proposal_link}}.’ Keep using email or the approved proposal link until the provider endpoint is wired." : "Text delivery is off for this workspace. Prepared SMS wording is ready, but reps should email the proposal or share the approved proposal link."}
            readiness={textReadiness}
            setupBlocked={!textQuoteEnabled}
            busy={deliveryActionBusy === "text"}
            onClick={onText}
          />
        </div>
        {/* The compact inline strip is the desktop affordance and a
            phone fallback (when the full-bleed banner above is absent). */}
        {deliveryActionMessage && !isMobile && (
          <p className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">{deliveryActionMessage}</p>
        )}
        {deliveryActionError && (
          <p className="mt-3 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{deliveryActionError}</p>
        )}
      </Card>

      {isMobile ? (
        <div
          className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-white/[0.06] bg-[hsl(var(--qep-bg))]/95 px-4 pt-3 backdrop-blur-md"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
          data-testid="send-step-mobile-footer"
        >
          <Button
            variant="outline"
            onClick={() => setStep("document")}
            className="min-h-[44px] gap-1"
            data-testid="send-step-back"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button
            onClick={onSaveFollowUp}
            disabled={savePending}
            className="min-h-[44px] flex-1 justify-center gap-2"
            data-testid="send-step-save-followup"
          >
            {savePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save follow-up
          </Button>
        </div>
      ) : (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep("document")} className="min-h-[44px]">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Button variant="outline" onClick={onSaveFollowUp} disabled={savePending} className="min-h-[44px]">
            {savePending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save follow-up
          </Button>
        </div>
      )}
    </div>
  );
}
