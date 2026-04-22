import {
  base32Decode,
  decryptVaultSecret,
  encryptVaultSecret,
  generateTotp,
  normalizeBase32,
  parseTotpInput,
  VaultCryptoError,
} from "./vault-crypto.ts";

const TEST_KEY_HEX = "a".repeat(64); // deterministic 32-byte key for tests
const WRONG_KEY_HEX = "b".repeat(64);

Deno.test("encryptVaultSecret/decryptVaultSecret round-trips", async () => {
  const plain = "Tr0ub4dor & 3 horses!";
  const envelope = await encryptVaultSecret(plain, TEST_KEY_HEX);
  if (!/^[0-9a-f]{24}:[0-9a-f]+$/.test(envelope)) {
    throw new Error(`envelope shape wrong: ${envelope}`);
  }
  const out = await decryptVaultSecret(envelope, TEST_KEY_HEX);
  if (out !== plain) throw new Error(`round-trip mismatch: ${out}`);
});

Deno.test("encryptVaultSecret uses a fresh IV per call", async () => {
  const a = await encryptVaultSecret("same plaintext", TEST_KEY_HEX);
  const b = await encryptVaultSecret("same plaintext", TEST_KEY_HEX);
  if (a === b) throw new Error("two encryptions produced identical envelopes — IV not randomized");
});

Deno.test("decryptVaultSecret rejects wrong key", async () => {
  const envelope = await encryptVaultSecret("secret", TEST_KEY_HEX);
  let caught = false;
  try {
    await decryptVaultSecret(envelope, WRONG_KEY_HEX);
  } catch (e) {
    caught = e instanceof VaultCryptoError && e.code === "decrypt_failed";
  }
  if (!caught) throw new Error("wrong key should reject with decrypt_failed");
});

Deno.test("decryptVaultSecret rejects tampered ciphertext", async () => {
  const envelope = await encryptVaultSecret("original", TEST_KEY_HEX);
  // Flip the last hex nibble of the ciphertext
  const flipped = envelope.slice(0, -1) + (envelope.at(-1) === "f" ? "0" : "f");
  let caught = false;
  try {
    await decryptVaultSecret(flipped, TEST_KEY_HEX);
  } catch (e) {
    caught = e instanceof VaultCryptoError && e.code === "decrypt_failed";
  }
  if (!caught) throw new Error("tampered ciphertext should reject");
});

Deno.test("decryptVaultSecret rejects malformed envelope", async () => {
  let caught = false;
  try {
    await decryptVaultSecret("no-colon-here", TEST_KEY_HEX);
  } catch (e) {
    caught = e instanceof VaultCryptoError && e.code === "bad_envelope";
  }
  if (!caught) throw new Error("malformed envelope should reject with bad_envelope");
});

Deno.test("encryptVaultSecret refuses to run without a key", async () => {
  // Override with obviously wrong length
  let caught = false;
  try {
    await encryptVaultSecret("x", "tooshort");
  } catch (e) {
    caught = e instanceof VaultCryptoError && e.code === "bad_key_length";
  }
  if (!caught) throw new Error("short key should reject with bad_key_length");
});

// ── Base32 + TOTP ──────────────────────────────────────────────────────────

Deno.test("normalizeBase32 strips whitespace and upcases", () => {
  const out = normalizeBase32("jbsw y3dp EHPk 3PXP  ");
  if (out !== "JBSWY3DPEHPK3PXP") throw new Error(`normalize wrong: ${out}`);
});

Deno.test("base32Decode rejects invalid characters", () => {
  let caught = false;
  try {
    base32Decode("JBSWY3DP!!");
  } catch (e) {
    caught = e instanceof VaultCryptoError && e.code === "bad_b32";
  }
  if (!caught) throw new Error("invalid base32 should reject");
});

Deno.test("parseTotpInput accepts bare base32 seed", () => {
  const p = parseTotpInput("jbsw y3dpEHPK3PXP");
  if (p.seed !== "JBSWY3DPEHPK3PXP") throw new Error(`seed wrong: ${p.seed}`);
  if (p.issuer !== null || p.account !== null) throw new Error("bare seed should not yield issuer/account");
});

Deno.test("parseTotpInput extracts issuer and account from otpauth URI", () => {
  const p = parseTotpInput(
    "otpauth://totp/ASV%20Dealer:ops@qep?secret=JBSWY3DPEHPK3PXP&issuer=ASV%20Dealer",
  );
  if (p.seed !== "JBSWY3DPEHPK3PXP") throw new Error(`seed wrong: ${p.seed}`);
  if (p.issuer !== "ASV Dealer") throw new Error(`issuer wrong: ${p.issuer}`);
  if (p.account !== "ops@qep") throw new Error(`account wrong: ${p.account}`);
});

Deno.test("parseTotpInput rejects non-totp otpauth URIs", () => {
  let caught = false;
  try {
    parseTotpInput("otpauth://hotp/test?secret=JBSWY3DPEHPK3PXP");
  } catch (e) {
    caught = e instanceof VaultCryptoError && e.code === "bad_otpauth";
  }
  if (!caught) throw new Error("hotp URI should reject");
});

// RFC 6238 Appendix B gives reference codes for the ASCII string
// "12345678901234567890" (used as raw HMAC-SHA1 key). The base32 form
// of those 20 ASCII bytes is "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".
// At T=59 (counter=1) the expected 6-digit code is "287082".
Deno.test("generateTotp matches RFC 6238 vector @ T=59", async () => {
  const out = await generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000);
  if (out.code !== "287082") {
    throw new Error(`RFC 6238 vector failed: expected 287082, got ${out.code}`);
  }
  if (out.periodSeconds !== 30) throw new Error("period should be 30");
});

// At T=1111111109 (counter=0x00000000023523ec) the expected code is "081804".
Deno.test("generateTotp matches RFC 6238 vector @ T=1111111109", async () => {
  const out = await generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1_111_111_109_000);
  if (out.code !== "081804") {
    throw new Error(`RFC 6238 vector failed: expected 081804, got ${out.code}`);
  }
});

Deno.test("generateTotp reports remainingSeconds inside the 30s window", async () => {
  const out = await generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 15_000);
  if (out.remainingSeconds !== 15) {
    throw new Error(`remainingSeconds wrong at t=15s: ${out.remainingSeconds}`);
  }
});
