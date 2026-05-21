/**
 * Telematics Signal-Ingest Adapter (Slice 3)
 *
 * Converts telematics fleet events (fault codes, idle events) into normalized
 * signals on the operator feed. This is distinct from `telematics-ingest`,
 * which records hours/GPS usage against `eaas_usage_records` for the EaaS
 * billing pipeline. This function is strictly about operator-actionable
 * anomalies — "this machine threw a fault, someone should call the
 * customer" — not usage metering.
 *
 * Both paths resolve device_id → equipment via `telematics_feeds` and stay
 * independently deployable so fault-signal adoption doesn't perturb billing.
 *
 * Callable by:
 *   1. Fleet provider webhooks via `x-internal-service-secret` (when the
 *      dispatcher normalizes provider payloads into our shape).
 *   2. Admin/manager/owner JWTs for manual fault entry during pilot setup.
 *
 * Event kinds:
 *   - "fault": diagnostic trouble code raised by ECU.
 *   - "idle":  machine has been idling beyond the operator threshold.
 *
 * Idempotency:
 *   Providers that emit a stable event_id use it directly. If absent, we
 *   synthesize one from device + kind + fault_code + occurred_at so hourly
 *   re-scans don't double-ingest the same fault.
 */

import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { ingestSignal, type SignalSeverity } from "../_shared/qrm-signals.ts";
import type { RouterCtx } from "../_shared/crm-router-service.ts";
import { genericTelematicsAdapter } from "../_shared/adapters/generic-telematics.ts";
import {
  buildTelematicsDedupeKey,
  type NormalizedTelematicsSignal,
} from "../_shared/telematics-adapter.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Vary": "Origin",
  };
}

function bad(
  status: number,
  code: string,
  message: string,
  ch: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ ok: false, error: code, message }), {
    status,
    headers: { ...ch, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }
  if (req.method !== "POST") {
    return bad(405, "METHOD_NOT_ALLOWED", "POST required.", ch);
  }

  const admin = createAdminClient();

  const isServiceRole = isServiceRoleCaller(req);
  let callerUserId: string | null = null;
  if (!isServiceRole) {
    const caller = await resolveCallerContext(req, admin);
    if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
      return bad(403, "FORBIDDEN", "Elevated role required.", ch);
    }
    callerUserId = caller.userId ?? null;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return bad(400, "INVALID_JSON", "Request body must be valid JSON.", ch);
  }

  const rawBody = raw as Record<string, unknown>;
  let payload: NormalizedTelematicsSignal;
  try {
    payload = genericTelematicsAdapter.normalizeSignal(rawBody);
  } catch (err) {
    return bad(
      400,
      "VALIDATION_ERROR",
      err instanceof Error ? err.message : "validation",
      ch,
    );
  }
  const providerFilter = typeof rawBody.provider === "string" ||
      typeof rawBody.provider_key === "string" ||
      typeof rawBody.source === "string"
    ? payload.provider
    : null;

  try {
    // Resolve device → equipment → workspace. If there is no active
    // telematics_feed for this device we 404 — the caller is expected to
    // fix the feed registration rather than blindly insert stray signals.
    let feedQuery = admin
      .from("telematics_feeds")
      .select("equipment_id, workspace_id, is_active")
      .eq("device_id", payload.deviceId)
      .eq("is_active", true);

    if (providerFilter) {
      feedQuery = feedQuery.eq("provider", providerFilter);
    }
    if (payload.workspaceId) {
      feedQuery = feedQuery.eq("workspace_id", payload.workspaceId);
    }

    const { data: feeds, error: feedErr } = await feedQuery.limit(2);

    if (feedErr) throw feedErr;

    if (!feeds || feeds.length === 0) {
      return bad(
        404,
        "UNKNOWN_DEVICE",
        `No active telematics_feed for device_id ${payload.deviceId}.`,
        ch,
      );
    }

    if (feeds.length > 1) {
      return bad(
        409,
        "AMBIGUOUS_DEVICE",
        "Provider or workspace required for this device_id.",
        ch,
      );
    }

    const feedRow = feeds[0] as {
      equipment_id: string;
      workspace_id: string;
    };

    const occurredAt = payload.occurredAt;

    // Build a stable dedupe key. If the provider gave us an event id, use it
    // verbatim. Otherwise synthesize one from the event's intrinsic identity
    // so re-scans / retry storms collapse on our end.
    const dedupeKey = buildTelematicsDedupeKey(payload);

    const signalKind = payload.kind === "fault"
      ? "telematics_fault"
      : "telematics_idle";

    // Severity default: faults escalate to "high" if not specified — idle
    // tops out at "medium" since operators triage it aggregationally.
    const defaultSeverity: SignalSeverity = payload.kind === "fault"
      ? "high"
      : "medium";

    const title = payload.kind === "fault"
      ? `Fault ${payload.code ?? ""} on equipment ${feedRow.equipment_id}`
        .trim()
      : `Idle event on equipment ${feedRow.equipment_id}`;

    const ctx = {
      admin,
      callerDb: admin,
      caller: {
        authHeader: null,
        userId: callerUserId,
        role: isServiceRole ? null : "admin",
        isServiceRole,
        workspaceId: feedRow.workspace_id,
      },
      workspaceId: feedRow.workspace_id,
      requestId: crypto.randomUUID(),
      route: "/telematics-signal-ingest",
      method: "POST",
      ipInet: null,
      userAgent: null,
    } as unknown as RouterCtx;

    const signal = await ingestSignal(ctx, {
      workspaceId: feedRow.workspace_id,
      kind: signalKind,
      severity: payload.severity ?? defaultSeverity,
      source: payload.provider,
      title,
      description: payload.description ?? null,
      entityType: "equipment",
      entityId: feedRow.equipment_id,
      dedupeKey,
      occurredAt,
      payload: {
        device_id: payload.deviceId,
        event_kind: payload.kind,
        code: payload.code ?? null,
        raw: payload.raw ?? null,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, signal }),
      { status: 201, headers: { ...ch, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[telematics-signal-ingest] error:", err);
    return bad(
      500,
      "UNEXPECTED_ERROR",
      err instanceof Error ? err.message : "Unexpected error.",
      ch,
    );
  }
});
