import type { QuoteApprovalCaseSummary } from "../../../../../../shared/qep-moonshot-contracts";

export interface ResolveApprovalBlockerMessageInput {
  activeQuotePackageId: string | null;
  activeApprovalCaseLoading: boolean;
  bypassApprovedWithoutCase: boolean;
  activeApprovalCase: QuoteApprovalCaseSummary | null;
}

export function resolveApprovalBlockerMessage({
  activeQuotePackageId,
  activeApprovalCaseLoading,
  bypassApprovedWithoutCase,
  activeApprovalCase,
}: ResolveApprovalBlockerMessageInput): string | null {
  if (!activeQuotePackageId) return "Save the quote package before generating customer-facing documents.";
  if (activeApprovalCaseLoading) return "Checking the approval case before customer-facing actions unlock.";
  if (bypassApprovedWithoutCase) return null;
  if (!activeApprovalCase) {
    return "Submit this quote for owner approval before generating or sending customer-facing material.";
  }
  if (activeApprovalCase.canSend) return null;
  if (activeApprovalCase.status === "pending" || activeApprovalCase.status === "escalated") {
    return activeApprovalCase.assignedToName
      ? `Waiting on ${activeApprovalCase.assignedToName} to approve this quote.`
      : "Approval is still pending in Approval Center.";
  }
  if (activeApprovalCase.status === "changes_requested") {
    return "Approval requested changes. Revise and resubmit before sending.";
  }
  if (activeApprovalCase.status === "rejected") {
    return "Approval rejected this quote. It cannot be sent until revised and approved.";
  }
  if (activeApprovalCase.status === "approved_with_conditions") {
    const unmet = activeApprovalCase.evaluations
      .filter((evaluation) => !evaluation.satisfied)
      .map((evaluation) => evaluation.label);
    return unmet.length > 0
      ? `Approval has unmet conditions: ${unmet.join(", ")}.`
      : "Conditional approval is not clean yet. Recheck the approval case before sending.";
  }
  return "Approval is not clean. Ryan/Rylee approval-case canSend must be true before customer-facing actions.";
}
