import { describe, expect, test } from "bun:test";
import {
  summarizeInvoiceSigningReadiness,
  summarizeQuoteSigningReadiness,
  summarizeRentalSigningReadiness,
  vesignRequirementsText,
} from "./signing-readiness";

describe("signing readiness labels", () => {
  test("labels quote signatures as native QEP evidence, not VESign", () => {
    const summary = summarizeQuoteSigningReadiness({
      signedAt: "2026-05-04T12:00:00.000Z",
      signerName: "Jane Customer",
    });

    expect(summary).toMatchObject({
      label: "Native QEP signing",
      value: "Accepted in portal",
      source: "native_qep",
      vesignReady: false,
    });
    expect(summary.detail).toContain("not VESign provider-envelope evidence");
  });

  test("does not say customer action is pending after a non-actionable quote state", () => {
    const summary = summarizeQuoteSigningReadiness({
      signedAt: null,
      signerName: null,
      status: "countered",
    });

    expect(summary).toMatchObject({
      label: "Native QEP signing",
      value: "No native acceptance pending",
      source: "native_qep",
      vesignReady: false,
    });
    expect(summary.detail).toContain("no VESign provider envelope/status should be inferred");
  });

  test("flags accepted quote status when native acceptance timestamp is missing", () => {
    const summary = summarizeQuoteSigningReadiness({
      signedAt: null,
      status: "accepted",
    });

    expect(summary).toMatchObject({
      label: "Native QEP signing",
      value: "Accepted status; timestamp missing",
      source: "native_qep",
      vesignReady: false,
    });
    expect(summary.detail).toContain("no native acceptance timestamp is present");
  });

  test("labels native invoice signatures as QEP portal evidence", () => {
    const summary = summarizeInvoiceSigningReadiness({
      nativeSignature: { id: "sig-1" },
    });

    expect(summary).toMatchObject({
      label: "Native QEP invoice signing",
      value: "Signed in portal",
      source: "native_qep",
      vesignReady: false,
      nativeReady: true,
    });
    expect(summary.detail).toContain("No VESign envelope is required");
  });

  test("labels invoice esign columns as legacy until native proof exists", () => {
    const summary = summarizeInvoiceSigningReadiness({
      esignStatus: "partially_signed",
      esignEnvelopeId: "env-123",
      esignSignedAt: null,
    });

    expect(summary).toMatchObject({
      label: "Legacy e-sign fields",
      value: "partially signed",
      source: "provider_neutral",
      vesignReady: false,
      nativeReady: false,
    });
    expect(summary.detail).toContain("native QEP signature proof has not been captured");
  });

  test("labels native rental signatures as QEP portal evidence", () => {
    const summary = summarizeRentalSigningReadiness({ nativeSignature: { id: "sig-1" } });

    expect(summary).toMatchObject({
      label: "Native QEP rental signing",
      value: "Signed in portal",
      source: "native_qep",
      vesignReady: false,
      nativeReady: true,
    });
    expect(summary.detail).toContain("Native QEP rental terms signature proof");
  });

  test("labels rental signed terms URLs as legacy terms only", () => {
    const summary = summarizeRentalSigningReadiness({ signedTermsUrl: "https://example.test/terms.pdf" });

    expect(summary).toMatchObject({
      label: "Legacy rental terms",
      value: "Terms link present",
      source: "provider_neutral",
      vesignReady: false,
      nativeReady: false,
    });
    expect(summary.detail).toContain("native QEP signature proof has not been captured");
  });

  test("keeps exact external requirements explicit", () => {
    expect(vesignRequirementsText()).toContain("VitalEdge/VESign contract and sandbox credentials");
    expect(vesignRequirementsText()).toContain("webhook secret and replay samples");
    expect(vesignRequirementsText()).toContain("invoice, quote, and rental envelope mapping requirements");
  });
});
