export type SigningEvidenceSource = "native_qep" | "provider_neutral" | "vesign_deferred";

export interface SigningReadinessSummary {
  label: string;
  value: string;
  detail: string;
  source: SigningEvidenceSource;
  vesignReady: boolean;
  nativeReady: boolean;
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

function hasNativeSignature(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "id" in value);
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
      nativeReady: true,
    };
  }

  if (status === "accepted") {
    return {
      label: "Native QEP signing",
      value: "Accepted status; timestamp missing",
      detail: "Quote is marked accepted, but no native acceptance timestamp is present. No VESign provider envelope/status should be inferred from this native QEP state.",
      source: "native_qep",
      vesignReady: false,
      nativeReady: false,
    };
  }

  if (status && !["sent", "viewed"].includes(status)) {
    return {
      label: "Native QEP signing",
      value: "No native acceptance pending",
      detail: `Current quote status is ${status.replace(/_/g, " ")}; no VESign provider envelope/status should be inferred from this native QEP state.`,
      source: "native_qep",
      vesignReady: false,
      nativeReady: false,
    };
  }

  return {
    label: "Native QEP signing",
    value: "Awaiting customer action",
    detail: "This quote room can capture QEP-native acceptance, but VESign send/status/webhook evidence is still provider-gated.",
    source: "native_qep",
    vesignReady: false,
    nativeReady: false,
  };
}

export function summarizeInvoiceSigningReadiness(input: {
  nativeSignature?: unknown;
  esignStatus?: unknown;
  esignEnvelopeId?: unknown;
  esignSignedAt?: unknown;
}): SigningReadinessSummary {
  const status = text(input.esignStatus);
  const envelopeId = text(input.esignEnvelopeId);

  if (hasNativeSignature(input.nativeSignature)) {
    return {
      label: "Native QEP invoice signing",
      value: "Signed in portal",
      detail: "Native QEP invoice signature proof is captured in the portal. No VESign envelope is required for this native flow.",
      source: "native_qep",
      vesignReady: false,
      nativeReady: true,
    };
  }

  if (status || envelopeId || hasDate(input.esignSignedAt)) {
    return {
      label: "Legacy e-sign fields",
      value: status ? status.replace(/_/g, " ") : "e-sign fields present",
      detail: envelopeId
        ? "A legacy e-sign envelope identifier exists, but native QEP signature proof has not been captured for this invoice."
        : "Legacy invoice e-sign fields exist, but native QEP signature proof has not been captured for this invoice.",
      source: "provider_neutral",
      vesignReady: false,
      nativeReady: false,
    };
  }

  return {
    label: "Native QEP invoice signing",
    value: "Awaiting signature",
    detail: "This invoice can be signed directly in the QEP portal. No VESign envelope is required for this native flow.",
    source: "native_qep",
    vesignReady: false,
    nativeReady: false,
  };
}

export function summarizeRentalSigningReadiness(input: {
  nativeSignature?: unknown;
  signedTermsUrl?: unknown;
}): SigningReadinessSummary {
  const signedTermsUrl = text(input.signedTermsUrl);
  if (hasNativeSignature(input.nativeSignature)) {
    return {
      label: "Native QEP rental signing",
      value: "Signed in portal",
      detail: "Native QEP rental terms signature proof is captured in the portal.",
      source: "native_qep",
      vesignReady: false,
      nativeReady: true,
    };
  }

  if (signedTermsUrl) {
    return {
      label: "Legacy rental terms",
      value: "Terms link present",
      detail: "A signed terms URL is present on the rental contract, but native QEP signature proof has not been captured for this rental.",
      source: "provider_neutral",
      vesignReady: false,
      nativeReady: false,
    };
  }

  return {
    label: "Native QEP rental signing",
    value: "Awaiting signature",
    detail: "Rental terms can be signed directly in the QEP portal before finalization.",
    source: "native_qep",
    vesignReady: false,
    nativeReady: false,
  };
}

export function vesignRequirementsText(): string {
  return VESIGN_PROVIDER_REQUIREMENTS.join("; ");
}
