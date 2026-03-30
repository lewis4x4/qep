const OAUTH_STATE_COOKIE_NAME = "hubspot_oauth_state";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface OAuthStateRecord {
  state: string;
  userId: string;
  sessionBinding: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export type OAuthStateValidationResult =
  | { ok: true; userId: string }
  | {
    ok: false;
    reasonCode:
      | "state_missing"
      | "state_cookie_invalid"
      | "state_mismatch"
      | "state_expired";
  };

export function createOAuthStateRecord(
  userId: string,
  sessionBinding: string,
  nowMs = Date.now(),
  ttlSeconds = 600,
): OAuthStateRecord {
  return {
    state: crypto.randomUUID(),
    userId,
    sessionBinding,
    nonce: crypto.randomUUID(),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlSeconds * 1_000,
  };
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(token),
  );
  return toBase64Url(new Uint8Array(digest));
}

export async function createSignedOAuthStateCookie(
  record: OAuthStateRecord,
  secret: string,
): Promise<string> {
  const payload = toBase64Url(textEncoder.encode(JSON.stringify(record)));
  const signature = await signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export async function readAndVerifyOAuthStateCookie(
  cookieHeader: string | null,
  secret: string,
): Promise<OAuthStateRecord | null> {
  const rawCookie = getCookieValue(cookieHeader, OAUTH_STATE_COOKIE_NAME);
  if (!rawCookie) return null;
  const [payload, signature] = rawCookie.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = await signPayload(payload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) return null;

  try {
    const decoded = textDecoder.decode(fromBase64Url(payload));
    const parsed = JSON.parse(decoded) as Partial<OAuthStateRecord>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.sessionBinding !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.issuedAtMs !== "number" ||
      typeof parsed.expiresAtMs !== "number"
    ) {
      return null;
    }

    return {
      state: parsed.state,
      userId: parsed.userId,
      sessionBinding: parsed.sessionBinding,
      nonce: parsed.nonce,
      issuedAtMs: parsed.issuedAtMs,
      expiresAtMs: parsed.expiresAtMs,
    };
  } catch {
    return null;
  }
}

export function validateOAuthCallbackState(
  callbackState: string | null,
  record: OAuthStateRecord | null,
  nowMs = Date.now(),
): OAuthStateValidationResult {
  if (!callbackState) {
    return { ok: false, reasonCode: "state_missing" };
  }
  if (!record) {
    return { ok: false, reasonCode: "state_cookie_invalid" };
  }
  if (record.expiresAtMs < nowMs) {
    return { ok: false, reasonCode: "state_expired" };
  }
  if (!timingSafeEqual(callbackState, record.state)) {
    return { ok: false, reasonCode: "state_mismatch" };
  }
  return { ok: true, userId: record.userId };
}

export function buildOAuthStateCookieHeader(
  cookieValue: string,
  maxAgeSeconds = 600,
): string {
  return `${OAUTH_STATE_COOKIE_NAME}=${cookieValue}; Path=/functions/v1/hubspot-oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearOAuthStateCookieHeader(): string {
  return `${OAUTH_STATE_COOKIE_NAME}=; Path=/functions/v1/hubspot-oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(payload),
  );
  return toBase64Url(new Uint8Array(signature));
}

function getCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  return null;
}

function toBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(input: string): Uint8Array {
  const base64 = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}
