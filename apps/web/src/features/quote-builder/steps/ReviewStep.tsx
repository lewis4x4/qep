/**
 * PR 18 — Quote wizard Step 9 (review + approval).
 *
 * Extracted from `QuoteBuilderV2Page.tsx` per IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
 * Uses `useWizard()` for draft / setDraft / setStep. Approval mutation, margin
 * totals, and workflow panels stay page-owned and pass in as props.
 */

import { Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import type {
  QuoteAutoSendResult,
  QuoteFinanceScenario,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarginCheckBanner } from "../components/MarginCheckBanner";
import { QuoteReviewWorkflowPanels } from "../components/QuoteReviewWorkflowPanels";
import { ReviewSummaryBlock } from "../components/ReviewSummaryBlock";
import {
  applyEquipmentOverridePrice,
  equipmentSystemBasePrice,
} from "../lib/equipment-override-price";
import { money } from "../lib/money";
import { dateInputValue } from "../lib/quote-date-input";
import { useWizard } from "../wizard/useWizard";

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
  dealerCost: number;
  marginAmount: number;
  activeQuotePackageId: string | null;
  allFinanceScenarios: QuoteFinanceScenario[];
  sendReadiness: { ready: boolean; missing: string[] };
  requiresManagerApproval: boolean;
  userRole: string | null;
  canSubmitForApproval: boolean;
  approvalPending: boolean;
  approvalGranted: boolean;
  bypassApprovedWithoutCase: boolean;
  submitApprovalPending: boolean;
  onSubmitApproval: () => void;
  submitApprovalData?: {
    status?: string;
    bypassRuleName?: string | null;
    assignedToName?: string | null;
    branchName?: string | null;
    autoSend?: QuoteAutoSendResult | null;
  };
  quoteStatus: QuoteWorkspaceDraft["quoteStatus"];
  onQuoteStatusChange: (status: QuoteWorkspaceDraft["quoteStatus"]) => void;
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
  dealerCost,
  marginAmount,
  activeQuotePackageId,
  allFinanceScenarios,
  sendReadiness,
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
}: ReviewStepProps) {
  const { draft, setDraft, setStep } = useWizard();
  const firstEquipment = draft.equipment[0];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Step 9: Review + approval</h2>
        <p className="mt-1 text-sm text-muted-foreground">Everything in one plain-English summary. Approval case status is the authoritative gate before document generation and customer delivery.</p>
      </div>

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

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <ReviewSummaryBlock title="Customer" rows={[
            ["Name", draft.customerName || draft.customerCompany || "Not set"],
            ["Company", draft.customerCompany || "—"],
            ["Email", draft.customerEmail || "Missing before send"],
            ["Branch", branchDisplayName],
          ]} />
          <ReviewSummaryBlock title="Equipment" rows={[
            ["Primary", firstEquipment?.title || [firstEquipment?.make, firstEquipment?.model].filter(Boolean).join(" ") || "No equipment"],
            ["Config rows", String(draft.attachments.length)],
            ["Trade", draft.tradeAllowance > 0 ? money(draft.tradeAllowance) : "No trade"],
            ["Availability", availabilityAwaitingCount > 0 ? "Needs sourcing request" : "Ready for review"],
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
          <Button onClick={onSubmitApproval} disabled={!canSubmitForApproval || submitApprovalPending}>
            {submitApprovalPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {approvalPending ? "Approval pending" : approvalGranted ? "Approved" : "Submit for approval"}
          </Button>
        </div>
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
