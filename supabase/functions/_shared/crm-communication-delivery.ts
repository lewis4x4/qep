import type { RouterCtx } from "./crm-router-service.ts";
import { decryptCredential } from "./integration-crypto.ts";

type CommunicationActivityType = "email" | "sms";
type CommunicationProvider = "sendgrid" | "twilio";

interface IntegrationStatusRow {
  status: "connected" | "pending_credentials" | "error" | "demo_mode";
  credentials_encrypted: string | null;
  endpoint_url: string | null;
}

interface ContactRow {
  id: string;
  email: string | null;
  phone: string | null;
}

interface DealRow {
  primary_contact_id: string | null;
}

interface CommunicationDeliveryInput {
  activityType: CommunicationActivityType;
  sendNow: boolean;
  body: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
}

function parseCredentials(raw: string | null): Record<string, string> | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim().length > 0) {
        output[key] = value.trim();
      }
    }
    return Object.keys(output).length > 0 ? output : { raw };
  } catch {
    return { raw };
  }
}

function pickCredential(
  credentials: Record<string, string> | null,
  keys: string[],
): string | null {
  if (!credentials) return null;
  for (const key of keys) {
    const value = credentials[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function maskDestination(
  value: string,
  type: CommunicationActivityType,
): string {
  if (type === "email") {
    const [local, domain] = value.split("@");
    if (!local || !domain) return "masked";
    const head = local.slice(0, 1);
    return `${head}***@${domain}`;
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `***-***-${digits.slice(-4)}`;
}

function manualDeliveryMetadata(params: {
  provider: CommunicationProvider;
  reasonCode: string;
  message: string;
  attemptedAt: string;
}): Record<string, unknown> {
  return {
    attempted: false,
    mode: "manual",
    provider: params.provider,
    status: "manual_logged",
    reasonCode: params.reasonCode,
    message: params.message,
    attemptedAt: params.attemptedAt,
  };
}

function failedDeliveryMetadata(params: {
  provider: CommunicationProvider;
  reasonCode: string;
  message: string;
  attemptedAt: string;
  destination: string;
}): Record<string, unknown> {
  return {
    attempted: true,
    mode: "live",
    provider: params.provider,
    status: "failed",
    reasonCode: params.reasonCode,
    message: params.message,
    attemptedAt: params.attemptedAt,
    destination: params.destination,
  };
}

function sentDeliveryMetadata(params: {
  provider: CommunicationProvider;
  attemptedAt: string;
  destination: string;
  externalMessageId: string | null;
}): Record<string, unknown> {
  return {
    attempted: true,
    mode: "live",
    provider: params.provider,
    status: "sent",
    attemptedAt: params.attemptedAt,
    destination: params.destination,
    externalMessageId: params.externalMessageId,
  };
}

async function fetchContactById(
  ctx: RouterCtx,
  contactId: string,
): Promise<ContactRow | null> {
  const { data, error } = await ctx.admin
    .from("crm_contacts")
    .select("id, email, phone")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle<ContactRow>();

  if (error || !data) return null;
  return data;
}

async function resolveDeliveryContact(
  ctx: RouterCtx,
  input: CommunicationDeliveryInput,
): Promise<ContactRow | null> {
  if (input.contactId) {
    return fetchContactById(ctx, input.contactId);
  }

  if (input.dealId) {
    const { data: deal, error: dealError } = await ctx.admin
      .from("crm_deals")
      .select("primary_contact_id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", input.dealId)
      .is("deleted_at", null)
      .maybeSingle<DealRow>();

    if (dealError || !deal?.primary_contact_id) return null;
    return fetchContactById(ctx, deal.primary_contact_id);
  }

  if (input.companyId) {
    const { data, error } = await ctx.admin
      .from("crm_contacts")
      .select("id, email, phone")
      .eq("workspace_id", ctx.workspaceId)
      .eq("primary_company_id", input.companyId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<ContactRow>();

    if (error || !data) return null;
    return data;
  }

  return null;
}

async function sendViaSendGrid(params: {
  apiKey: string;
  endpointUrl: string | null;
  toEmail: string;
  fromEmail: string;
  fromName: string | null;
  body: string;
}): Promise<
  { ok: true; externalMessageId: string | null } | {
    ok: false;
    reasonCode: string;
    message: string;
  }
> {
  const baseUrl = params.endpointUrl?.trim() || "https://api.sendgrid.com";
  const response = await fetch(`${baseUrl}/v3/mail/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: params.toEmail }],
        subject: "QEP QRM update",
      }],
      from: params.fromName
        ? { email: params.fromEmail, name: params.fromName }
        : { email: params.fromEmail },
      content: [{ type: "text/plain", value: params.body }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      reasonCode: "sendgrid_request_failed",
      message: `SendGrid rejected request (${response.status}). ${
        text.slice(0, 240)
      }`,
    };
  }

  return {
    ok: true,
    externalMessageId: response.headers.get("x-message-id"),
  };
}

async function sendViaTwilio(params: {
  accountSid: string;
  authToken: string;
  endpointUrl: string | null;
  toPhone: string;
  fromNumber: string | null;
  messagingServiceSid: string | null;
  body: string;
}): Promise<
  { ok: true; externalMessageId: string | null } | {
    ok: false;
    reasonCode: string;
    message: string;
  }
> {
  const baseUrl = params.endpointUrl?.trim() || "https://api.twilio.com";
  const payload = new URLSearchParams({
    To: params.toPhone,
    Body: params.body,
  });
  if (params.messagingServiceSid) {
    payload.set("MessagingServiceSid", params.messagingServiceSid);
  } else if (params.fromNumber) {
    payload.set("From", params.fromNumber);
  } else {
    return {
      ok: false,
      reasonCode: "missing_sender",
      message:
        "Twilio sender is missing. Configure from_number or messaging_service_sid.",
    };
  }

  const response = await fetch(
    `${baseUrl}/2010-04-01/Accounts/${params.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${
          btoa(`${params.accountSid}:${params.authToken}`)
        }`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      reasonCode: "twilio_request_failed",
      message: `Twilio rejected request (${response.status}). ${
        text.slice(0, 240)
      }`,
    };
  }

  const json = await response.json().catch(() => null) as
    | { sid?: string }
    | null;
  return {
    ok: true,
    externalMessageId: json?.sid ?? null,
  };
}

export async function deliverCrmCommunication(
  ctx: RouterCtx,
  input: CommunicationDeliveryInput,
): Promise<Record<string, unknown>> {
  const provider: CommunicationProvider = input.activityType === "email"
    ? "sendgrid"
    : "twilio";
  const attemptedAt = new Date().toISOString();

  if (!input.sendNow) {
    return manualDeliveryMetadata({
      provider,
      reasonCode: "send_not_requested",
      message: "Saved as timeline activity only.",
      attemptedAt,
    });
  }

  if (!input.body || input.body.trim().length === 0) {
    return manualDeliveryMetadata({
      provider,
      reasonCode: "missing_body",
      message: "Message body is required for live delivery.",
      attemptedAt,
    });
  }

  const contact = await resolveDeliveryContact(ctx, input);
  if (!contact) {
    return manualDeliveryMetadata({
      provider,
      reasonCode: "missing_recipient_contact",
      message: "No recipient contact found for this activity target.",
      attemptedAt,
    });
  }

  const rawDestination = input.activityType === "email"
    ? contact.email?.trim() ?? null
    : contact.phone?.trim() ?? null;
  if (!rawDestination) {
    return manualDeliveryMetadata({
      provider,
      reasonCode: "missing_recipient_address",
      message: `Recipient ${input.activityType} destination is missing.`,
      attemptedAt,
    });
  }
  const destination = maskDestination(rawDestination, input.activityType);

  const { data: statusRow, error: statusError } = await ctx.admin
    .from("integration_status")
    .select("status, credentials_encrypted, endpoint_url")
    .eq("workspace_id", ctx.workspaceId)
    .eq("integration_key", provider)
    .maybeSingle<IntegrationStatusRow>();

  if (statusError || !statusRow) {
    return manualDeliveryMetadata({
      provider,
      reasonCode: "integration_not_configured",
      message: `${provider} is not configured for this workspace.`,
      attemptedAt,
    });
  }

  if (statusRow.status !== "connected" || !statusRow.credentials_encrypted) {
    return manualDeliveryMetadata({
      provider,
      reasonCode: "integration_not_connected",
      message: `${provider} is not connected. Activity was logged only.`,
      attemptedAt,
    });
  }

  let credentials: Record<string, string> | null = null;
  try {
    credentials = parseCredentials(
      await decryptCredential(statusRow.credentials_encrypted, provider),
    );
  } catch {
    return failedDeliveryMetadata({
      provider,
      reasonCode: "credential_decrypt_failed",
      message: "Unable to decrypt integration credentials.",
      attemptedAt,
      destination,
    });
  }

  if (!credentials) {
    return manualDeliveryMetadata({
      provider,
      reasonCode: "missing_credentials",
      message: "No integration credentials available for delivery.",
      attemptedAt,
    });
  }

  if (provider === "sendgrid") {
    const apiKey = pickCredential(credentials, [
      "api_key",
      "sendgrid_api_key",
      "token",
      "raw",
    ]);
    const fromEmail = pickCredential(credentials, [
      "from_email",
      "sender_email",
      "from",
    ]);
    const fromName = pickCredential(credentials, ["from_name", "sender_name"]);

    if (!apiKey || !fromEmail) {
      return manualDeliveryMetadata({
        provider,
        reasonCode: "missing_sender",
        message: "SendGrid requires api_key and from_email.",
        attemptedAt,
      });
    }

    const sendResult = await sendViaSendGrid({
      apiKey,
      endpointUrl: statusRow.endpoint_url,
      toEmail: rawDestination,
      fromEmail,
      fromName,
      body: input.body,
    });

    if (!sendResult.ok) {
      return failedDeliveryMetadata({
        provider,
        reasonCode: sendResult.reasonCode,
        message: sendResult.message,
        attemptedAt,
        destination,
      });
    }

    return sentDeliveryMetadata({
      provider,
      attemptedAt,
      destination,
      externalMessageId: sendResult.externalMessageId,
    });
  }

  const accountSid = pickCredential(credentials, ["account_sid", "sid"]);
  const authToken = pickCredential(credentials, ["auth_token", "token"]);
  const fromNumber = pickCredential(credentials, ["from_number", "from"]);
  const messagingServiceSid = pickCredential(credentials, [
    "messaging_service_sid",
  ]);

  if (!accountSid || !authToken) {
    return manualDeliveryMetadata({
      provider,
      reasonCode: "missing_credentials",
      message: "Twilio requires account_sid and auth_token.",
      attemptedAt,
    });
  }

  const sendResult = await sendViaTwilio({
    accountSid,
    authToken,
    endpointUrl: statusRow.endpoint_url,
    toPhone: rawDestination,
    fromNumber,
    messagingServiceSid,
    body: input.body,
  });

  if (!sendResult.ok) {
    return failedDeliveryMetadata({
      provider,
      reasonCode: sendResult.reasonCode,
      message: sendResult.message,
      attemptedAt,
      destination,
    });
  }

  return sentDeliveryMetadata({
    provider,
    attemptedAt,
    destination,
    externalMessageId: sendResult.externalMessageId,
  });
}
