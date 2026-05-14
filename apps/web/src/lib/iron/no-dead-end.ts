export type IronFailureSurface = "orchestrator" | "knowledge" | "flow" | "unknown";

interface IronNoDeadEndInput {
  surface?: IronFailureSurface;
  action?: string;
  error?: string | null;
}

function cleanError(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function surfaceLabel(surface: IronFailureSurface): string {
  if (surface === "orchestrator") return "routing service";
  if (surface === "knowledge") return "answer service";
  if (surface === "flow") return "action service";
  return "Iron service";
}

export function buildIronNoDeadEndMessage(input: IronNoDeadEndInput = {}): string {
  const surface = input.surface ?? "unknown";
  const action = input.action?.trim() || "finish that request";
  const error = cleanError(input.error);
  const lower = error.toLowerCase();

  if (/not signed in|auth|jwt|unauthorized|forbidden|401|403/.test(lower)) {
    return `I could not verify your session, so I did not ${action}. Sign back in or refresh the page, then ask me again.`;
  }

  if (/cost_limit|usage cap|token|quota/.test(lower)) {
    return "Iron's usage limit is reached for now. I did not make changes. Use the app directly for urgent work, or try Iron again after the limit resets.";
  }

  if (/network|fetch|failed to fetch|could not reach|edge function|non-2xx|502|503|504|timeout|aborted/.test(lower)) {
    return `I hit a connection problem with the ${surfaceLabel(surface)} before I could ${action}. I did not make changes. Try once more; if it is urgent, use the matching QEP page directly and keep this chat open for context.`;
  }

  if (surface === "flow") {
    return "I could not complete the action step, so I did not make changes. Review the fields, then try again or open the matching QEP page directly.";
  }

  return `I could not ${action}. I did not make changes. Try again, or open the matching QEP page directly while keeping this chat open for context.${error ? ` Detail: ${error}` : ""}`;
}
