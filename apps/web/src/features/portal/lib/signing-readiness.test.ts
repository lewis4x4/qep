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

  test("labels invoice esign columns as provider-neutral until VESign contract exists", () => {
    const summary = summarizeInvoiceSigningReadiness({
      esignStatus: "partially_signed",
      esignEnvelopeId: "env-123",
      esignSignedAt: null,
    });

    expect(summary).toMatchObject({
      label: "Provider-neutral e-sign fields",
      value: "partially signed",
      source: "provider_neutral",
      vesignReady: false,
    });
    expect(summary.detail).toContain("no confirmed VESign adapter");
  });

  test("labels rental signed terms URLs as native terms only", () => {
    const summary = summarizeRentalSigningReadiness({ signedTermsUrl: "https://example.test/terms.pdf" });

    expect(summary).toMatchObject({
      label: "Native rental terms",
      value: "Terms link present",
      source: "native_qep",
      vesignReady: false,
    });
    expect(summary.detail).toContain("not VESign provider status");
  });

  test("keeps exact external requirements explicit", () => {
    expect(vesignRequirementsText()).toContain("VitalEdge/VESign contract and sandbox credentials");
    expect(vesignRequirementsText()).toContain("webhook secret and replay samples");
    expect(vesignRequirementsText()).toContain("invoice, quote, and rental envelope mapping requirements");
  });
});
