/**
 * Quote document hash (Track 2 Slice 2.1h).
 *
 * Computes a SHA-256 integrity seal over the exact data a signer saw at the
 * moment of signing. Stored in `quote_signatures.document_hash` so a later
 * audit can prove the document wasn't altered post-signature.
 *
 * Input is a stable canonical JSON string of the fields that matter to the
 * customer: the PDF url, the package id, the equipment list, and the money
 * totals. We intentionally exclude timestamps and caller metadata so the
 * hash is deterministic across recomputation.
 *
 * Pure function — no network, no DB. Uses Web Crypto which Deno Edge exposes
 * as `crypto.subtle`.
 */

export interface QuoteHashInput {
  quote_package_id: string;
  pdf_url: string | null;
  equipment: unknown;
  equipment_total: number | null;
  attachment_total: number | null;
  subtotal: number | null;
  trade_credit: number | null;
  net_total: number | null;
}

/** Deterministic JSON stringify: sorts object keys recursively. */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`;
  });
  return `{${entries.join(",")}}`;
}

/** Hex-encode a byte buffer. */
function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * SHA-256 of the canonical string built from `buildQuoteHashInput`.
 * Returns a 64-char hex string. When `crypto.subtle` is unavailable
 * (non-standard runtimes), returns null so the caller can skip the hash
 * rather than fail the sign request.
 */
export async function computeQuoteDocumentHash(input: QuoteHashInput): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const canonical = canonicalJsonStringify(input);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}
