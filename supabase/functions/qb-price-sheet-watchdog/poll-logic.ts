/**
 * qb-price-sheet-watchdog — pure logic helpers (Deno-safe).
 *
 * All the decision logic lives here so it can be exercised from a unit
 * test harness that runs in `deno test` without needing a real
 * Supabase connection. The Deno.serve wrapper in index.ts just wires
 * these up to HTTP + Supabase + storage.
 */

export type FetchResult =
  | {
    kind: "not_modified";
    httpStatus: number;
  }
  | {
    kind: "fetched";
    httpStatus: number;
    bytes: Uint8Array;
    contentType: string | null;
    etag: string | null;
  };

/**
 * sha256 hash of a Uint8Array. Returns hex string.
 * Uses Deno's globalThis.crypto.subtle which matches WebCrypto spec.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `bytes.buffer` is typed as `ArrayBufferLike`, which can't be passed
  // directly to `crypto.subtle.digest`. Create a fresh Uint8Array whose
  // backing buffer is a plain ArrayBuffer to keep the types aligned.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Detect change classification given the previous and current hash.
 * Mirrors the client-side helper in sheet-watchdog-api.ts so both
 * sides agree on semantics.
 */
export function detectHashChange(
  prevHash: string | null | undefined,
  nextHash: string,
): "first_seen" | "unchanged" | "changed" {
  if (!prevHash) return "first_seen";
  if (prevHash === nextHash) return "unchanged";
  return "changed";
}

/**
 * Decide whether a source is due for a check. Overdue = active + past
 * the configured cadence (or never checked).
 */
export function isOverdue(
  source: {
    active: boolean;
    last_checked_at: string | null;
    check_freq_hours: number;
  },
  now: Date = new Date(),
): boolean {
  if (!source.active) return false;
  if (!source.last_checked_at) return true;
  const last = new Date(source.last_checked_at).getTime();
  const dueAt = last + source.check_freq_hours * 60 * 60 * 1000;
  return now.getTime() >= dueAt;
}

/**
 * Derive a content-type for the bucket upload. Falls back to extension
 * heuristics when the server didn't send a reliable content-type.
 */
export function resolveContentType(
  serverContentType: string | null,
  url: string,
): { contentType: string; fileType: "pdf" | "xlsx" | "xls" | "csv" | "unknown" } {
  const lower = (serverContentType ?? "").toLowerCase();
  if (lower.includes("pdf")) return { contentType: "application/pdf", fileType: "pdf" };
  if (lower.includes("spreadsheetml") || lower.includes("xlsx")) {
    return { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileType: "xlsx" };
  }
  if (lower.includes("excel") || lower.includes("vnd.ms-excel")) {
    return { contentType: "application/vnd.ms-excel", fileType: "xls" };
  }
  if (lower.includes("csv")) return { contentType: "text/csv", fileType: "csv" };

  // Extension heuristic
  const ext = extractExt(url);
  switch (ext) {
    case "pdf":  return { contentType: "application/pdf", fileType: "pdf" };
    case "xlsx": return { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileType: "xlsx" };
    case "xls":  return { contentType: "application/vnd.ms-excel", fileType: "xls" };
    case "csv":  return { contentType: "text/csv", fileType: "csv" };
    default:     return { contentType: serverContentType ?? "application/octet-stream", fileType: "unknown" };
  }
}

function extractExt(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.toLowerCase().match(/\.([a-z0-9]+)(?:$)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Build the storage path for an auto-ingested sheet. Mirrors the
 * bucket-relative path used by manual uploads so extract-price-sheet
 * can download uniformly.
 *
 * Shape: brandCode/watchdog/YYYY-MM-DD/<hash8>.<ext>
 */
export function buildStoragePath(input: {
  brandCode: string;
  hashHex: string;
  fileType: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const ext = input.fileType && input.fileType !== "unknown" ? input.fileType : "bin";
  const hash8 = input.hashHex.slice(0, 8);
  const safeCode = input.brandCode.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return `${safeCode}/watchdog/${yyyy}-${mm}-${dd}/${hash8}.${ext}`;
}

/**
 * Filename shown in the admin UI when an auto-ingested sheet needs review.
 */
export function buildAutoFilename(input: {
  brandName: string;
  sourceLabel: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `[Auto] ${input.brandName} — ${input.sourceLabel} (${yyyy}-${mm}-${dd})`;
}

/**
 * Fetch a URL with an optional If-None-Match header so unchanged
 * pages short-circuit at the network layer. Swallows HTTP error
 * statuses and returns a structured result — the caller decides how
 * to log.
 */
export async function fetchWithCache(
  url: string,
  prevEtag: string | null | undefined,
  // 15 s per request so a slow origin can't eat the edge function's 60 s
  // wall. Caller (processSource) stacks its own 20 s ceiling over this to
  // cover anything that isn't the fetch itself (e.g. redirect chase).
  timeoutMs = 15_000,
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    "User-Agent": "QEP-Watchdog/1.0 (+https://qep.blackrockai.co)",
    "Accept": "application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,*/*",
  };
  if (prevEtag) headers["If-None-Match"] = prevEtag;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (resp.status === 304) {
      return { kind: "not_modified", httpStatus: 304 };
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }
    const ab = await resp.arrayBuffer();
    return {
      kind: "fetched",
      httpStatus: resp.status,
      bytes: new Uint8Array(ab),
      contentType: resp.headers.get("content-type"),
      etag: resp.headers.get("etag"),
    };
  } finally {
    clearTimeout(timer);
  }
}
