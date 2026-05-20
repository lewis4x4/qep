import type { QuoteAutoSendResult } from "../../../shared/qep-moonshot-contracts.ts";

export type RepApprovalAutoSendStatus =
  | "sent"
  | "failed"
  | "return_to_rep"
  | "not_applicable";

export interface RepApprovalDecisionCopyInput {
  decision: string;
  quoteNumber: string | null;
  managerName: string | null;
  note: string | null;
  nextRole: string | null;
  autoSendResult?: QuoteAutoSendResult | null;
}

export interface RepApprovalDecisionMetadataInput {
  quotePackageId: string;
  approvalCaseId: string;
  decision: string;
  decisionNote: string | null;
  conditions: ReadonlyArray<unknown>;
  deepLinkPath: string;
  autoSendResult?: QuoteAutoSendResult | null;
}

export interface RepApprovalDecisionAutoSendMetadata {
  status: RepApprovalAutoSendStatus;
  attempted: boolean;
  sent: boolean;
  reason?: string | null;
  failure_code?: string | null;
  delivery_event_id?: string | null;
  public_url?: string | null;
  pdf_version_number?: number | null;
  document_artifact_id?: string | null;
}

export function deriveRepApprovalAutoSendStatus(input: {
  decision: string;
  autoSendResult?: QuoteAutoSendResult | null;
}): RepApprovalAutoSendStatus {
  if (!isApprovedDecision(input.decision)) return "not_applicable";
  const result = input.autoSendResult;
  if (result?.sent === true) return "sent";
  if (!result || result.reason === "post_approval_action_return_to_rep") {
    return "return_to_rep";
  }
  return "failed";
}

export function buildRepApprovalDecisionCopy(
  input: RepApprovalDecisionCopyInput,
): { title: string; subject: string; body: string } {
  const quoteLabel = input.quoteNumber ? `quote #${input.quoteNumber}` : "your quote";
  const quoteLabelSentenceCase = input.quoteNumber
    ? `Quote #${input.quoteNumber}`
    : "Your quote";
  const manager = input.managerName?.trim() || "your manager";
  const note = input.note?.trim() || "(no note provided)";
  const nextRole = input.nextRole?.trim() || "the next approver";
  const autoSendStatus = deriveRepApprovalAutoSendStatus({
    decision: input.decision,
    autoSendResult: input.autoSendResult,
  });

  switch (input.decision) {
    case "approved": {
      if (autoSendStatus === "sent") {
        const title = "Quote approved and sent";
        return {
          title,
          subject: title,
          body: `${quoteLabelSentenceCase} was approved by ${manager} and automatically sent to the customer.`,
        };
      }
      if (autoSendStatus === "failed") {
        const title = "Quote approved — auto-send needs attention";
        return {
          title,
          subject: title,
          body: `${quoteLabelSentenceCase} was approved by ${manager}, but automatic sending did not complete. Open the quote to send it or resolve blockers.`,
        };
      }
      const title = "Quote approved";
      return {
        title,
        subject: title,
        body: `${quoteLabelSentenceCase} was approved by ${manager}. Ready to send to the customer.`,
      };
    }
    case "approved_with_conditions": {
      if (autoSendStatus === "sent") {
        const title = "Quote approved with conditions and sent";
        return {
          title,
          subject: title,
          body: `${quoteLabelSentenceCase} was approved with conditions and automatically sent to the customer. Tap to review the conditions.`,
        };
      }
      if (autoSendStatus === "failed") {
        const title = "Quote approved with conditions — auto-send needs attention";
        return {
          title,
          subject: title,
          body: `${quoteLabelSentenceCase} was approved with conditions, but automatic sending did not complete. Open the quote to review conditions and send it.`,
        };
      }
      const title = "Quote approved with conditions";
      return {
        title,
        subject: title,
        body: `${quoteLabelSentenceCase} was approved with conditions. Tap to review.`,
      };
    }
    case "changes_requested": {
      const title = "Changes requested";
      return {
        title,
        subject: title,
        body: `${manager} requested changes on ${quoteLabel}. Note: ${note}`,
      };
    }
    case "rejected": {
      const title = "Quote rejected";
      return {
        title,
        subject: title,
        body: `${quoteLabelSentenceCase} was rejected. Note: ${note}`,
      };
    }
    case "escalated": {
      const title = "Quote escalated";
      return {
        title,
        subject: title,
        body: `${quoteLabelSentenceCase} was escalated to ${nextRole}.`,
      };
    }
    default: {
      const title = "Quote update";
      return {
        title,
        subject: title,
        body: `There is an update on ${quoteLabel}.`,
      };
    }
  }
}

export function buildRepApprovalDecisionMetadata(
  input: RepApprovalDecisionMetadataInput,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    quote_package_id: input.quotePackageId,
    approval_case_id: input.approvalCaseId,
    decision: input.decision,
    decision_note: input.decisionNote ?? null,
    conditions: input.conditions ?? [],
    deep_link: input.deepLinkPath,
  };

  if (isApprovedDecision(input.decision)) {
    metadata.auto_send = buildAutoSendMetadata(input.decision, input.autoSendResult ?? null);
  }

  return metadata;
}

function buildAutoSendMetadata(
  decision: string,
  result: QuoteAutoSendResult | null,
): RepApprovalDecisionAutoSendMetadata {
  const status = deriveRepApprovalAutoSendStatus({ decision, autoSendResult: result });
  const metadata: RepApprovalDecisionAutoSendMetadata = {
    status,
    attempted: result?.attempted === true,
    sent: result?.sent === true,
  };

  if (result?.reason) metadata.reason = result.reason;
  const failureCode = status === "failed" ? buildFailureCode(result) : null;
  if (failureCode) metadata.failure_code = failureCode;
  if (result?.deliveryEventId) metadata.delivery_event_id = result.deliveryEventId;
  if (result?.publicUrl) metadata.public_url = result.publicUrl;
  if (typeof result?.pdfVersionNumber === "number") {
    metadata.pdf_version_number = result.pdfVersionNumber;
  }
  if (result?.documentArtifactId) metadata.document_artifact_id = result.documentArtifactId;

  return metadata;
}

function buildFailureCode(result: QuoteAutoSendResult | null): string | null {
  if (!result) return null;
  if (result.sent) return null;
  if (result.error) return "auto_send_error";
  return sanitizeFailureCode(result.reason ?? null);
}

function sanitizeFailureCode(value: string | null): string | null {
  if (!value) return null;
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").slice(0, 80);
  return sanitized || null;
}

function isApprovedDecision(decision: string): boolean {
  return decision === "approved" || decision === "approved_with_conditions";
}
