export interface AuthzDenialAuditEvent {
  eventType: "integration_authz_denial";
  route: string;
  action: string;
  callerUserId: string | null;
  reasonCode: string;
  status: 401 | 403;
  occurredAt: string;
}

export interface AuthzDenialAuditInput {
  route: string;
  action?: string | null;
  callerUserId?: string | null;
  reasonCode: string;
  status: 401 | 403;
}

export type AuthzAuditLogger = (
  message: string,
  payload: AuthzDenialAuditEvent,
) => void;

export function buildAuthzDenialAuditEvent(
  input: AuthzDenialAuditInput,
): AuthzDenialAuditEvent {
  return {
    eventType: "integration_authz_denial",
    route: input.route,
    action: input.action?.trim() ? input.action.trim() : "unknown",
    callerUserId: input.callerUserId ?? null,
    reasonCode: input.reasonCode,
    status: input.status,
    occurredAt: new Date().toISOString(),
  };
}

export function emitAuthzDenialAuditEvent(
  input: AuthzDenialAuditInput,
  logger: AuthzAuditLogger = defaultAuthzAuditLogger,
): AuthzDenialAuditEvent {
  const event = buildAuthzDenialAuditEvent(input);
  logger("[admin-users][authz-deny]", event);
  return event;
}

function defaultAuthzAuditLogger(
  message: string,
  payload: AuthzDenialAuditEvent,
): void {
  console.warn(message, JSON.stringify(payload));
}
