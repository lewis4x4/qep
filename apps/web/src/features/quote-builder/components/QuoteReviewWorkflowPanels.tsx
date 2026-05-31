import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ShieldCheck } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

import { IncentiveStack } from "./IncentiveStack";
import { SendQuoteSection, type SendQuoteSectionResult } from "./SendQuoteSection";
import { QuotePdfVersionHistoryPanel } from "./QuotePdfVersionHistoryPanel";
import { ApprovalActivityLog } from "./ApprovalActivityLog";
// Phase 3A: inline manager decision dialog. Mounted only when the
// current viewer is a manager/owner/admin AND the case is still pending
// AND the viewer didn't submit the case themselves.
import { QuoteApprovalDecisionDialog } from "@/features/qrm/command-center/components/QuoteApprovalDecisionDialog";
// WAVE polish:
//   Slice 2 — dictation on dealer response + revision summary.
//   Slice 4 — surface the approval-case detail in a MobileBottomSheet
//   on phone viewports so reps can drill in without losing the parent
//   review chrome.
import { MobileBottomSheet } from "@/features/sales/components/MobileBottomSheet";
import { MobileVoiceTextarea } from "@/features/sales/components/MobileVoiceTextarea";
import { useIsMobileViewport } from "@/features/sales/hooks/useIsMobileViewport";
import {
  buildPortalRevisionQuoteData,
  getPortalRevision,
  getQuoteApprovalCase,
  publishPortalRevision,
  returnPortalRevisionToDraft,
  savePortalRevisionDraft,
  submitPortalRevision,
} from "../lib/quote-api";
import { firstMutationErrorMessage } from "../lib/quote-review-workflow-normalizers";
import type {
  QuoteAutoSendResult,
  QuoteFinanceScenario,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

interface QuoteReviewWorkflowPanelsProps {
  quotePackageId: string;
  draft: QuoteWorkspaceDraft;
  financeScenarios: QuoteFinanceScenario[];
  leaseQuotingEnabled: boolean;
  computed: {
    subtotal: number;
    discountTotal: number;
    netTotal: number;
    taxTotal: number;
    customerTotal: number;
    cashDown: number;
    amountFinanced: number;
  };
  sendReadiness: {
    ready: boolean;
    missing: string[];
  };
  requiresManagerApproval: boolean;
  userRole: string | null;
  submitApprovalResult?: {
    assignedToName?: string | null;
    branchName?: string | null;
    autoSend?: QuoteAutoSendResult | null;
  };
  quoteStatus: QuoteWorkspaceDraft["quoteStatus"];
  onQuoteStatusChange: (status: QuoteWorkspaceDraft["quoteStatus"]) => void;
  showSendSection?: boolean;
  onSendQuote?: () => Promise<SendQuoteSectionResult>;
  /**
   * Phase 3B quote-approval feedback loop — viewer id passed by the
   * orchestrator. Used for the submitter-only "Withdraw submission"
   * affordance. Falls back to the in-component `useAuth().profile.id`
   * when omitted so callers that don't yet thread the prop keep working.
   */
  currentUserId?: string | null;
  onWithdrawApproval?: (input: { approvalCaseId: string; reason?: string | null }) => void;
  withdrawApprovalPending?: boolean;
}

export function QuoteReviewWorkflowPanels({
  quotePackageId,
  draft,
  financeScenarios,
  leaseQuotingEnabled,
  computed,
  sendReadiness,
  requiresManagerApproval,
  userRole,
  submitApprovalResult,
  quoteStatus,
  onQuoteStatusChange,
  showSendSection = true,
  onSendQuote,
  currentUserId,
  onWithdrawApproval,
  withdrawApprovalPending,
}: QuoteReviewWorkflowPanelsProps) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [dealerMessage, setDealerMessage] = useState("");
  const [revisionSummary, setRevisionSummary] = useState("");
  // WAVE polish (Slice 4): controlled state for the per-approval
  // MobileBottomSheet. On phone the Approval Case card is a tap-able
  // summary; the full evaluation checklist + decision note open here.
  const [approvalSheetOpen, setApprovalSheetOpen] = useState(false);
  // Phase 3A: opens the manager decision dialog inline so deep-linked
  // managers can decide without bouncing back to ApprovalCenter.
  const [decideDialogOpen, setDecideDialogOpen] = useState(false);
  // Phase 3B quote-approval feedback loop — withdraw confirmation
  // dialog. Mounted only when the viewer is the rep who submitted the
  // case AND the case is still pending/escalated AND the manager hasn't
  // recorded a decision yet. Keeps the textarea state outside the gate
  // so reopening the dialog after a Cancel preserves what they typed.
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const isMobileViewport = useIsMobileViewport();

  const portalRevisionQuery = useQuery({
    queryKey: ["quote-builder", "portal-revision", draft.dealId],
    queryFn: () => getPortalRevision(draft.dealId!),
    enabled: Boolean(quotePackageId && draft.dealId),
    staleTime: 5_000,
  });

  const activeApprovalCaseQuery = useQuery({
    queryKey: ["quote-builder", "approval-case", quotePackageId],
    queryFn: () => getQuoteApprovalCase(quotePackageId),
    enabled: Boolean(quotePackageId),
    staleTime: 5_000,
  });
  const activeApprovalCase = activeApprovalCaseQuery.data ?? null;

  // Phase 3A: viewer-can-decide gate. Requires elevated role, an active
  // case that is still pending/escalated, and a viewer who is NOT the
  // rep who submitted the case (managers can act on others' submissions
  // but never their own — that's the existing ApprovalCenter rule).
  // Prefer the caller-supplied currentUserId (orchestrator wires this
  // for consistency with withdraw logic) and fall back to useAuth so
  // callers that haven't threaded the prop still gate correctly.
  const viewerRole = (userRole ?? profile?.role ?? null) as string | null;
  const viewerId = currentUserId ?? profile?.id ?? null;
  const viewerCanDecide = Boolean(
    activeApprovalCase
    && (activeApprovalCase.status === "pending" || activeApprovalCase.status === "escalated")
    && (viewerRole === "manager" || viewerRole === "owner" || viewerRole === "admin")
    && viewerId
    && activeApprovalCase.submittedBy !== viewerId,
  );
  // Phase 3B quote-approval feedback loop — viewer-can-withdraw gate.
  // Mirrors the server-side authz in withdraw-approval-case: only the
  // submitter, only before a manager decision, only while the case is
  // still routable. The handler prop is required — if the caller hasn't
  // wired it the affordance stays hidden.
  const viewerCanWithdraw = Boolean(
    activeApprovalCase
    && (activeApprovalCase.status === "pending" || activeApprovalCase.status === "escalated")
    && activeApprovalCase.decidedAt == null
    && viewerId
    && activeApprovalCase.submittedBy === viewerId
    && typeof onWithdrawApproval === "function",
  );

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

  const resolvedQuoteStatus = activeApprovalCase?.status === "pending" || activeApprovalCase?.status === "escalated"
    ? "pending_approval"
    : activeApprovalCase?.status === "approved_with_conditions"
      ? "approved_with_conditions"
      : activeApprovalCase?.status === "changes_requested"
        ? "changes_requested"
        : activeApprovalCase?.status === "approved"
          ? "approved"
          : activeApprovalCase?.status === "rejected"
            ? "rejected"
            : quoteStatus;

  useEffect(() => {
    if (resolvedQuoteStatus !== quoteStatus) {
      onQuoteStatusChange(resolvedQuoteStatus);
    }
  }, [onQuoteStatusChange, quoteStatus, resolvedQuoteStatus]);

  const approvalPending = resolvedQuoteStatus === "pending_approval";
  const approvalGranted =
    resolvedQuoteStatus === "approved"
    || resolvedQuoteStatus === "approved_with_conditions"
    || resolvedQuoteStatus === "sent"
    || resolvedQuoteStatus === "accepted";
  // QEP rule: every quote must be approved before the salesman can
  // distribute (email / share link / PDF). The branch-local
  // sendReadiness fallback is no longer acceptable — an approval case
  // must exist and canSend must be true. This is the single source of
  // truth for "is the quote green-lit".
  const canShowSendSection =
    showSendSection
    && Boolean(quotePackageId)
    && Boolean(activeApprovalCase?.canSend)
    && resolvedQuoteStatus !== "sent"
    && resolvedQuoteStatus !== "accepted";
  void sendReadiness; // fallback removed; retained in props for back-compat

  const revisionDraftMutation = useMutation({
    mutationFn: async () => {
      if (!draft.dealId) throw new Error("Save the quote before drafting a portal revision.");
      return savePortalRevisionDraft({
        deal_id: draft.dealId,
        quote_package_id: quotePackageId,
        quote_data: buildPortalRevisionQuoteData(
          draft,
          computed,
          financeScenarios,
          dealerMessage,
          revisionSummary,
          {
            includeLeaseScenarios: leaseQuotingEnabled,
            showFinanceComparisonOnCustomerCopy: draft.showFinanceComparisonOnCustomerCopy !== false,
          },
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

  const canPublish = ["admin", "manager", "owner"].includes(userRole ?? "");
  const portalRevision = portalRevisionQuery.data;
  const compareSnapshot = portalRevision?.draft?.compareSnapshot;
  const publicationStatus = portalRevision?.publishState?.publicationStatus ?? "none";
  const assignedToName = activeApprovalCase?.assignedToName ?? submitApprovalResult?.assignedToName;
  const branchName = activeApprovalCase?.branchName ?? submitApprovalResult?.branchName;
  const revisionActionError = firstMutationErrorMessage(
    [
      revisionDraftMutation.error,
      revisionSubmitMutation.error,
      revisionReturnMutation.error,
      revisionPublishMutation.error,
    ],
    "Portal revision action failed",
  );

  return (
    <>
      <IncentiveStack quotePackageId={quotePackageId} />

      {activeApprovalCase && (() => {
        const approver = activeApprovalCase.assignedToName ?? activeApprovalCase.assignedRole ?? "Unassigned";
        const route = String(activeApprovalCase.routeMode).replace(/_/g, " ");
        const statusLabel = String(activeApprovalCase.status).replace(/_/g, " ");
        const decisionNote = activeApprovalCase.decisionNote ?? "No decision note recorded yet.";
        // Phase 1 quote-approval feedback loop: surface the rep's
        // submission justification (captured at submit time) above the
        // manager's decision note so approvers always see rep context.
        const submissionNote = activeApprovalCase.submissionNote?.trim();
        const hasSubmissionNote = Boolean(submissionNote && submissionNote.length > 0);
        const openEvaluations = activeApprovalCase.evaluations.filter((e) => !e.satisfied).length;
        const versionLine = activeApprovalCase.versionNumber != null
          ? `Quote version v${activeApprovalCase.versionNumber}`
          : "Version snapshot attached";
        const branchSuffix = activeApprovalCase.branchName ? ` · ${activeApprovalCase.branchName}` : "";

        const detailBody = (
          <div className="space-y-3" data-testid="approval-case-detail">
            {hasSubmissionNote && (
              <div
                className="rounded-lg border border-border/60 bg-background/60 p-3"
                data-testid="approval-case-submission-note"
              >
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Rep&apos;s note</p>
                <p className="mt-2 text-sm text-muted-foreground">{submissionNote}</p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Assigned approver</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{approver}</p>
                <p className="mt-1 text-xs text-muted-foreground">Route: {route}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Decision note</p>
                <p className="mt-2 text-sm text-foreground">{decisionNote}</p>
              </div>
            </div>

            {activeApprovalCase.evaluations.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Condition checklist</p>
                <div className="mt-3 space-y-2">
                  {activeApprovalCase.evaluations.map((evaluation) => (
                    <div key={evaluation.id} className="rounded border border-border/60 bg-card/50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">{evaluation.label}</p>
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                          evaluation.satisfied
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-amber-500/10 text-amber-300",
                        )}>
                          {evaluation.satisfied ? "met" : "open"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{evaluation.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Phase 2B Approval Activity Log: full chronological story
                of submit → route → decide → auto-send. Sits below the
                rep-facing condition checklist so the action items are
                top-of-card and the audit story sits one beat below. */}
            <ApprovalActivityLog
              approvalCase={activeApprovalCase}
              conditions={activeApprovalCase.conditions}
              autoSend={submitApprovalResult?.autoSend ?? null}
            />
          </div>
        );

        if (isMobileViewport) {
          return (
            <>
              {/* WAVE polish (Slice 4): tap-to-drill approval summary card. */}
              <Card
                className="border-border/60 bg-card/60 p-4"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={approvalSheetOpen}
                onClick={() => setApprovalSheetOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setApprovalSheetOpen(true);
                  }
                }}
                data-testid="approval-case-summary"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Approval Case</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {approver} · {versionLine}{branchSuffix}
                    </p>
                  </div>
                  <span className="rounded-full bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-qep-orange shrink-0">
                    {statusLabel}
                  </span>
                </div>
                {openEvaluations > 0 && (
                  <p className="mt-2 text-[11px] text-amber-300">
                    {openEvaluations} condition{openEvaluations === 1 ? "" : "s"} open — tap for detail.
                  </p>
                )}
                {(viewerCanDecide || viewerCanWithdraw) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {viewerCanDecide && (
                      <Button
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDecideDialogOpen(true);
                        }}
                        className="bg-qep-orange text-white hover:bg-qep-orange/90"
                        data-testid="approval-case-decide-now-mobile"
                      >
                        <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                        Decide Now
                      </Button>
                    )}
                    {viewerCanWithdraw && (
                      // Phase 3B: muted secondary text button so the
                      // primary CTAs (Decide Now / Submit) keep visual
                      // priority. Stop propagation so tapping it doesn't
                      // also open the summary sheet.
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setWithdrawReason("");
                          setWithdrawDialogOpen(true);
                        }}
                        disabled={withdrawApprovalPending === true}
                        className="text-[11.5px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                        data-testid="approval-case-withdraw-mobile"
                      >
                        Withdraw submission
                      </button>
                    )}
                  </div>
                )}
              </Card>

              <MobileBottomSheet
                open={approvalSheetOpen}
                onOpenChange={setApprovalSheetOpen}
                title={`Approval Case — ${statusLabel}`}
                description={`${approver} · ${versionLine}${branchSuffix}`}
                size="tall"
              >
                {detailBody}
              </MobileBottomSheet>
            </>
          );
        }

        return (
          <Card className="border-border/60 bg-card/60 p-4 space-y-3" data-testid="approval-case-desktop">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Approval Case</p>
                <p className="text-xs text-muted-foreground">{versionLine}{branchSuffix}</p>
              </div>
              <div className="flex items-center gap-2">
                {viewerCanDecide && (
                  <Button
                    size="sm"
                    onClick={() => setDecideDialogOpen(true)}
                    className="bg-qep-orange text-white hover:bg-qep-orange/90"
                    data-testid="approval-case-decide-now"
                  >
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    Decide Now
                  </Button>
                )}
                {viewerCanWithdraw && (
                  // Phase 3B: muted secondary "Withdraw" link in the
                  // corner of the approval card. Kept text-only so it
                  // doesn't compete with primary actions.
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawReason("");
                      setWithdrawDialogOpen(true);
                    }}
                    disabled={withdrawApprovalPending === true}
                    className="text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                    data-testid="approval-case-withdraw"
                  >
                    Withdraw submission
                  </button>
                )}
                <span className="rounded-full bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-qep-orange">
                  {statusLabel}
                </span>
              </div>
            </div>
            {detailBody}
          </Card>
        );
      })()}

      {/* Phase 3A: inline manager decision. Mounted at the panel root
          so both mobile (sheet) and desktop trigger paths share the
          same dialog instance. */}
      {viewerCanDecide && activeApprovalCase && (
        <QuoteApprovalDecisionDialog
          open={decideDialogOpen}
          onClose={() => setDecideDialogOpen(false)}
          approvalCase={activeApprovalCase}
          onDecided={() => {
            void queryClient.invalidateQueries({ queryKey: ["quote-builder", "approval-case", quotePackageId] });
          }}
        />
      )}

      {/* Phase 3B quote-approval feedback loop — withdraw confirmation. */}
      {viewerCanWithdraw && activeApprovalCase && (
        <Dialog
          open={withdrawDialogOpen}
          onOpenChange={(open) => {
            if (!open) setWithdrawReason("");
            setWithdrawDialogOpen(open);
          }}
        >
          <DialogContent className="max-w-md" data-testid="approval-case-withdraw-dialog">
            <DialogHeader>
              <DialogTitle>Withdraw this approval submission?</DialogTitle>
              <DialogDescription>
                The quote will return to draft and the manager will no longer see it. You can edit anything you need and submit it again.
              </DialogDescription>
            </DialogHeader>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Reason (optional)</span>
              <textarea
                value={withdrawReason}
                onChange={(event) => setWithdrawReason(event.target.value.slice(0, 1000))}
                rows={3}
                className="w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
                placeholder="What changed? Helps the audit log explain why this case closed without a manager decision."
                data-testid="approval-case-withdraw-reason"
              />
            </label>
            <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setWithdrawDialogOpen(false)}
                disabled={withdrawApprovalPending === true}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!onWithdrawApproval) return;
                  onWithdrawApproval({
                    approvalCaseId: activeApprovalCase.id,
                    reason: withdrawReason.trim() || null,
                  });
                  setWithdrawDialogOpen(false);
                  setWithdrawReason("");
                }}
                disabled={withdrawApprovalPending === true}
                data-testid="approval-case-withdraw-confirm"
              >
                {withdrawApprovalPending === true ? "Withdrawing…" : "Withdraw submission"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {submitApprovalResult?.autoSend?.attempted && (
        <Card className={cn(
          "p-4",
          submitApprovalResult.autoSend.sent
            ? "border-emerald-500/20 bg-emerald-500/5"
            : "border-amber-500/20 bg-amber-500/5",
        )}>
          <p className={cn(
            "text-sm font-medium",
            submitApprovalResult.autoSend.sent ? "text-emerald-300" : "text-amber-300",
          )}>
            Post-approval auto-send
          </p>
          <p className={cn(
            "mt-1 text-xs",
            submitApprovalResult.autoSend.sent ? "text-emerald-200" : "text-amber-200",
          )}>
            {submitApprovalResult.autoSend.sent
              ? "Quote auto-send completed after approval."
              : `Auto-send attempted but did not complete${submitApprovalResult.autoSend.error ? `: ${submitApprovalResult.autoSend.error}` : "."}`}
          </p>
        </Card>
      )}

      {showSendSection && (canShowSendSection ? (
        <SendQuoteSection
          quotePackageId={quotePackageId}
          contactName={draft.customerName || draft.customerCompany || "customer"}
          onSendQuote={onSendQuote}
          onSent={() => {
            onQuoteStatusChange("sent");
            void queryClient.invalidateQueries({ queryKey: ["quote-builder", "quote-pdf-versions", quotePackageId] });
          }}
        />
      ) : resolvedQuoteStatus === "sent" || resolvedQuoteStatus === "accepted" ? (
        <Card className="border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-sm font-medium text-emerald-400">
            {resolvedQuoteStatus === "accepted" ? "Quote accepted" : "Quote already sent"}
          </p>
        </Card>
      ) : approvalPending ? (
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-400">Approval requested</p>
          <p className="mt-1 text-xs text-amber-300">
            {assignedToName
              ? `This quote is waiting on ${assignedToName} in Approval Center.`
              : branchName
                ? `This quote is waiting in the ${branchName} approval queue.`
                : "This quote is waiting in Approval Center for sales manager review."}
          </p>
        </Card>
      ) : !approvalGranted ? (
        // QEP workflow: every quote must be owner-approved before it
        // can be sent. If the approval case hasn't been created yet,
        // point the rep at Submit for Approval. If there's a send-
        // readiness gap (missing fields) surface those too so they
        // don't submit against an incomplete packet.
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-400">
            Awaiting owner approval before send
          </p>
          <p className="mt-1 text-xs text-amber-300">
            {draft.branchSlug
              ? "Click Submit for Approval to route this quote to Ryan + Rylee. Once approved, Download PDF and Send unlock."
              : "Select a quoting branch, then Submit for Approval routes this quote to Ryan + Rylee."}
          </p>
          {sendReadiness.missing.length > 0 && (
            <p className="mt-1 text-xs text-amber-300">
              Still missing: {sendReadiness.missing.join(", ")}
            </p>
          )}
        </Card>
      ) : sendReadiness.missing.length > 0 ? (
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-400">Approved — packet incomplete before send</p>
          <p className="mt-1 text-xs text-amber-300">
            Missing: {sendReadiness.missing.join(", ")}
          </p>
        </Card>
      ) : null)}

      {quotePackageId && (
        <QuotePdfVersionHistoryPanel quotePackageId={quotePackageId} />
      )}

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
            <MobileVoiceTextarea
              value={dealerMessage}
              onChange={(event) => setDealerMessage(event.target.value)}
              className="min-h-[90px] w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
              placeholder="Explain what changed and what the customer should notice in the revised proposal."
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Revision summary</span>
            <MobileVoiceTextarea
              value={revisionSummary}
              onChange={(event) => setRevisionSummary(event.target.value)}
              className="min-h-[90px] w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
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

          {revisionActionError && (
            <p className="text-xs text-red-400">
              {revisionActionError}
            </p>
          )}
        </Card>
      )}

    </>
  );
}
