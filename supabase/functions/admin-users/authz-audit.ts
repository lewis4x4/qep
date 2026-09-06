export interface AuthzDenialAuditInput {
  route: string;
  action?: string | null;
  callerUserId?: string | null;
  reasonCode: string;
  status: number;
}
export type AuthzDenialAuditEvent = ReturnType<typeof buildAuthzDenialAuditEvent>;
export type AuthzAuditLogger = (message: string, payload: AuthzDenialAuditEvent) => void;

export function buildAuthzDenialAuditEvent(input: AuthzDenialAuditInput) {
  return {
    eventType: "integration_authz_denial",
    route: input.route,
    action: input.action?.trim() ? input.action.trim() : "unknown",
    callerUserId: input.callerUserId ?? null,
    reasonCode: input.reasonCode,
    status: input.status,
    occurredAt: new Date().toISOString()
  };
}
export function emitAuthzDenialAuditEvent(input: AuthzDenialAuditInput, logger: AuthzAuditLogger = defaultAuthzAuditLogger) {
  const event = buildAuthzDenialAuditEvent(input);
  logger("[admin-users][authz-deny]", event);
  return event;
}
function defaultAuthzAuditLogger(message: string, payload: AuthzDenialAuditEvent) {
  console.warn(message, JSON.stringify(payload));
}
