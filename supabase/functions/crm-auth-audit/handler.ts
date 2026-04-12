import {
  extractRequestIp,
  logCrmAuthEvent,
  type CrmAuditClient,
} from "../_shared/crm-auth-audit.ts";

type LifecycleEventType =
  | "login_success"
  | "login_failure"
  | "logout"
  | "token_refresh"
  | "password_reset_request"
  | "password_reset_complete";

interface RequestBody {
  eventType?: unknown;
  email?: unknown;
  resource?: unknown;
  metadata?: unknown;
}

interface HandlerDeps {
  admin: CrmAuditClient;
  resolveActorUserId: (authHeader: string | null) => Promise<string | null>;
  requestIdFactory?: () => string;
}

const AUTH_REQUIRED_EVENTS = new Set<LifecycleEventType>([
  "login_success",
  "logout",
  "token_refresh",
  "password_reset_complete",
]);

const OUTCOME_BY_EVENT: Record<LifecycleEventType, "success" | "failure"> = {
  login_success: "success",
  login_failure: "failure",
  logout: "success",
  token_refresh: "success",
  password_reset_request: "success",
  password_reset_complete: "success",
};

function isLifecycleEventType(value: unknown): value is LifecycleEventType {
  return value === "login_success" ||
    value === "login_failure" ||
    value === "logout" ||
    value === "token_refresh" ||
    value === "password_reset_request" ||
    value === "password_reset_complete";
}

function readMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function hashEmail(email: string): Promise<string> {
  const payload = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function handleCrmAuthAuditRequest(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  if (!isLifecycleEventType(body.eventType)) {
    return new Response("Unsupported auth audit event.", { status: 400 });
  }

  const authHeader = req.headers.get("Authorization");
  const actorUserId = await deps.resolveActorUserId(authHeader);
  if (AUTH_REQUIRED_EVENTS.has(body.eventType) && !actorUserId) {
    return new Response("Authenticated audit event requires a valid bearer token.", {
      status: 401,
    });
  }

  const metadata = readMetadata(body.metadata);
  const email = readString(body.email);
  if (email) {
    metadata.subject_email_hash = await hashEmail(email);
  }

  await logCrmAuthEvent(deps.admin, {
    workspaceId: "default",
    eventType: body.eventType,
    outcome: OUTCOME_BY_EVENT[body.eventType],
    actorUserId,
    subjectUserId: actorUserId,
    requestId: readString(req.headers.get("x-request-id")) ??
      (deps.requestIdFactory?.() ?? crypto.randomUUID()),
    ipInet: extractRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
    resource: readString(body.resource),
    metadata,
  });

  return Response.json({ ok: true });
}
