export type SigningEvidenceSource = "native_qep" | "provider_neutral" | "vesign_deferred";

export interface SigningReadinessSummary {
  label: string;
  value: string;
  detail: string;
  source: SigningEvidenceSource;
  vesignReady: boolean;
}

export const VESIGN_PROVIDER_REQUIREMENTS = [
  "VitalEdge/VESign contract and sandbox credentials",
  "sender identity and legal envelope policy",
  "API and webhook contract",
  "webhook secret and replay samples",
  "confirmed provider status vocabulary",
  "invoice, quote, and rental envelope mapping requirements",
] as const;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasDate(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function summarizeQuoteSigningReadiness(input: {
  signedAt?: unknown;
  signerName?: unknown;
  status?: unknown;
}): SigningReadinessSummary {
  const signerName = text(input.signerName);
  const status = text(input.status);
  if (hasDate(input.signedAt)) {
    return {
      label: "Native QEP signing",
      value: "Accepted in portal",
      detail: signerName
        ? `Native QEP portal acceptance captured for ${signerName}; this is not VESign provider-envelope evidence.`
        : "Native QEP portal acceptance captured; this is not VESign provider-envelope evidence.",
      source: "native_qep",
      vesignReady: false,
    };
  }

  if (status === "accepted") {
    return {
      label: "Native QEP signing",
      value: "Accepted status; timestamp missing",
      detail: "Quote is marked accepted, but no native acceptance timestamp is present. No VESign provider envelope/status should be inferred from this native QEP state.",
      source: "native_qep",
      vesignReady: false,
    };
  }

  if (status && !["sent", "viewed"].includes(status)) {
    return {
      label: "Native QEP signing",
      value: "No native acceptance pending",
      detail: `Current quote status is ${status.replace(/_/g, " ")}; no VESign provider envelope/status should be inferred from this native QEP state.`,
      source: "native_qep",
      vesignReady: false,
    };
  }

  return {
    label: "Native QEP signing",
    value: "Awaiting customer action",
    detail: "This quote room can capture QEP-native acceptance, but VESign send/status/webhook evidence is still provider-gated.",
    source: "native_qep",
    vesignReady: false,
  };
}

export function summarizeInvoiceSigningReadiness(input: {
  esignStatus?: unknown;
  esignEnvelopeId?: unknown;
  esignSignedAt?: unknown;
}): SigningReadinessSummary {
  const status = text(input.esignStatus);
  const envelopeId = text(input.esignEnvelopeId);

  if (status || envelopeId || hasDate(input.esignSignedAt)) {
    return {
      label: "Provider-neutral e-sign fields",
      value: status ? status.replace(/_/g, " ") : "e-sign fields present",
      detail: envelopeId
        ? "A generic e-sign envelope identifier exists, but the repo has no confirmed VESign adapter, webhook, or status mapping for it."
        : "Generic e-sign invoice fields exist, but they are not VESign provider proof without contract/API/webhook evidence.",
      source: "provider_neutral",
      vesignReady: false,
    };
  }

  return {
    label: "VESign readiness",
    value: "Provider blocked",
    detail: "No VESign envelope/status is connected for this invoice; live provider contract/API/webhook evidence is required before claiming VESign parity.",
    source: "vesign_deferred",
    vesignReady: false,
  };
}

export function summarizeRentalSigningReadiness(input: {
  signedTermsUrl?: unknown;
}): SigningReadinessSummary {
  const signedTermsUrl = text(input.signedTermsUrl);
  if (signedTermsUrl) {
    return {
      label: "Native rental terms",
      value: "Terms link present",
      detail: "A signed terms URL is present on the rental contract, but this is not VESign provider status without a confirmed provider envelope mapping.",
      source: "native_qep",
      vesignReady: false,
    };
  }

  return {
    label: "VESign readiness",
    value: "Provider blocked",
    detail: "Rental contract signing has no confirmed VESign provider envelope/status; contract, webhook, and status vocabulary are required.",
    source: "vesign_deferred",
    vesignReady: false,
  };
}

export function vesignRequirementsText(): string {
  return VESIGN_PROVIDER_REQUIREMENTS.join("; ");
}
