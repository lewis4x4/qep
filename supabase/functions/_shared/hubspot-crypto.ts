/**
 * AES-256-GCM encryption/decryption for HubSpot OAuth tokens.
 *
 * Key source: HUBSPOT_ENCRYPTION_KEY env var — a 64-char hex string (32 bytes).
 * Ciphertext format: "<12-byte-iv-hex>:<ciphertext-hex>"
 *
 * Used by: hubspot-oauth, hubspot-webhook, hubspot-scheduler, voice-capture
 */

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getKey(): Promise<CryptoKey> {
  const keyHex = Deno.env.get("HUBSPOT_ENCRYPTION_KEY");
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      "HUBSPOT_ENCRYPTION_KEY must be set as a 64-char hex string (32 bytes). " +
        "Generate with: openssl rand -hex 32",
    );
  }
  return crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex) as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts a plaintext token string.
 * Returns a "<iv_hex>:<ciphertext_hex>" string safe to store in the database.
 */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypts a token stored in "<iv_hex>:<ciphertext_hex>" format.
 * Throws if the format is invalid or the key does not match.
 */
export async function decryptToken(encrypted: string): Promise<string> {
  const colonIdx = encrypted.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(
      "Invalid encrypted token format — expected '<iv_hex>:<ciphertext_hex>'",
    );
  }
  const ivHex = encrypted.slice(0, colonIdx);
  const ciphertextHex = encrypted.slice(colonIdx + 1);
  const key = await getKey();
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: hexToBytes(ivHex) as BufferSource,
    },
    key,
    hexToBytes(ciphertextHex) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}
