export interface ReviewSendGateInput {
  approvalCaseCanSend: boolean;
  sendReadiness: { ready: boolean; missing: string[] };
}

export function computeReviewSendGate(input: ReviewSendGateInput): { ready: boolean; missing: string[] } {
  return {
    ready: input.approvalCaseCanSend && input.sendReadiness.ready,
    missing: [
      ...new Set([
        ...input.sendReadiness.missing,
        ...(input.approvalCaseCanSend ? [] : ["clean owner approval"]),
      ]),
    ],
  };
}

export interface ReviewApprovalSubmissionStateInput {
  canSubmitForApproval: boolean;
  submitApprovalPending: boolean;
  marginFloorResolved: boolean;
  requiresManagerApproval: boolean;
  approvalGranted: boolean;
  trimmedNoteLength: number;
}

export function computeReviewApprovalSubmissionState(input: ReviewApprovalSubmissionStateInput): {
  requiresJustification: boolean;
  marginFloorPolicyBlocked: boolean;
  justificationMissing: boolean;
  submitDisabled: boolean;
} {
  const requiresJustification = input.marginFloorResolved && input.requiresManagerApproval && !input.approvalGranted;
  const marginFloorPolicyBlocked = !input.marginFloorResolved;
  const justificationMissing = requiresJustification && input.trimmedNoteLength === 0;
  return {
    requiresJustification,
    marginFloorPolicyBlocked,
    justificationMissing,
    submitDisabled:
      !input.canSubmitForApproval
      || input.submitApprovalPending
      || marginFloorPolicyBlocked
      || justificationMissing,
  };
}
