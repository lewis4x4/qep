import { describe, expect, test } from "bun:test";

import {
  computeReviewApprovalSubmissionState,
  computeReviewSendGate,
} from "../review-gates";

describe("computeReviewSendGate", () => {
  test("requires both approval case sendability and packet readiness", () => {
    expect(computeReviewSendGate({
      approvalCaseCanSend: true,
      sendReadiness: { ready: true, missing: [] },
    })).toEqual({ ready: true, missing: [] });

    expect(computeReviewSendGate({
      approvalCaseCanSend: false,
      sendReadiness: { ready: true, missing: [] },
    })).toEqual({ ready: false, missing: ["clean owner approval"] });

    expect(computeReviewSendGate({
      approvalCaseCanSend: true,
      sendReadiness: { ready: false, missing: ["generated PDF"] },
    })).toEqual({ ready: false, missing: ["generated PDF"] });
  });
});

describe("computeReviewApprovalSubmissionState", () => {
  test("fails closed while the configured margin floor policy is unresolved", () => {
    expect(computeReviewApprovalSubmissionState({
      canSubmitForApproval: true,
      submitApprovalPending: false,
      marginFloorResolved: false,
      requiresManagerApproval: false,
      approvalGranted: false,
      trimmedNoteLength: 0,
    })).toEqual({
      requiresJustification: false,
      marginFloorPolicyBlocked: true,
      justificationMissing: false,
      submitDisabled: true,
    });
  });

  test("requires a note only after a resolved floor says manager approval is needed", () => {
    expect(computeReviewApprovalSubmissionState({
      canSubmitForApproval: true,
      submitApprovalPending: false,
      marginFloorResolved: true,
      requiresManagerApproval: true,
      approvalGranted: false,
      trimmedNoteLength: 0,
    }).submitDisabled).toBe(true);

    expect(computeReviewApprovalSubmissionState({
      canSubmitForApproval: true,
      submitApprovalPending: false,
      marginFloorResolved: true,
      requiresManagerApproval: true,
      approvalGranted: false,
      trimmedNoteLength: 12,
    }).submitDisabled).toBe(false);
  });
});
