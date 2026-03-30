import { createClient } from "jsr:@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  emitCrmAccessDeniedAudit,
  extractRequestIp,
} from "../_shared/crm-auth-audit.ts";
import { errorResponse } from "../_shared/crm-error.ts";
import {
  type HubSpotEvent,
  processHubSpotWebhookEvent,
} from "../_shared/hubspot-webhook-event-processor.ts";
import { resolveHubSpotRuntimeConfig } from "../_shared/hubspot-runtime-config.ts";

const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

Deno.serve(async (req): Promise<Response> => {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const runtimeConfig = await resolveHubSpotRuntimeConfig(supabase, "default");
  if (!runtimeConfig) {
    console.error("[hubspot-webhook] runtime OAuth config missing");
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "HubSpot webhook configuration is unavailable.",
    );
  }

  const signature = req.headers.get("X-HubSpot-Signature-v3");
  const requestTimestamp = req.headers.get("X-HubSpot-Request-Timestamp");
  const body = await req.text();

  if (!signature || !requestTimestamp) {
    await emitCrmAccessDeniedAudit(supabase, {
      workspaceId: "default",
      requestId,
      resource: "/functions/v1/hubspot-webhook",
      reasonCode: "missing_signature_headers",
      ipInet: extractRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Missing HubSpot signature headers.",
    );
  }

  const clientSecret = runtimeConfig.clientSecret;
  const sourceString = `${req.method}${req.url}${body}${requestTimestamp}`;
  const expectedSig = createHmac("sha256", clientSecret)
    .update(sourceString)
    .digest("base64");

  if (!signaturesMatch(expectedSig, signature)) {
    await emitCrmAccessDeniedAudit(supabase, {
      workspaceId: "default",
      requestId,
      resource: "/functions/v1/hubspot-webhook",
      reasonCode: "invalid_signature",
      ipInet: extractRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    return errorResponse(401, "UNAUTHORIZED", "Invalid HubSpot signature.");
  }

  const tsMs = Number.parseInt(requestTimestamp, 10);
  const skewMs = Math.abs(Date.now() - tsMs);
  if (Number.isNaN(tsMs) || skewMs > WEBHOOK_MAX_AGE_MS) {
    await emitCrmAccessDeniedAudit(supabase, {
      workspaceId: "default",
      requestId,
      resource: "/functions/v1/hubspot-webhook",
      reasonCode: "timestamp_outside_skew_window",
      ipInet: extractRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
      metadata: { request_timestamp: requestTimestamp },
    });
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Webhook timestamp outside allowed skew window.",
    );
  }

  let events: HubSpotEvent[];
  try {
    const parsed = JSON.parse(body) as HubSpotEvent | HubSpotEvent[];
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return errorResponse(
      400,
      "INVALID_JSON",
      "Webhook payload must be valid JSON.",
    );
  }

  let hasFatalError = false;
  for (const event of events) {
    try {
      await processHubSpotWebhookEvent(supabase, event);
    } catch (error) {
      hasFatalError = true;
      console.error("[hubspot-webhook] fatal processing error", {
        portalId: event.portalId,
        objectId: event.objectId,
        subscriptionType: event.subscriptionType,
        propertyName: event.propertyName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (hasFatalError) {
    return errorResponse(
      500,
      "WEBHOOK_PROCESSING_FAILED",
      "One or more events failed to process.",
    );
  }

  return new Response("OK", { status: 200 });
});
