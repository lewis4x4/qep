export function buildAuthzDenialAuditEvent(input) {
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
export function emitAuthzDenialAuditEvent(input, logger = defaultAuthzAuditLogger) {
  const event = buildAuthzDenialAuditEvent(input);
  logger("[admin-users][authz-deny]", event);
  return event;
}
function defaultAuthzAuditLogger(message, payload) {
  console.warn(message, JSON.stringify(payload));
}
