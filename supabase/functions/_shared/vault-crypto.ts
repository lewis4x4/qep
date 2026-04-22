/**
 * OEM Portal Vault crypto — AES-256-GCM + TOTP.
 *
 * Storage envelope: "<iv_hex>:<ciphertext_hex>" (same shape as
 * integration-crypto.ts / hubspot-crypto.ts). Separate master key so the
 * vault's blast radius is distinct from the HubSpot and integration keys.
 *
 * Master key: env var OEM_VAULT_ENCRYPTION_KEY must be a 64-char hex string
 *             (32 bytes). Generate with: openssl rand -hex 32
 *
 * The helpers here are Deno/WebCrypto-only (no Node crypto) so they run both
 * in edge functions and in `deno test`.
 */

const VAULT_KEY_ENV = "OEM_VAULT_ENCRYPTION_KEY";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export class VaultCryptoError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "VaultCryptoError";
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new VaultCryptoError("hex string must have even length", "bad_hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new VaultCryptoError("hex string contains non-hex characters", "bad_hex");
    }
    out[i / 2] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

async function loadKey(keyHexOverride?: string): Promise<CryptoKey> {
  const hex = keyHexOverride ?? Deno.env.get(VAULT_KEY_ENV);
  if (!hex) {
    throw new VaultCryptoError(
      `${VAULT_KEY_ENV} is not set — refuse to operate without a key`,
      "missing_key",
    );
  }
  if (hex.length !== 64) {
    throw new VaultCryptoError(
      `${VAULT_KEY_ENV} must be a 64-char hex string (32 bytes)`,
      "bad_key_length",
    );
  }
  const raw = hexToBytes(hex);
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts a plaintext string. Returns "<iv_hex>:<ciphertext_hex>".
 * `keyHexOverride` is for tests only — production uses the env var.
 */
export async function encryptVaultSecret(
  plaintext: string,
  keyHexOverride?: string,
): Promise<string> {
  if (typeof plaintext !== "string") {
    throw new VaultCryptoError("plaintext must be a string", "bad_plaintext");
  }
  const key = await loadKey(keyHexOverride);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ct))}`;
}

/**
 * Decrypts a "<iv_hex>:<ciphertext_hex>" envelope.
 * Throws VaultCryptoError on malformed input, wrong key, or tampered ciphertext.
 */
export async function decryptVaultSecret(
  envelope: string,
  keyHexOverride?: string,
): Promise<string> {
  if (typeof envelope !== "string" || !envelope.includes(":")) {
    throw new VaultCryptoError("envelope must be '<iv_hex>:<ciphertext_hex>'", "bad_envelope");
  }
  const colon = envelope.indexOf(":");
  const iv = hexToBytes(envelope.slice(0, colon));
  const ct = hexToBytes(envelope.slice(colon + 1));
  if (iv.byteLength !== 12) {
    throw new VaultCryptoError("iv must be 12 bytes", "bad_iv");
  }
  const key = await loadKey(keyHexOverride);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new VaultCryptoError("decryption failed — wrong key or tampered ciphertext", "decrypt_failed");
  }
}

// ── TOTP (RFC 6238, SHA-1, 6 digits, 30s) ───────────────────────────────────

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normalizeBase32(input: string): string {
  return input.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
}

export function base32Decode(input: string): Uint8Array {
  const clean = normalizeBase32(input);
  if (clean.length === 0) {
    throw new VaultCryptoError("empty base32 string", "bad_b32");
  }
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new VaultCryptoError(`invalid base32 character '${ch}'`, "bad_b32");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * Parse a seed or otpauth:// URI and return canonical base32 seed + issuer/account.
 */
export function parseTotpInput(input: string): {
  seed: string;
  issuer: string | null;
  account: string | null;
} {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith("otpauth://")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new VaultCryptoError("otpauth URI did not parse", "bad_otpauth");
    }
    if (url.protocol !== "otpauth:") {
      throw new VaultCryptoError("not an otpauth URI", "bad_otpauth");
    }
    if (url.host !== "totp") {
      throw new VaultCryptoError("only otpauth://totp/... is supported", "bad_otpauth");
    }
    const seedParam = url.searchParams.get("secret");
    if (!seedParam) {
      throw new VaultCryptoError("otpauth URI missing secret", "bad_otpauth");
    }
    const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const colonIdx = label.indexOf(":");
    const issuerFromLabel = colonIdx > 0 ? label.slice(0, colonIdx) : null;
    const accountFromLabel = colonIdx > 0 ? label.slice(colonIdx + 1) : label || null;
    const issuer = url.searchParams.get("issuer") ?? issuerFromLabel;
    const seed = normalizeBase32(seedParam);
    base32Decode(seed); // validate
    return { seed, issuer, account: accountFromLabel };
  }
  const seed = normalizeBase32(trimmed);
  base32Decode(seed); // validate
  return { seed, issuer: null, account: null };
}

async function hmacSha1(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(msg));
  return new Uint8Array(sig);
}

/**
 * Compute a 6-digit TOTP for the given base32 seed at `nowMs`.
 * Returns the code plus seconds-remaining in the current 30s window.
 */
export async function generateTotp(
  seedBase32: string,
  nowMs: number = Date.now(),
): Promise<{ code: string; remainingSeconds: number; periodSeconds: number }> {
  const key = base32Decode(seedBase32);
  if (key.byteLength === 0) {
    throw new VaultCryptoError("empty totp seed", "bad_b32");
  }
  const counter = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
  const counterBytes = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hmac = await hmacSha1(key, counterBytes);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** TOTP_DIGITS;
  const code = (binary % mod).toString().padStart(TOTP_DIGITS, "0");
  const remainingSeconds = TOTP_PERIOD_SECONDS - Math.floor((nowMs / 1000) % TOTP_PERIOD_SECONDS);
  return { code, remainingSeconds, periodSeconds: TOTP_PERIOD_SECONDS };
}
