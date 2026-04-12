import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "../_shared/dge-auth.ts";
import { emitCrmAccessDeniedAudit } from "../_shared/crm-auth-audit.ts";
import {
  completeCommunicationWebhookReceipt,
  claimCommunicationWebhookReceipt,
} from "../_shared/crm-communication-webhook-receipts.ts";
import { decryptCredential } from "../_shared/integration-crypto.ts";
import { normalizePhoneNumber, parseCredentialRecord } from "../_shared/crm-communication-helpers.ts";

interface IntegrationRow {
  workspace_id: string;
  credentials_encrypted: string | null;
  config: Record<string, unknown> | null;
}

function configValue(config: Record<string, unknown> | null | undefined, path: string): string | null {
  const segments = path.split(".");
  let cursor: unknown = config ?? {};
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" && cursor.trim().length > 0 ? cursor.trim() : null;
}

async function twilioSignatureMatches(url: string, params: URLSearchParams, authToken: string, provided: string | null): Promise<boolean> {
  if (!provided) return false;
  let payload = url;
  for (const key of [...new Set(params.keys())].sort()) {
    for (const value of params.getAll(key)) {
      payload += `${key}${value}`;
    }
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const expected = Buffer.from(digest).toString("base64");
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function mapTwilioStatus(value: string | null): "sent" | "delivered" | "failed" {
  const status = value?.trim().toLowerCase() ?? "";
  if (status === "delivered") return "delivered";
  if (["accepted", "queued", "sending", "sent"].includes(status)) return "sent";
  return "failed";
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  const admin = createAdminClient();
  const url = new URL(req.url);
  const routeToken = url.searchParams.get("rt")?.trim() ?? "";
  if (!routeToken) {
    await emitCrmAccessDeniedAudit(admin, {
      workspaceId: "unknown",
      requestId: crypto.randomUUID(),
      resource: "/functions/v1/twilio-webhook",
      reasonCode: "route_token_missing",
    });
    return new Response("Missing route token.", { status: 403 });
  }

  const bodyText = await req.text();
  const params = new URLSearchParams(bodyText);
  const { data: integrations, error } = await admin
    .from("integration_status")
    .select("workspace_id, credentials_encrypted, config")
    .eq("integration_key", "twilio")
    .eq("status", "connected");
  if (error) return new Response("Integration lookup failed.", { status: 500 });

  const integration = (integrations as IntegrationRow[]).find((row) =>
    configValue(row.config, "communication_binding.route_token") === routeToken ||
    configValue(row.config, "twilio.route_token") === routeToken ||
    configValue(row.config, "route_token") === routeToken
  );
  if (!integration?.credentials_encrypted) {
    await emitCrmAccessDeniedAudit(admin, {
      workspaceId: "unknown",
      requestId: crypto.randomUUID(),
      resource: "/functions/v1/twilio-webhook",
      reasonCode: "workspace_unknown_or_rejected",
    });
    return new Response("Unknown route token.", { status: 403 });
  }

  const credentials = parseCredentialRecord(await decryptCredential(integration.credentials_encrypted, "twilio"));
  const authToken = credentials?.auth_token ?? credentials?.token ?? null;
  const accountSid = credentials?.account_sid ?? credentials?.sid ?? null;
  const defaultFromNumber =
    configValue(integration.config, "communication_binding.default_from_number") ??
    configValue(integration.config, "twilio.default_from_number") ??
    credentials?.default_from_number ??
    credentials?.from_number ??
    credentials?.from ??
    null;

  const signature = req.headers.get("X-Twilio-Signature");
  if (!authToken || !(await twilioSignatureMatches(req.url, params, authToken, signature))) {
    await emitCrmAccessDeniedAudit(admin, {
      workspaceId: integration.workspace_id,
      requestId: crypto.randomUUID(),
      resource: "/functions/v1/twilio-webhook",
      reasonCode: "invalid_provider_signature",
    });
    return new Response("Invalid signature.", { status: 403 });
  }

  if (
    params.get("AccountSid") !== accountSid ||
    normalizePhoneNumber(params.get("From")) !== normalizePhoneNumber(defaultFromNumber)
  ) {
    await emitCrmAccessDeniedAudit(admin, {
      workspaceId: integration.workspace_id,
      requestId: crypto.randomUUID(),
      resource: "/functions/v1/twilio-webhook",
      reasonCode: "workspace_unknown_or_rejected",
      metadata: { accountSid: params.get("AccountSid"), from: params.get("From") },
    });
    return new Response("Workspace binding mismatch.", { status: 403 });
  }

  const messageSid = params.get("MessageSid")?.trim() ?? "";
  const messageStatus = params.get("MessageStatus")?.trim() ?? "";
  const eventId = `${messageSid}:${messageStatus || "unknown"}`;
  const receipt = await claimCommunicationWebhookReceipt({
    admin,
    workspaceId: integration.workspace_id,
    provider: "twilio",
    eventId,
    payloadHash: await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bodyText)).then((bytes) =>
      Buffer.from(new Uint8Array(bytes)).toString("hex")
    ),
    routeBindingKey: `${accountSid}:${normalizePhoneNumber(defaultFromNumber) ?? ""}`,
  });
  if (receipt.alreadyProcessed) {
    return new Response("Duplicate webhook ignored.", { status: 200 });
  }

  const { data: message } = await admin
    .from("crm_communication_messages")
    .select("id, activity_id, metadata")
    .eq("workspace_id", integration.workspace_id)
    .eq("provider", "twilio")
    .eq("provider_message_id", messageSid)
    .maybeSingle<{ id: string; activity_id: string | null; metadata: Record<string, unknown> | null }>();

  if (message) {
    const nextStatus = mapTwilioStatus(messageStatus);
    await admin
      .from("crm_communication_messages")
      .update({
        status: nextStatus,
        metadata: {
          ...(message.metadata ?? {}),
          twilioStatus: messageStatus || null,
          updatedAt: new Date().toISOString(),
        },
      })
      .eq("id", message.id);

    if (message.activity_id) {
      const { data: activity } = await admin
        .from("crm_activities")
        .select("metadata")
        .eq("workspace_id", integration.workspace_id)
        .eq("id", message.activity_id)
        .maybeSingle<{ metadata: Record<string, unknown> | null }>();
      const communication =
        activity?.metadata?.communication &&
          typeof activity.metadata.communication === "object" &&
          !Array.isArray(activity.metadata.communication)
          ? activity.metadata.communication as Record<string, unknown>
          : {};
      await admin
        .from("crm_activities")
        .update({
          metadata: {
            ...(activity?.metadata ?? {}),
            communication: {
              ...communication,
              status: nextStatus,
              lastWebhookStatus: messageStatus || null,
            },
          },
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("id", message.activity_id);
    }
  }

  await completeCommunicationWebhookReceipt(admin, receipt.id);
  return new Response("ok", { status: 200 });
});
