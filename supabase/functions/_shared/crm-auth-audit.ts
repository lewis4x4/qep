import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const REDACTED_METADATA_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "authorization",
]);

type CrmAuthEventType =
  | "login_success"
  | "login_failure"
  | "logout"
  | "token_refresh"
  | "password_reset_request"
  | "password_reset_complete"
  | "access_denied";

type CrmAuthEventOutcome = "success" | "failure";

export type CrmAuditClient = Pick<SupabaseClient, "rpc">;

export interface LogCrmAuthEventInput {
  workspaceId: string;
  eventType: CrmAuthEventType;
  outcome: CrmAuthEventOutcome;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  requestId?: string | null;
  ipInet?: string | null;
  userAgent?: string | null;
  resource?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EmitAccessDeniedInput {
  workspaceId: string;
  requestId: string;
  resource: string;
  reasonCode: string;
  actorUserId?: string | null;
  ipInet?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

function scrubMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => scrubMetadata(entry));
  }

  if (value && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (
      const [key, entry] of Object.entries(value as Record<string, unknown>)
    ) {
      if (REDACTED_METADATA_KEYS.has(key.toLowerCase())) {
        continue;
      }
      cleaned[key] = scrubMetadata(entry);
    }
    return cleaned;
  }

  return value;
}

export async function logCrmAuthEvent(
  client: CrmAuditClient,
  input: LogCrmAuthEventInput,
): Promise<void> {
  const { error } = await client.rpc("log_crm_auth_event", {
    p_workspace_id: input.workspaceId,
    p_event_type: input.eventType,
    p_outcome: input.outcome,
    p_actor_user_id: input.actorUserId ?? null,
    p_subject_user_id: input.subjectUserId ?? null,
    p_request_id: input.requestId ?? null,
    p_ip_inet: input.ipInet ?? null,
    p_user_agent: input.userAgent ?? null,
    p_resource: input.resource ?? null,
    p_metadata: scrubMetadata(input.metadata ?? {}),
  });

  if (error) {
    console.error("[crm-audit] failed to write auth event", {
      code: error.code,
      message: error.message,
      resource: input.resource,
      eventType: input.eventType,
      requestId: input.requestId,
    });
  }
}

export async function emitCrmAccessDeniedAudit(
  client: CrmAuditClient,
  input: EmitAccessDeniedInput,
): Promise<void> {
  await logCrmAuthEvent(client, {
    workspaceId: input.workspaceId,
    eventType: "access_denied",
    outcome: "failure",
    actorUserId: input.actorUserId ?? null,
    requestId: input.requestId,
    ipInet: input.ipInet ?? null,
    userAgent: input.userAgent ?? null,
    resource: input.resource,
    metadata: {
      reason_code: input.reasonCode,
      ...(input.metadata ?? {}),
    },
  });
}

export function extractRequestIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}
