/**
 * Phase 3A — QuoteApprovalDecisionDialog.
 *
 * Standalone, reusable dialog that lifts the manager decision UX out of
 * ApprovalCenterPage so the same surface can be mounted inline on:
 *   - /qrm/command/approvals (ApprovalCenterPage)
 *   - /qrm/deals/:dealId    (QrmDealDetailPage)
 *   - /sales/quotes/:id     (QuoteReviewWorkflowPanels, manager view)
 *
 * Accepts either:
 *   - a NormalizedApproval-style `ApprovalItem` (queue rows), or
 *   - a contract `QuoteApprovalCaseSummary` (deal/quote-builder inline).
 *
 * Internally the dialog:
 *   1. Resolves a `quote_package_id` from the input shape and (re)fetches
 *      the canonical `QuoteApprovalCaseSummary` via `getQuoteApprovalCase`
 *      so the Approval Activity Log always renders the live submission
 *      note + condition history regardless of caller.
 *   2. Renders the 5-decision selector, decision note, and structured-
 *      conditions builder verbatim from the prior inline implementation.
 *   3. Posts via `useDecideQuoteApproval()` and toasts auto-send outcomes.
 *   4. Invalidates the React Query keys the parent surfaces depend on:
 *        ["approvals"], ["approval-counts"], ["pending-quotes"],
 *        ["quote-builder","approval-case"], ["sales","my-approvals"], and
 *        the legacy ["qrm","approvals"] key the ApprovalCenter uses.
 *
 * Intentionally not exported as default — call sites should import the
 * named symbol so refactors stay greppable.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApprovalActivityLog } from "@/features/quote-builder/components/ApprovalActivityLog";
import { getQuoteApprovalCase } from "@/features/quote-builder/lib/quote-api";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { useDecideQuoteApproval } from "../hooks/useApprovals";
import type { ApprovalItem } from "../lib/approvalTypes";
import type {
  QuoteApprovalCaseSummary,
  QuoteApprovalConditionDraft,
  QuoteApprovalDecision,
} from "../../../../../../../shared/qep-moonshot-contracts";

// ─── Shared types ──────────────────────────────────────────────────────────

/**
 * Both shapes the dialog will accept. `ApprovalItem` comes from the
 * ApprovalCenter's list normalizer; `QuoteApprovalCaseSummary` is the
 * contract used by inline surfaces (deal detail, quote builder review).
 */
export type NormalizedApproval = ApprovalItem;

export interface QuoteApprovalDecisionDialogProps {
  open: boolean;
  onClose: () => void;
  /** Accept the queue row OR the canonical case summary. */
  approvalCase: NormalizedApproval | QuoteApprovalCaseSummary;
  /** Called after a successful decision is recorded. */
  onDecided?: (result: { decision: string; autoSent: boolean }) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const QUOTE_CONDITION_OPTIONS: Array<{ value: QuoteApprovalConditionDraft["conditionType"]; label: string }> = [
  { value: "min_margin_pct", label: "Minimum margin %" },
  { value: "max_trade_allowance", label: "Max trade allowance" },
  { value: "required_cash_down", label: "Required cash down" },
  { value: "required_finance_scenario", label: "Required finance scenario" },
  { value: "remove_attachment", label: "Remove attachment" },
  { value: "expiry_hours", label: "Approval expiry window" },
];

const DECISION_OPTIONS: Array<{ value: QuoteApprovalDecision; label: string }> = [
  { value: "approved", label: "Approve" },
  { value: "approved_with_conditions", label: "Approve with Conditions" },
  { value: "changes_requested", label: "Return for Revision" },
  { value: "rejected", label: "Reject" },
  { value: "escalated", label: "Escalate" },
];

function makeConditionDraft(type: QuoteApprovalConditionDraft["conditionType"]): QuoteApprovalConditionDraft {
  switch (type) {
    case "min_margin_pct":
      return { conditionType: type, conditionPayload: { min_margin_pct: 8 }, sortOrder: 0 };
    case "max_trade_allowance":
      return { conditionType: type, conditionPayload: { max_trade_allowance: 0 }, sortOrder: 0 };
    case "required_cash_down":
      return { conditionType: type, conditionPayload: { required_cash_down: 0 }, sortOrder: 0 };
    case "required_finance_scenario":
      return { conditionType: type, conditionPayload: { required_finance_scenario: "" }, sortOrder: 0 };
    case "remove_attachment":
      return { conditionType: type, conditionPayload: { attachment_title: "" }, sortOrder: 0 };
    case "expiry_hours":
      return { conditionType: type, conditionPayload: { expiry_hours: 72 }, sortOrder: 0 };
  }
}

// ─── Shape adapters ────────────────────────────────────────────────────────

interface ResolvedTarget {
  approvalCaseId: string;
  quotePackageId: string | null;
  headline: string;
  detail: string;
}

function isApprovalItem(value: NormalizedApproval | QuoteApprovalCaseSummary): value is NormalizedApproval {
  // ApprovalItem carries a discriminating `type` field set to a known
  // ApprovalType ("quote" when this dialog is relevant) plus the
  // `meta` bag; the canonical contract uses `quotePackageId`/etc.
  return typeof (value as ApprovalItem).type === "string"
    && Object.prototype.hasOwnProperty.call(value, "meta")
    && !Object.prototype.hasOwnProperty.call(value, "quotePackageId");
}

function resolveTarget(input: NormalizedApproval | QuoteApprovalCaseSummary): ResolvedTarget {
  if (isApprovalItem(input)) {
    const meta = input.meta ?? {};
    return {
      approvalCaseId: typeof meta.approvalCaseId === "string" ? meta.approvalCaseId : input.id,
      quotePackageId: typeof meta.quotePackageId === "string" ? meta.quotePackageId : null,
      headline: input.dealName,
      detail: input.detail,
    };
  }
  // Canonical QuoteApprovalCaseSummary path.
  const versionLine = input.versionNumber != null ? `v${input.versionNumber}` : "Version snapshot attached";
  const branchSuffix = input.branchName ? ` · ${input.branchName}` : "";
  return {
    approvalCaseId: input.id,
    quotePackageId: input.quotePackageId ?? null,
    headline: input.submittedByName
      ? `Quote from ${input.submittedByName}`
      : "Quote awaiting decision",
    detail: `${versionLine}${branchSuffix}`,
  };
}

// ─── Component ─────────────────────────────────────────────────────────────

export function QuoteApprovalDecisionDialog({
  open,
  onClose,
  approvalCase,
  onDecided,
}: QuoteApprovalDecisionDialogProps) {
  const queryClient = useQueryClient();
  const decideQuote = useDecideQuoteApproval();

  const [decision, setDecision] = useState<QuoteApprovalDecision>("approved");
  const [note, setNote] = useState("");
  const [conditions, setConditions] = useState<QuoteApprovalConditionDraft[]>([]);

  const target = resolveTarget(approvalCase);

  // Reset form whenever the dialog (re)opens or the target changes —
  // mirrors the inline ApprovalCenterPage behavior so a manager
  // deciding case-A then case-B doesn't see stale state.
  useEffect(() => {
    if (!open) return;
    setDecision("approved");
    setNote("");
    setConditions([]);
  }, [open, target.approvalCaseId]);

  // Always re-fetch the canonical case so the Activity Log renders the
  // full submission_note + decision history regardless of caller. When
  // the parent already has the summary, this still keeps the log in
  // sync after the decision posts.
  const caseQuery = useQuery({
    queryKey: ["quote-builder", "approval-case", target.quotePackageId],
    queryFn: () => getQuoteApprovalCase(target.quotePackageId!),
    enabled: Boolean(open && target.quotePackageId),
    staleTime: 5_000,
  });

  const liveCase: QuoteApprovalCaseSummary | null = caseQuery.data
    ?? (isApprovalItem(approvalCase) ? null : approvalCase);

  const noteRequired = decision === "rejected" || decision === "escalated";
  const conditionsRequired = decision === "approved_with_conditions";
  const conditionsBuilderVisible = decision === "approved_with_conditions" || decision === "changes_requested";

  const submitDisabled = decideQuote.isPending
    || (conditionsRequired && conditions.length === 0)
    || (noteRequired && note.trim().length === 0);

  function invalidateAllApprovalKeys(): void {
    // Phase 3A spec keys plus the legacy ApprovalCenter key.
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: ["approval-counts"] });
    queryClient.invalidateQueries({ queryKey: ["pending-quotes"] });
    queryClient.invalidateQueries({ queryKey: ["quote-builder", "approval-case"] });
    queryClient.invalidateQueries({ queryKey: ["sales", "my-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["qrm", "approvals"] });
    queryClient.invalidateQueries({ queryKey: ["crm", "deal"] });
  }

  function handleSubmit(): void {
    decideQuote.mutate(
      {
        approvalCaseId: target.approvalCaseId,
        decision,
        reason: note.trim() || null,
        conditions: conditionsBuilderVisible
          ? conditions.map((condition, index) => ({ ...condition, sortOrder: index }))
          : [],
      },
      {
        onError: (error: unknown) => {
          toast({
            title: "Decision failed",
            description: error instanceof Error ? error.message : "We could not record the decision.",
            variant: "destructive",
          });
        },
        onSuccess: (result) => {
          const autoSend = result?.autoSend;
          if (autoSend?.attempted && !autoSend.sent) {
            toast({
              title: "Quote approved, auto-send did not complete",
              description: autoSend.error ?? "Post-approval auto-send was attempted but did not complete.",
              variant: "destructive",
            });
          } else if (autoSend?.attempted && autoSend.sent) {
            toast({
              title: "Quote approved and auto-sent",
              description: "Post-approval routing auto-delivered the quote to the customer.",
            });
          } else {
            toast({ title: "Decision recorded" });
          }
          invalidateAllApprovalKeys();
          onDecided?.({ decision, autoSent: Boolean(autoSend?.attempted && autoSend.sent) });
          onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Quote Approval Decision</DialogTitle>
          <DialogDescription>
            {target.headline
              ? `Review ${target.headline} and choose the manager action.`
              : "Review the quote and choose the manager action."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Card className="border-border/60 bg-card/60 p-4">
            <p className="text-sm font-medium text-foreground">{target.headline}</p>
            <p className="mt-1 text-xs text-muted-foreground">{target.detail}</p>
          </Card>

          {/* Approval Activity Log — surfaces the rep's submission_note
              and any prior decisions ahead of the action picker. */}
          {liveCase && (
            <ApprovalActivityLog
              approvalCase={liveCase}
              conditions={liveCase.conditions}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-5">
            {DECISION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDecision(option.value)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs font-medium transition",
                  decision === option.value
                    ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                    : "border-border text-muted-foreground hover:border-foreground/20",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Decision note{noteRequired ? " (required)" : ""}
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-[96px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
              placeholder="Explain the decision so the rep and audit trail are clear."
            />
          </label>

          {conditionsBuilderVisible && (
            <Card className="border-border/60 bg-card/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">Structured conditions</p>
                <select
                  className="rounded border border-input bg-card px-2 py-1 text-xs"
                  onChange={(event) => {
                    const nextType = event.target.value as QuoteApprovalConditionDraft["conditionType"];
                    if (!nextType) return;
                    setConditions((current) => [...current, makeConditionDraft(nextType)]);
                    event.currentTarget.value = "";
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Add condition…</option>
                  {QUOTE_CONDITION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              {conditions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No conditions added yet.</p>
              ) : (
                <div className="space-y-3">
                  {conditions.map((condition, index) => (
                    <Card key={`${condition.conditionType}-${index}`} className="border-border/60 bg-background/50 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-foreground">
                          {QUOTE_CONDITION_OPTIONS.find((option) => option.value === condition.conditionType)?.label ?? condition.conditionType}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConditions((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                        >
                          Remove
                        </Button>
                      </div>

                      {condition.conditionType === "min_margin_pct" && (
                        <Input
                          type="number"
                          value={String(condition.conditionPayload.min_margin_pct ?? 0)}
                          onChange={(event) => {
                            const value = Number(event.target.value || 0);
                            setConditions((current) => current.map((row, currentIndex) =>
                              currentIndex === index
                                ? { ...row, conditionPayload: { ...row.conditionPayload, min_margin_pct: value } }
                                : row));
                          }}
                        />
                      )}
                      {condition.conditionType === "max_trade_allowance" && (
                        <Input
                          type="number"
                          value={String(condition.conditionPayload.max_trade_allowance ?? 0)}
                          onChange={(event) => {
                            const value = Number(event.target.value || 0);
                            setConditions((current) => current.map((row, currentIndex) =>
                              currentIndex === index
                                ? { ...row, conditionPayload: { ...row.conditionPayload, max_trade_allowance: value } }
                                : row));
                          }}
                        />
                      )}
                      {condition.conditionType === "required_cash_down" && (
                        <Input
                          type="number"
                          value={String(condition.conditionPayload.required_cash_down ?? 0)}
                          onChange={(event) => {
                            const value = Number(event.target.value || 0);
                            setConditions((current) => current.map((row, currentIndex) =>
                              currentIndex === index
                                ? { ...row, conditionPayload: { ...row.conditionPayload, required_cash_down: value } }
                                : row));
                          }}
                        />
                      )}
                      {condition.conditionType === "required_finance_scenario" && (
                        <Input
                          value={String(condition.conditionPayload.required_finance_scenario ?? "")}
                          onChange={(event) => {
                            const value = event.target.value;
                            setConditions((current) => current.map((row, currentIndex) =>
                              currentIndex === index
                                ? { ...row, conditionPayload: { ...row.conditionPayload, required_finance_scenario: value } }
                                : row));
                          }}
                          placeholder="Finance 48 mo"
                        />
                      )}
                      {condition.conditionType === "remove_attachment" && (
                        <Input
                          value={String(condition.conditionPayload.attachment_title ?? "")}
                          onChange={(event) => {
                            const value = event.target.value;
                            setConditions((current) => current.map((row, currentIndex) =>
                              currentIndex === index
                                ? { ...row, conditionPayload: { ...row.conditionPayload, attachment_title: value } }
                                : row));
                          }}
                          placeholder="Attachment title"
                        />
                      )}
                      {condition.conditionType === "expiry_hours" && (
                        <Input
                          type="number"
                          value={String(condition.conditionPayload.expiry_hours ?? 72)}
                          onChange={(event) => {
                            const value = Number(event.target.value || 0);
                            setConditions((current) => current.map((row, currentIndex) =>
                              currentIndex === index
                                ? { ...row, conditionPayload: { ...row.conditionPayload, expiry_hours: value } }
                                : row));
                          }}
                        />
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onClose()}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitDisabled}
            >
              {decideQuote.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Submit Decision
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
