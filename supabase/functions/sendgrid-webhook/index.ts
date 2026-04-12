import { Buffer } from "node:buffer";
import { createAdminClient } from "../_shared/dge-auth.ts";
import { emitCrmAccessDeniedAudit } from "../_shared/crm-auth-audit.ts";
import {
  completeCommunicationWebhookReceipt,
  claimCommunicationWebhookReceipt,
} from "../_shared/crm-communication-webhook-receipts.ts";

interface IntegrationRow {
  workspace_id: string;
  config: Record<string, unknown> | null;
}

interface SendGridEvent {
  event?: string;
  email?: string;
  timestamp?: number;
  sg_event_id?: string;
  sg_message_id?: string;
  from?: string;
  custom_args?: Record<string, unknown>;
  unique_args?: Record<string, unknown>;
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

function readCustomArg(event: SendGridEvent, key: string): string | null {
  const value = event.custom_args?.[key] ?? event.unique_args?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function verifySendGridSignature(publicKeyBase64: string | null, timestamp: string | null, rawBody: string, signatureBase64: string | null): Promise<boolean> {
  if (!publicKeyBase64 || !timestamp || !signatureBase64) return false;
  const keyBytes = Uint8Array.from(Buffer.from(publicKeyBase64, "base64"));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"]);
  const payload = new TextEncoder().encode(`${timestamp}${rawBody}`);
  const signature = Uint8Array.from(Buffer.from(signatureBase64, "base64"));
  return crypto.subtle.verify("Ed25519", key, signature, payload);
}

function mapSendGridStatus(eventName: string | null): "sent" | "delivered" | "failed" {
  const name = eventName?.trim().toLowerCase() ?? "";
  if (name === "delivered") return "delivered";
  if (["processed", "deferred", "open", "click"].includes(name)) return "sent";
  return "failed";
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  const admin = createAdminClient();
  const rawBody = await req.text();
  let events: SendGridEvent[];
  try {
    events = JSON.parse(rawBody) as SendGridEvent[];
  } catch {
    return new Response("Invalid payload.", { status: 400 });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return new Response("Invalid payload.", { status: 400 });
  }

  const routeToken = readCustomArg(events[0], "route_token");
  if (!routeToken) {
    await emitCrmAccessDeniedAudit(admin, {
      workspaceId: "unknown",
      requestId: crypto.randomUUID(),
      resource: "/functions/v1/sendgrid-webhook",
      reasonCode: "route_token_missing",
    });
    return new Response("Missing route token.", { status: 403 });
  }

  const { data: integrations, error } = await admin
    .from("integration_status")
    .select("workspace_id, config")
    .eq("integration_key", "sendgrid")
    .eq("status", "connected");
  if (error) return new Response("Integration lookup failed.", { status: 500 });

  const integration = (integrations as IntegrationRow[]).find((row) =>
    configValue(row.config, "communication_binding.route_token") === routeToken ||
    configValue(row.config, "sendgrid.route_token") === routeToken ||
    configValue(row.config, "route_token") === routeToken
  );
  if (!integration) {
    await emitCrmAccessDeniedAudit(admin, {
      workspaceId: "unknown",
      requestId: crypto.randomUUID(),
      resource: "/functions/v1/sendgrid-webhook",
      reasonCode: "workspace_unknown_or_rejected",
    });
    return new Response("Unknown route token.", { status: 403 });
  }

  const publicKey =
    configValue(integration.config, "communication_binding.webhook_verification_key") ??
    configValue(integration.config, "sendgrid.webhook_verification_key") ??
    configValue(integration.config, "webhook_verification_key");
  const timestamp = req.headers.get("X-Twilio-Email-Event-Webhook-Timestamp");
  const signature = req.headers.get("X-Twilio-Email-Event-Webhook-Signature");
  if (!(await verifySendGridSignature(publicKey, timestamp, rawBody, signature))) {
    await emitCrmAccessDeniedAudit(admin, {
      workspaceId: integration.workspace_id,
      requestId: crypto.randomUUID(),
      resource: "/functions/v1/sendgrid-webhook",
      reasonCode: "invalid_provider_signature",
    });
    return new Response("Invalid signature.", { status: 403 });
  }

  const bindingAccountId =
    configValue(integration.config, "communication_binding.account_id") ??
    configValue(integration.config, "sendgrid.account_id") ??
    configValue(integration.config, "account_id");
  const bindingFromEmail =
    configValue(integration.config, "communication_binding.from_email") ??
    configValue(integration.config, "sendgrid.from_email") ??
    configValue(integration.config, "from_email");

  for (const event of events) {
    const eventRouteToken = readCustomArg(event, "route_token");
    const providerAccountId = readCustomArg(event, "provider_account_id");
    const fromEmail = readCustomArg(event, "from_email") ?? event.from ?? null;
    if (eventRouteToken !== routeToken || providerAccountId !== bindingAccountId || fromEmail !== bindingFromEmail) {
      await emitCrmAccessDeniedAudit(admin, {
        workspaceId: integration.workspace_id,
        requestId: crypto.randomUUID(),
        resource: "/functions/v1/sendgrid-webhook",
        reasonCode: "workspace_unknown_or_rejected",
        metadata: { providerAccountId, fromEmail },
      });
      continue;
    }

    const eventId = event.sg_event_id ?? `${event.sg_message_id ?? "unknown"}:${event.event ?? "unknown"}:${String(event.timestamp ?? "")}:${event.email ?? ""}`;
    const receipt = await claimCommunicationWebhookReceipt({
      admin,
      workspaceId: integration.workspace_id,
      provider: "sendgrid",
      eventId,
      payloadHash: await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(event))).then((bytes) =>
        Buffer.from(new Uint8Array(bytes)).toString("hex")
      ),
      routeBindingKey: `${bindingAccountId ?? ""}:${bindingFromEmail ?? ""}`,
    });
    if (receipt.alreadyProcessed) {
      continue;
    }

    const messageId = readCustomArg(event, "message_id");
    const query = admin
      .from("crm_communication_messages")
      .select("id, activity_id, metadata")
      .eq("workspace_id", integration.workspace_id)
      .eq("provider", "sendgrid");
    const { data: message } = messageId
      ? await query.eq("id", messageId).maybeSingle<{ id: string; activity_id: string | null; metadata: Record<string, unknown> | null }>()
      : await query.eq("provider_message_id", event.sg_message_id ?? "").maybeSingle<{ id: string; activity_id: string | null; metadata: Record<string, unknown> | null }>();

    if (message) {
      const nextStatus = mapSendGridStatus(event.event ?? null);
      await admin
        .from("crm_communication_messages")
        .update({
          status: nextStatus,
          metadata: {
            ...(message.metadata ?? {}),
            sendgridEvent: event.event ?? null,
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
                lastWebhookStatus: event.event ?? null,
              },
            },
          })
          .eq("workspace_id", integration.workspace_id)
          .eq("id", message.activity_id);
      }
    }

    await completeCommunicationWebhookReceipt(admin, receipt.id);
  }

  return new Response("ok", { status: 200 });
});
