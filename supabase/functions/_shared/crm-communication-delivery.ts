import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { RouterCtx } from "./crm-router-service.ts";
import { decryptCredential } from "./integration-crypto.ts";
import {
  type CommunicationBinding,
  type CommunicationChannel,
  type CommunicationContact,
  type CommunicationProvider,
  computeCampaignIneligibility,
  computeDirectCommunicationIneligibility,
  fetchCommunicationBinding,
  interpolateCommunicationTemplate,
  normalizePhoneNumber,
  pickCredential,
  summarizeBodyPreview,
} from "./crm-communication-helpers.ts";

interface ContactRow {
  id: string;
  workspace_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  sms_opt_in: boolean | null;
  sms_opt_in_at: string | null;
  sms_opt_in_source: string | null;
  company_name: string | null;
}

interface DealRow {
  primary_contact_id: string | null;
}

export interface CommunicationDeliveryInput {
  activityId: string;
  activityType: CommunicationChannel;
  sendNow: boolean;
  body: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  campaignId?: string | null;
}

function maskDestination(value: string, type: CommunicationChannel): string {
  if (type === "email") {
    const [local, domain] = value.split("@");
    return local && domain ? `${local.slice(0, 1)}***@${domain}` : "masked";
  }
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "****";
}

function manualDeliveryMetadata(
  provider: CommunicationProvider,
  reasonCode: string,
  message: string,
  attemptedAt: string,
): Record<string, unknown> {
  return {
    attempted: false,
    mode: "manual",
    provider,
    status: "manual_logged",
    reasonCode,
    message,
    attemptedAt,
  };
}

function failedDeliveryMetadata(
  provider: CommunicationProvider,
  reasonCode: string,
  message: string,
  attemptedAt: string,
  destination: string,
  messageId: string | null,
): Record<string, unknown> {
  return {
    attempted: true,
    mode: "live",
    provider,
    status: "failed",
    reasonCode,
    message,
    attemptedAt,
    destination,
    messageId,
  };
}

function sentDeliveryMetadata(
  provider: CommunicationProvider,
  attemptedAt: string,
  destination: string,
  externalMessageId: string | null,
  messageId: string,
): Record<string, unknown> {
  return {
    attempted: true,
    mode: "live",
    provider,
    status: "sent",
    attemptedAt,
    destination,
    externalMessageId,
    messageId,
  };
}

function toCommunicationContact(row: ContactRow): CommunicationContact {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    title: row.title,
    smsOptIn: row.sms_opt_in === true,
    smsOptInAt: row.sms_opt_in_at,
    smsOptInSource: row.sms_opt_in_source,
    companyName: row.company_name,
  };
}

async function fetchContactById(
  ctx: RouterCtx,
  contactId: string,
): Promise<CommunicationContact | null> {
  return fetchContactByIdWithClient(
    ctx.admin,
    ctx.workspaceId,
    contactId,
  );
}

async function fetchContactByIdWithClient(
  client: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<CommunicationContact | null> {
  const { data, error } = await client
    .from("crm_contacts")
    .select(
      "id, workspace_id, first_name, last_name, email, phone, title, sms_opt_in, sms_opt_in_at, sms_opt_in_source, crm_companies(name)",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;
  const companyName =
    data.crm_companies && typeof data.crm_companies === "object" &&
      !Array.isArray(data.crm_companies)
      ? ((data.crm_companies as { name?: unknown }).name as
        | string
        | undefined) ?? null
      : null;

  return toCommunicationContact({
    ...(data as Omit<ContactRow, "company_name">),
    company_name: companyName,
  });
}

function getCommunicationAuthorizationClient(ctx: RouterCtx): SupabaseClient {
  return ctx.caller.isServiceRole ? ctx.admin : ctx.callerDb;
}

async function resolveAuthorizedContactId(
  ctx: RouterCtx,
  input: Pick<CommunicationDeliveryInput, "contactId" | "companyId" | "dealId">,
): Promise<string | null> {
  const client = getCommunicationAuthorizationClient(ctx);

  if (input.contactId) {
    const { data, error } = await client
      .from("crm_contacts")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", input.contactId)
      .is("deleted_at", null)
      .maybeSingle<{ id: string }>();
    if (error || !data?.id) return null;
    return data.id;
  }

  if (input.dealId) {
    const { data, error } = await client
      .from("crm_deals")
      .select("primary_contact_id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", input.dealId)
      .is("deleted_at", null)
      .maybeSingle<DealRow>();
    if (error || !data?.primary_contact_id) return null;
    return data.primary_contact_id;
  }

  if (input.companyId) {
    const { data, error } = await client
      .from("crm_contacts")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("primary_company_id", input.companyId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (error || !data?.id) return null;
    return data.id;
  }

  return null;
}

export async function resolveDeliveryContact(
  ctx: RouterCtx,
  input: Pick<CommunicationDeliveryInput, "contactId" | "companyId" | "dealId">,
): Promise<CommunicationContact | null> {
  const authorizedContactId = await resolveAuthorizedContactId(ctx, input);
  if (!authorizedContactId) return null;
  return fetchContactById(ctx, authorizedContactId);
}

async function createMessageRecord(
  ctx: RouterCtx,
  input: {
    contact: CommunicationContact;
    activityId: string;
    channel: CommunicationChannel;
    provider: CommunicationProvider;
    occurredAt: string;
    body: string;
    campaignId?: string | null;
    createdBy: string | null;
  },
): Promise<string> {
  const { data, error } = await ctx.admin
    .from("crm_communication_messages")
    .insert({
      workspace_id: ctx.workspaceId,
      activity_id: input.activityId,
      contact_id: input.contact.id,
      channel: input.channel,
      direction: "outbound",
      provider: input.provider,
      status: "pending",
      body_preview: summarizeBodyPreview(input.body),
      campaign_id: input.campaignId ?? null,
      occurred_at: input.occurredAt,
      created_by: input.createdBy,
      metadata: {},
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(
      `Failed to create communication message row: ${
        error?.message ?? "unknown error"
      }`,
    );
  }
  return data.id;
}

async function updateMessageRecord(
  ctx: RouterCtx,
  messageId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const { error } = await ctx.admin
    .from("crm_communication_messages")
    .update(updates)
    .eq("id", messageId)
    .eq("workspace_id", ctx.workspaceId);
  if (error) {
    throw new Error(
      `Failed to update communication message row: ${error.message}`,
    );
  }
}

async function sendViaSendGrid(
  params: {
    binding: CommunicationBinding;
    body: string;
    toEmail: string;
    activityId: string;
    messageId: string;
  },
): Promise<
  { ok: true; externalMessageId: string | null } | {
    ok: false;
    reasonCode: string;
    message: string;
  }
> {
  const apiKey = pickCredential(params.binding.credentials, [
    "api_key",
    "sendgrid_api_key",
    "token",
    "raw",
  ]);
  if (!apiKey || !params.binding.fromEmail) {
    return {
      ok: false,
      reasonCode: "missing_sender",
      message: "SendGrid requires api_key and from_email.",
    };
  }

  const response = await fetch(
    `${
      params.binding.endpointUrl?.trim() || "https://api.sendgrid.com"
    }/v3/mail/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: params.toEmail }],
          subject: "QEP CRM update",
          custom_args: {
            activity_id: params.activityId,
            message_id: params.messageId,
            route_token: params.binding.routeToken,
            provider_account_id: params.binding.accountId,
            from_email: params.binding.fromEmail,
          },
        }],
        from: params.binding.fromName
          ? { email: params.binding.fromEmail, name: params.binding.fromName }
          : { email: params.binding.fromEmail },
        content: [{ type: "text/plain", value: params.body }],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

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

  return { ok: true, externalMessageId: response.headers.get("x-message-id") };
}

async function sendViaTwilio(
  params: { binding: CommunicationBinding; body: string; toPhone: string },
): Promise<
  { ok: true; externalMessageId: string | null } | {
    ok: false;
    reasonCode: string;
    message: string;
  }
> {
  const accountSid = pickCredential(params.binding.credentials, [
    "account_sid",
    "sid",
  ]);
  const authToken = pickCredential(params.binding.credentials, [
    "auth_token",
    "token",
  ]);
  const defaultFromNumber = params.binding.defaultFromNumber;
  if (!accountSid || !authToken) {
    return {
      ok: false,
      reasonCode: "missing_credentials",
      message: "Twilio requires account_sid and auth_token.",
    };
  }
  if (!defaultFromNumber) {
    return {
      ok: false,
      reasonCode: "missing_sender",
      message: "Twilio requires a workspace default_from_number.",
    };
  }

  const callbackBase = Deno.env.get("SUPABASE_URL");
  const statusCallbackUrl = callbackBase && params.binding.routeToken
    ? `${callbackBase}/functions/v1/twilio-webhook?rt=${
      encodeURIComponent(params.binding.routeToken)
    }`
    : null;
  const payload = new URLSearchParams({
    To: params.toPhone,
    From: defaultFromNumber,
    Body: params.body,
  });
  if (statusCallbackUrl) payload.set("StatusCallback", statusCallbackUrl);

  const response = await fetch(
    `${
      params.binding.endpointUrl?.trim() || "https://api.twilio.com"
    }/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
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
  return { ok: true, externalMessageId: json?.sid ?? null };
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
    return manualDeliveryMetadata(
      provider,
      "send_not_requested",
      "Saved as timeline activity only.",
      attemptedAt,
    );
  }
  if (!input.body?.trim()) {
    return manualDeliveryMetadata(
      provider,
      "missing_body",
      "Message body is required for live delivery.",
      attemptedAt,
    );
  }

  const contact = await resolveDeliveryContact(ctx, input);
  if (!contact) {
    return manualDeliveryMetadata(
      provider,
      "missing_recipient_contact",
      "No recipient contact found for this activity target.",
      attemptedAt,
    );
  }

  const rawDestination = input.activityType === "email"
    ? contact.email?.trim() ?? null
    : normalizePhoneNumber(contact.phone);
  if (!rawDestination) {
    return manualDeliveryMetadata(
      provider,
      "missing_recipient_address",
      `Recipient ${input.activityType} destination is missing.`,
      attemptedAt,
    );
  }

  const binding = await fetchCommunicationBinding({
    admin: ctx.admin,
    workspaceId: ctx.workspaceId,
    provider,
    decryptCredential,
  });
  if (!binding) {
    return manualDeliveryMetadata(
      provider,
      "integration_not_connected",
      `${provider} is not connected. Activity was logged only.`,
      attemptedAt,
    );
  }

  const ineligibility = input.campaignId
    ? computeCampaignIneligibility(input.activityType, contact, binding)
    : computeDirectCommunicationIneligibility(
      input.activityType,
      contact,
      binding,
    );
  if (ineligibility) {
    return manualDeliveryMetadata(
      provider,
      ineligibility,
      input.activityType === "email"
        ? "Recipient email is missing or integration is unavailable."
        : "Recipient phone or SMS consent is missing, or Twilio is unavailable.",
      attemptedAt,
    );
  }

  const renderedBody = interpolateCommunicationTemplate(input.body, contact)
    .trim();
  if (!renderedBody) {
    return manualDeliveryMetadata(
      provider,
      "missing_body",
      "Message body is required for live delivery.",
      attemptedAt,
    );
  }

  const messageId = await createMessageRecord(ctx, {
    contact,
    activityId: input.activityId,
    channel: input.activityType,
    provider,
    occurredAt: attemptedAt,
    body: renderedBody,
    campaignId: input.campaignId ?? null,
    createdBy: ctx.caller.userId,
  });
  const destination = maskDestination(rawDestination, input.activityType);

  const sendResult = provider === "sendgrid"
    ? await sendViaSendGrid({
      binding,
      body: renderedBody,
      toEmail: rawDestination,
      activityId: input.activityId,
      messageId,
    })
    : await sendViaTwilio({
      binding,
      body: renderedBody,
      toPhone: rawDestination,
    });

  if (!sendResult.ok) {
    await updateMessageRecord(ctx, messageId, {
      status: "failed",
      failure_code: sendResult.reasonCode,
      metadata: { destination, message: sendResult.message },
    });
    return failedDeliveryMetadata(
      provider,
      sendResult.reasonCode,
      sendResult.message,
      attemptedAt,
      destination,
      messageId,
    );
  }

  await updateMessageRecord(ctx, messageId, {
    status: "sent",
    provider_message_id: sendResult.externalMessageId,
    metadata: { destination },
  });

  return sentDeliveryMetadata(
    provider,
    attemptedAt,
    destination,
    sendResult.externalMessageId,
    messageId,
  );
}
