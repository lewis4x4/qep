/**
 * Event Tracking Utility — DGE analytics event emission.
 *
 * Implements the common event envelope per QUA-100 event tracking spec.
 * Edge functions call trackEvent() to emit structured analytics events.
 *
 * Events are fire-and-forget — failures are logged but never throw to callers.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// Event envelope per analytics spec
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = "rep" | "admin" | "manager" | "owner" | "system";
export type EventSource = "web" | "edge" | "edge_function" | "cron" | "admin_hub";
export type EntityType =
  | "quote"
  | "deal"
  | "customer"
  | "integration"
  | "scenario";
export type DeviceType = "desktop" | "mobile" | "server";

export interface EventContext {
  app_version?: string;
  environment?: "prod" | "staging";
  device_type?: DeviceType;
}

export interface TrackEventInput {
  event_name: string;
  event_version?: number;
  user_id?: string | null;
  role?: UserRole;
  session_id?: string | null;
  request_id?: string | null;
  trace_id?: string | null;
  source?: EventSource;
  entity_type?: EntityType;
  entity_id?: string | null;
  properties?: Record<string, unknown>;
  context?: EventContext;
}

export interface EventEnvelope extends TrackEventInput {
  event_id: string;
  event_version: number;
  occurred_at: string;
  received_at: string;
  workspace_id: string;
  project_id: string;
  source: EventSource;
  role: UserRole;
  context: Required<EventContext>;
}

// ─────────────────────────────────────────────────────────────────────────────
// EventTracker
// ─────────────────────────────────────────────────────────────────────────────

export class EventTracker {
  private supabaseAdmin: SupabaseClient;
  private workspaceId: string;
  private projectId: string;

  constructor(
    supabaseAdmin: SupabaseClient,
    workspaceId: string,
    projectId: string
  ) {
    this.supabaseAdmin = supabaseAdmin;
    this.workspaceId = workspaceId;
    this.projectId = projectId;
  }

  /**
   * Emit an analytics event. Fire-and-forget — errors are logged but never thrown.
   */
  async trackEvent(input: TrackEventInput): Promise<void> {
    try {
      const envelope: EventEnvelope = {
        ...input,
        event_id: crypto.randomUUID(),
        event_version: input.event_version ?? 1,
        occurred_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
        workspace_id: this.workspaceId,
        project_id: this.projectId,
        source: input.source ?? "edge",
        role: input.role ?? "system",
        context: {
          app_version: input.context?.app_version ?? "1.0.0",
          environment:
            input.context?.environment ??
            (Deno.env.get("ENVIRONMENT") === "production" ? "prod" : "staging"),
          device_type: input.context?.device_type ?? "server",
        },
        properties: _sanitizeProperties(input.properties ?? {}),
      };

      // Insert into analytics_events table (created by Sprint 2 migration)
      // Gracefully skip if table does not exist yet (Sprint 1 forward-compat)
      const { error } = await this.supabaseAdmin
        .from("analytics_events")
        .insert(envelope);

      if (error) {
        // Table may not exist in Sprint 1 — log but don't fail
        if (!error.message?.includes("does not exist")) {
          console.error("[EventTracker] Failed to persist event:", error);
        }
      }
    } catch (err) {
      // Never propagate tracking errors to callers
      console.error("[EventTracker] Unexpected error:", err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-defined admin hub event emitters (per event tracking spec §5)
// ─────────────────────────────────────────────────────────────────────────────

export async function emitIntegrationConfigUpdated(
  tracker: EventTracker,
  params: {
    integration: string;
    changedFields: string[];
    updatedByRole: UserRole;
    statusAfter?: string | null;
    authType?: string | null;
    syncFrequency?: string;
    userId?: string;
    requestId?: string;
  }
): Promise<void> {
  await tracker.trackEvent({
    event_name: "integration_credentials_saved",
    user_id: params.userId ?? null,
    role: params.updatedByRole,
    request_id: params.requestId ?? null,
    source: "edge",
    entity_type: "integration",
    entity_id: params.integration,
    properties: {
      integration_key: params.integration,
      changed_fields: params.changedFields,
      updated_by_role: params.updatedByRole,
      status_after: params.statusAfter ?? null,
      auth_type: params.authType ?? null,
      sync_frequency: params.syncFrequency ?? null,
    },
  });
}

export async function emitIntegrationConnectionTested(
  tracker: EventTracker,
  params: {
    integration: string;
    result: "success" | "failure";
    latencyMs: number;
    errorCode?: string;
    userId?: string;
    requestId?: string;
    role?: UserRole;
  }
): Promise<void> {
  await tracker.trackEvent({
    event_name: "integration_test_connection_result",
    user_id: params.userId ?? null,
    role: params.role ?? "owner",
    request_id: params.requestId ?? null,
    source: "edge",
    entity_type: "integration",
    entity_id: params.integration,
    properties: {
      integration_key: params.integration,
      success: params.result === "success",
      latency_ms: params.latencyMs,
      mode: "mock",
      error_code: params.errorCode ?? null,
    },
  });
}

export async function emitIntegrationSyncCompleted(
  tracker: EventTracker,
  params: {
    integration: string;
    recordsSynced: number;
    durationMs: number;
    status: "success" | "partial" | "failed";
    lastSuccessAt?: string;
    requestId?: string;
  }
): Promise<void> {
  await tracker.trackEvent({
    event_name: "integration_sync_completed",
    user_id: null,
    role: "system",
    request_id: params.requestId ?? null,
    source: "edge_function",
    entity_type: "integration",
    entity_id: params.integration,
    properties: {
      integration: params.integration,
      records_synced: params.recordsSynced,
      duration_ms: params.durationMs,
      status: params.status,
      last_success_at: params.lastSuccessAt ?? null,
    },
  });
}

export async function emitIntegrationFallbackActivated(
  tracker: EventTracker,
  params: {
    integration: string;
    reason: string;
    stalenessHours?: number;
    fallbackMode: "mock" | "stale_cache" | "regression";
    requestId?: string;
  }
): Promise<void> {
  await tracker.trackEvent({
    event_name: "integration_fallback_activated",
    user_id: null,
    role: "system",
    request_id: params.requestId ?? null,
    source: "edge",
    entity_type: "integration",
    entity_id: params.integration,
    properties: {
      integration_key: params.integration,
      reason: params.reason,
      staleness_hours: params.stalenessHours ?? null,
      fallback_mode: params.fallbackMode,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips PII fields from event properties per data governance rules.
 * Removes: name, email, phone, any free-text notes fields.
 */
function _sanitizeProperties(
  props: Record<string, unknown>
): Record<string, unknown> {
  const PII_KEYS = new Set([
    "name",
    "customer_name",
    "email",
    "phone",
    "notes",
    "free_text",
    "address",
  ]);
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !PII_KEYS.has(key.toLowerCase()))
  );
}

/**
 * Factory — creates an EventTracker using standard Deno env vars.
 * workspaceId and projectId default to Supabase project ID.
 */
export function createEventTracker(
  supabaseAdmin: SupabaseClient,
  overrides?: { workspaceId?: string; projectId?: string }
): EventTracker {
  const projectId =
    overrides?.projectId ?? Deno.env.get("SUPABASE_URL")?.split(".")[0].split("//")[1] ?? "unknown";
  return new EventTracker(
    supabaseAdmin,
    overrides?.workspaceId ?? projectId,
    projectId
  );
}
