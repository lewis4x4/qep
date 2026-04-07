/**
 * Wave 6.11 Flare — PII + secret redaction.
 *
 * Applied to: click-trail text, network-trail urls, console-error
 * messages + stacks, store snapshot values, visible-entity scraped
 * text, DOM snapshot. See spec §6.
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
const SENSITIVE_QUERY_PARAMS = /[?&](token|key|secret|password|jwt|auth)=[^&#]*/gi;

/** Redact a string with all 7 PII/secret patterns applied in order. */
export function redactString(input: string | null | undefined): string {
  if (input == null) return "";
  let out = String(input);
  for (const { re } of PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

/** Strip sensitive query params from a URL. */
export function redactUrl(url: string): string {
  if (!url) return url;
  // Strip whole sensitive params
  let out = url.replace(SENSITIVE_QUERY_PARAMS, (match) => match.split("=")[0] + "=[REDACTED]");
  // Then run the general PII pass (catches embedded JWTs in path segments)
  return redactString(out);
}

/**
 * Deep-walk an object and recursively:
 *  - Drop any key matching SECRET_KEY_PATTERN entirely
 *  - Redact any string value with the PII patterns
 *  - Preserve numbers, booleans, nulls untouched
 *
 * Used for store snapshots + feature flags + visible_entities scraped text.
 */
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

/**
 * Walks the DOM and blanks any input that matches a redaction selector.
 * Mutates the DOM in place — only call this on a CLONE used for screenshot
 * + DOM snapshot capture, never on the live document.
 */
export function blankSensitiveInputs(root: Document | Element): void {
  const selectors = [
    'input[type="password"]',
    "[data-flare-redact]",
    'input[autocomplete~="cc-number"]',
    'input[autocomplete~="cc-csc"]',
    'input[autocomplete~="cc-exp"]',
  ];
  for (const sel of selectors) {
    const nodes = root.querySelectorAll<HTMLInputElement>(sel);
    nodes.forEach((node) => {
      if ("value" in node) node.value = "";
      node.setAttribute("value", "");
      node.setAttribute("data-flare-redacted", "true");
    });
  }
}
