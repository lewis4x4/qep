/**
 * Server-side mirror of apps/web/src/lib/flare/redactPII.ts.
 *
 * Same regex set, same key blocklist. Iron uses this on every message
 * before persisting to iron_messages.content, on the agentic_brief before
 * persisting to iron_handoffs, and on classifier output prior to logging.
 *
 * If the client copy ever changes, update both. Tests in
 * iron_messages_pii.test.ts assert parity.
 */

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "JWT", re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { name: "BEARER", re: /Bearer\s+[A-Za-z0-9._-]+/gi },
  { name: "API_KEY", re: /\b(sk_|pk_|rk_|whsec_|SG\.|xox[bps]-)[A-Za-z0-9_.-]{20,}/g },
  { name: "EMAIL", re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "PHONE", re: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { name: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "CC_LIKE", re: /\b(?:\d[ -]*?){13,16}\b/g },
];

const SECRET_KEY_PATTERN = /password|secret|token|apikey|api_key|jwt|authorization/i;

export function redactString(input: string | null | undefined): string {
  if (input == null) return "";
  let out = String(input);
  for (const { re } of PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MAX_DEPTH]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = redactDeep(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
