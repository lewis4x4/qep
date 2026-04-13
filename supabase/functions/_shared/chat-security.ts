const REVEAL_VERB_RE =
  /\b(what is|what's|tell me|show me|reveal|give me|look up|lookup|find|provide|display|share)\b/i;
const POLICY_CONTEXT_RE =
  /\b(policy|procedure|process|reset|rotate|rotation|request access|access request|contact|owner|who approves|how do i|where do i|guide|documentation|docs)\b/i;
const SENSITIVE_TERM_RE =
  /\b(secret|password|passcode|api[- ]?key|token|credential|credentials|client secret|access key|private key)\b/i;
const SENSITIVE_IDENTIFIER_RE =
  /\b[A-Z0-9_/-]*(SECRET|PASSWORD|PASSCODE|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIAL)[A-Z0-9_/-]*\b/;

export const SENSITIVE_LOOKUP_RESPONSE =
  "I can't help reveal or look up secrets, passwords, API keys, tokens, or other credentials. If you need access, use the approved QEP process or contact the appropriate internal owner.";

export function isSensitiveLookupQuery(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (POLICY_CONTEXT_RE.test(normalized)) return false;
  if (SENSITIVE_IDENTIFIER_RE.test(normalized)) return true;
  return SENSITIVE_TERM_RE.test(normalized) && REVEAL_VERB_RE.test(normalized);
}
