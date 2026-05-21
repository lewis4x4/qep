export const DECISION_MAGIC_ACTIONS = ["approve", "block", "need_info"] as const;

export type DecisionMagicAction = (typeof DECISION_MAGIC_ACTIONS)[number];

export interface DecisionMagicPayload {
  decision_id?: string;
  decision_code?: string;
  action: DecisionMagicAction;
  owner_role: string;
  exp: number;
  nonce?: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isDecisionMagicAction(value: string): value is DecisionMagicAction {
  return (DECISION_MAGIC_ACTIONS as readonly string[]).includes(value);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

function normalizePayload(payload: DecisionMagicPayload): DecisionMagicPayload {
  if (!payload.decision_id && !payload.decision_code) {
    throw new Error("Decision magic payload must include decision_id or decision_code");
  }
  if (!isDecisionMagicAction(payload.action)) {
    throw new Error(`Unsupported decision magic action: ${payload.action}`);
  }
  if (!payload.owner_role?.trim()) {
    throw new Error("Decision magic payload requires owner_role");
  }
  if (!Number.isFinite(payload.exp)) {
    throw new Error("Decision magic payload requires exp timestamp");
  }
  return {
    decision_id: payload.decision_id,
    decision_code: payload.decision_code,
    action: payload.action,
    owner_role: payload.owner_role.trim(),
    exp: Math.floor(payload.exp),
    nonce: payload.nonce,
  };
}

export function resolveDecisionMagicLinkSecret(): string {
  const secret =
    Deno.env.get("DECISION_MAGIC_LINK_SECRET")
    ?? Deno.env.get("INTERNAL_SERVICE_SECRET")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) {
    throw new Error("Missing DECISION_MAGIC_LINK_SECRET (or INTERNAL_SERVICE_SECRET fallback)");
  }
  return secret;
}

export async function signDecisionMagicPayload(
  payload: DecisionMagicPayload,
  secret: string,
): Promise<string> {
  const normalized = normalizePayload(payload);
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(normalized)));
  const signature = await hmacSha256(secret, encodedPayload);
  return `v1.${encodedPayload}.${signature}`;
}

export async function verifyDecisionMagicToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): Promise<DecisionMagicPayload> {
  const [version, encodedPayload, providedSignature] = token.split(".");
  if (version !== "v1" || !encodedPayload || !providedSignature) {
    throw new Error("Invalid decision magic token format");
  }

  const expectedSignature = await hmacSha256(secret, encodedPayload);
  if (expectedSignature !== providedSignature) {
    throw new Error("Invalid decision magic token signature");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(fromBase64Url(encodedPayload)));
  } catch {
    throw new Error("Invalid decision magic token payload");
  }

  const payload = normalizePayload(parsed as DecisionMagicPayload);
  if (payload.exp * 1000 <= nowMs) {
    throw new Error("Decision magic token expired");
  }

  return payload;
}

export async function buildSignedDecisionActionLink(
  baseUrl: string,
  payload: Omit<DecisionMagicPayload, "exp"> & { exp?: number },
  secret: string,
  ttlSeconds = 60 * 60 * 24,
): Promise<{ url: string; token: string; exp: number }> {
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = await signDecisionMagicPayload({ ...payload, exp }, secret);
  const separator = baseUrl.includes("?") ? "&" : "?";
  return {
    url: `${baseUrl}${separator}token=${encodeURIComponent(token)}`,
    token,
    exp,
  };
}
