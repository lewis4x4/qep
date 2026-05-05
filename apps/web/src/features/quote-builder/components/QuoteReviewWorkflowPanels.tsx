import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { IncentiveStack } from "./IncentiveStack";
import { SendQuoteSection } from "./SendQuoteSection";
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
  QuoteFinanceScenario,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

interface QuoteReviewWorkflowPanelsProps {
  quotePackageId: string;
  draft: QuoteWorkspaceDraft;
  financeScenarios: QuoteFinanceScenario[];
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
  };
  quoteStatus: QuoteWorkspaceDraft["quoteStatus"];
  onQuoteStatusChange: (status: QuoteWorkspaceDraft["quoteStatus"]) => void;
  showSendSection?: boolean;
}

export function QuoteReviewWorkflowPanels({
  quotePackageId,
  draft,
  financeScenarios,
  computed,
  sendReadiness,
  requiresManagerApproval,
  userRole,
  submitApprovalResult,
  quoteStatus,
  onQuoteStatusChange,
  showSendSection = true,
}: QuoteReviewWorkflowPanelsProps) {
  const queryClient = useQueryClient();
  const [dealerMessage, setDealerMessage] = useState("");
  const [revisionSummary, setRevisionSummary] = useState("");

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

      {activeApprovalCase && (
        <Card className="border-border/60 bg-card/60 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Approval Case</p>
              <p className="text-xs text-muted-foreground">
                {activeApprovalCase.versionNumber != null
                  ? `Quote version v${activeApprovalCase.versionNumber}`
                  : "Version snapshot attached"}
                {activeApprovalCase.branchName ? ` · ${activeApprovalCase.branchName}` : ""}
              </p>
            </div>
            <span className="rounded-full bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-qep-orange">
              {String(activeApprovalCase.status).replace(/_/g, " ")}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Assigned approver</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {activeApprovalCase.assignedToName ?? activeApprovalCase.assignedRole ?? "Unassigned"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Route: {String(activeApprovalCase.routeMode).replace(/_/g, " ")}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Decision note</p>
              <p className="mt-2 text-sm text-foreground">
                {activeApprovalCase.decisionNote ?? "No decision note recorded yet."}
              </p>
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
        </Card>
      )}

      {showSendSection && (canShowSendSection ? (
        <SendQuoteSection
          quotePackageId={quotePackageId}
          contactName={draft.customerName || draft.customerCompany || "customer"}
          onSent={() => {
            onQuoteStatusChange("sent");
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
