/**
 * AES-256-GCM encryption/decryption for integration credentials.
 *
 * Generalizes hubspot-crypto.ts to support per-integration key derivation
 * using a single INTEGRATION_ENCRYPTION_KEY env var.
 *
 * Key source: INTEGRATION_ENCRYPTION_KEY — a 64-char hex string (32 bytes).
 * Per-integration sub-keys are derived via HKDF with the integration key as info.
 * Ciphertext format: "<12-byte-iv-hex>:<ciphertext-hex>"
 *
 * Used by: integration-manager, onedrive sync, admin-users
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

async function getMasterKey(): Promise<CryptoKey> {
  const keyHex = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must be set as a 64-char hex string (32 bytes). " +
        "Generate with: openssl rand -hex 32"
    );
  }
  return crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex),
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );
}

/**
 * Derives a per-integration AES-256-GCM key using HKDF.
 * Each integration (e.g. 'ironguides', 'intellidealer') gets a unique sub-key.
 */
async function deriveIntegrationKey(integrationKey: string): Promise<CryptoKey> {
  const masterKey = await getMasterKey();
  const info = new TextEncoder().encode(`qep-integration-${integrationKey}`);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32), // zero salt — info provides domain separation
      info,
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a credential string for a specific integration.
 * Returns "<iv_hex>:<ciphertext_hex>" safe to store in integration_status.credentials_encrypted.
 */
export async function encryptCredential(
  plaintext: string,
  integrationKey: string
): Promise<string> {
  const key = await deriveIntegrationKey(integrationKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypts a credential stored in "<iv_hex>:<ciphertext_hex>" format.
 * Throws if the format is invalid, the key does not match, or the integration key is wrong.
 */
export async function decryptCredential(
  encrypted: string,
  integrationKey: string
): Promise<string> {
  const colonIdx = encrypted.indexOf(":");
  if (colonIdx === -1) {
    throw new Error("Invalid encrypted credential format — expected '<iv_hex>:<ciphertext_hex>'");
  }
  const ivHex = encrypted.slice(0, colonIdx);
  const ciphertextHex = encrypted.slice(colonIdx + 1);
  const key = await deriveIntegrationKey(integrationKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(ivHex) },
    key,
    hexToBytes(ciphertextHex)
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Encrypts an OneDrive token using the integration sub-key for 'onedrive'.
 * Drop-in replacement for hubspot-crypto encryptToken used in onedrive flows.
 */
export async function encryptOneDriveToken(plaintext: string): Promise<string> {
  return encryptCredential(plaintext, "onedrive");
}

/**
 * Decrypts an OneDrive token stored in "<iv_hex>:<ciphertext_hex>" format.
 */
export async function decryptOneDriveToken(encrypted: string): Promise<string> {
  return decryptCredential(encrypted, "onedrive");
}
