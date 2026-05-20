import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildRepApprovalDecisionCopy,
  buildRepApprovalDecisionMetadata,
  deriveRepApprovalAutoSendStatus,
} from "./quote-approval-notifications.ts";

Deno.test("approved auto-sent decision copy and metadata identify customer delivery", () => {
  const copy = buildRepApprovalDecisionCopy({
    decision: "approved",
    quoteNumber: "QB-1001",
    managerName: "Morgan Manager",
    note: null,
    nextRole: null,
    autoSendResult: {
      attempted: true,
      sent: true,
      deliveryEventId: "delivery-1",
      publicUrl: "https://quotes.example/q/abc",
      pdfVersionNumber: 3,
      documentArtifactId: "artifact-1",
    },
  });

  assertEquals(copy.title, "Quote approved and sent");
  assert(copy.body.includes("automatically sent to the customer"));

  const metadata = buildRepApprovalDecisionMetadata({
    quotePackageId: "quote-1",
    approvalCaseId: "case-1",
    decision: "approved",
    decisionNote: null,
    conditions: [],
    deepLinkPath: "/sales/quotes/quote-1",
    autoSendResult: {
      attempted: true,
      sent: true,
      deliveryEventId: "delivery-1",
      publicUrl: "https://quotes.example/q/abc",
      pdfVersionNumber: 3,
      documentArtifactId: "artifact-1",
    },
  });

  assertEquals(metadata.deep_link, "/sales/quotes/quote-1");
  assertEquals(metadata.auto_send, {
    status: "sent",
    attempted: true,
    sent: true,
    delivery_event_id: "delivery-1",
    public_url: "https://quotes.example/q/abc",
    pdf_version_number: 3,
    document_artifact_id: "artifact-1",
  });
});

Deno.test("approved auto-send incomplete copy avoids over-claiming delivery", () => {
  const copy = buildRepApprovalDecisionCopy({
    decision: "approved",
    quoteNumber: "QB-1002",
    managerName: "Morgan Manager",
    note: null,
    nextRole: null,
    autoSendResult: {
      attempted: true,
      sent: false,
      reason: "auto_send_requires_versioned_pdf_generation",
    },
  });

  assertEquals(copy.title, "Quote approved — auto-send needs attention");
  assert(copy.body.includes("automatic sending did not complete"));
  assertEquals(
    deriveRepApprovalAutoSendStatus({
      decision: "approved",
      autoSendResult: {
        attempted: true,
        sent: false,
        reason: "auto_send_requires_versioned_pdf_generation",
      },
    }),
    "failed",
  );
});

Deno.test("approved return-to-rep copy preserves ready-to-send path", () => {
  const copy = buildRepApprovalDecisionCopy({
    decision: "approved",
    quoteNumber: "QB-1003",
    managerName: "Morgan Manager",
    note: null,
    nextRole: null,
    autoSendResult: {
      attempted: false,
      sent: false,
      reason: "post_approval_action_return_to_rep",
    },
  });

  assertEquals(copy.title, "Quote approved");
  assert(copy.body.includes("Ready to send to the customer"));
  assertEquals(
    deriveRepApprovalAutoSendStatus({
      decision: "approved",
      autoSendResult: { attempted: false, sent: false, reason: "post_approval_action_return_to_rep" },
    }),
    "return_to_rep",
  );

  const metadata = buildRepApprovalDecisionMetadata({
    quotePackageId: "quote-rtp",
    approvalCaseId: "case-rtp",
    decision: "approved",
    decisionNote: null,
    conditions: [],
    deepLinkPath: "/sales/quotes/quote-rtp",
    autoSendResult: {
      attempted: false,
      sent: false,
      reason: "post_approval_action_return_to_rep",
    },
  });

  assertEquals(metadata.auto_send, {
    status: "return_to_rep",
    attempted: false,
    sent: false,
    reason: "post_approval_action_return_to_rep",
  });
});

Deno.test("metadata stores safe failure code instead of raw auto-send error", () => {
  const metadata = buildRepApprovalDecisionMetadata({
    quotePackageId: "quote-2",
    approvalCaseId: "case-2",
    decision: "approved",
    decisionNote: "Approved",
    conditions: [],
    deepLinkPath: "/sales/quotes/quote-2",
    autoSendResult: {
      attempted: true,
      sent: false,
      error: "provider secret stack trace should not be persisted",
    },
  });

  assertEquals(metadata.auto_send, {
    status: "failed",
    attempted: true,
    sent: false,
    failure_code: "auto_send_error",
  });
});

Deno.test("non-approved decision copy remains unchanged and omits auto-send metadata", () => {
  const copy = buildRepApprovalDecisionCopy({
    decision: "changes_requested",
    quoteNumber: "QB-1004",
    managerName: "Morgan Manager",
    note: "Update freight",
    nextRole: null,
    autoSendResult: { attempted: true, sent: true },
  });
  const metadata = buildRepApprovalDecisionMetadata({
    quotePackageId: "quote-3",
    approvalCaseId: "case-3",
    decision: "changes_requested",
    decisionNote: "Update freight",
    conditions: [],
    deepLinkPath: "/sales/quotes/quote-3",
    autoSendResult: { attempted: true, sent: true },
  });

  assertEquals(copy.title, "Changes requested");
  assertEquals("auto_send" in metadata, false);
});

Deno.test("decide flow passes autoSendResult into rep decision notification", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const autoSendIndex = source.indexOf("const autoSendResult =");
  const notifyIndex = source.indexOf("await notifyRepOfApprovalDecision({", autoSendIndex);
  const autoSendPassedIndex = source.indexOf("autoSendResult,", notifyIndex);

  assert(autoSendIndex > -1, "decide flow must compute autoSendResult");
  assert(notifyIndex > autoSendIndex, "rep notification must happen after auto-send resolution");
  assert(autoSendPassedIndex > notifyIndex, "rep notification must receive autoSendResult");
});
