import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type CommunicationChannel = "email" | "sms";
export type CommunicationProvider = "sendgrid" | "twilio";

export interface CommunicationContact {
  id: string;
  workspaceId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  smsOptIn: boolean;
  smsOptInAt: string | null;
  smsOptInSource: string | null;
  companyName: string | null;
}

export interface CommunicationBinding {
  provider: CommunicationProvider;
  workspaceId: string;
  endpointUrl: string | null;
  credentials: Record<string, string>;
  accountId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  defaultFromNumber: string | null;
  routeToken: string | null;
  webhookVerificationKey: string | null;
}

interface IntegrationStatusRow {
  workspace_id: string;
  endpoint_url: string | null;
  credentials_encrypted: string | null;
  config: Record<string, unknown> | null;
}

function logCredentialResolutionFailure(provider: CommunicationProvider, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[crm-communication] ${provider} credential resolution failed: ${message}`);
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseCredentialRecord(raw: string | null): Record<string, string> | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const cleaned = cleanString(value);
      if (cleaned) {
        output[key] = cleaned;
      }
    }
    return Object.keys(output).length > 0 ? output : { raw };
  } catch {
    return { raw };
  }
}

export function pickCredential(
  credentials: Record<string, string> | null,
  keys: string[],
): string | null {
  if (!credentials) return null;
  for (const key of keys) {
    const value = cleanString(credentials[key]);
    if (value) return value;
  }
  return null;
}

function readConfigValue(
  config: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  const source = config ?? {};
  for (const key of keys) {
    const segments = key.split(".");
    let cursor: unknown = source;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
        cursor = null;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    const cleaned = cleanString(cursor);
    if (cleaned) return cleaned;
  }
  return null;
}

export async function fetchCommunicationBinding(params: {
  admin: SupabaseClient;
  workspaceId: string;
  provider: CommunicationProvider;
  decryptCredential: (ciphertext: string, integrationKey: string) => Promise<string>;
}): Promise<CommunicationBinding | null> {
  const { data, error } = await params.admin
    .from("integration_status")
    .select("workspace_id, endpoint_url, credentials_encrypted, config")
    .eq("workspace_id", params.workspaceId)
    .eq("integration_key", params.provider)
    .eq("status", "connected")
    .maybeSingle<IntegrationStatusRow>();

  if (error || !data?.credentials_encrypted) {
    return null;
  }

  let decryptedCredentials: string | null = null;
  try {
    decryptedCredentials = await params.decryptCredential(
      data.credentials_encrypted,
      params.provider,
    );
  } catch (error) {
    logCredentialResolutionFailure(params.provider, error);
    return null;
  }

  const credentials = parseCredentialRecord(decryptedCredentials);
  if (!credentials) {
    return null;
  }

  const accountId = params.provider === "sendgrid"
    ? readConfigValue(data.config, ["communication_binding.account_id", "sendgrid.account_id", "account_id"])
    : pickCredential(credentials, ["account_sid", "sid"]);

  return {
    provider: params.provider,
    workspaceId: data.workspace_id,
    endpointUrl: data.endpoint_url,
    credentials,
    accountId,
    fromEmail: params.provider === "sendgrid"
      ? (
        readConfigValue(data.config, ["communication_binding.from_email", "sendgrid.from_email"]) ??
        pickCredential(credentials, ["from_email", "sender_email", "from"])
      )
      : null,
    fromName: params.provider === "sendgrid"
      ? (
        readConfigValue(data.config, ["communication_binding.from_name", "sendgrid.from_name"]) ??
        pickCredential(credentials, ["from_name", "sender_name"])
      )
      : null,
    defaultFromNumber: params.provider === "twilio"
      ? (
        readConfigValue(data.config, ["communication_binding.default_from_number", "twilio.default_from_number"]) ??
        pickCredential(credentials, ["default_from_number", "from_number", "from"])
      )
      : null,
    routeToken: readConfigValue(
      data.config,
      ["communication_binding.route_token", `${params.provider}.route_token`, "route_token"],
    ),
    webhookVerificationKey: readConfigValue(
      data.config,
      [
        "communication_binding.webhook_verification_key",
        `${params.provider}.webhook_verification_key`,
        "webhook_verification_key",
      ],
    ),
  };
}

export function interpolateCommunicationTemplate(
  template: string,
  contact: CommunicationContact,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim().toLowerCase();
    const replacements: Record<string, string | null> = {
      first_name: contact.firstName,
      lastname: contact.lastName,
      last_name: contact.lastName,
      full_name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
      company_name: contact.companyName,
    };
    return replacements[key] ?? "";
  });
}

export function computeCampaignIneligibility(
  channel: CommunicationChannel,
  contact: CommunicationContact,
  binding: CommunicationBinding | null,
): string | null {
  return computeCommunicationIneligibility(channel, contact, binding, true);
}

export function computeDirectCommunicationIneligibility(
  channel: CommunicationChannel,
  contact: CommunicationContact,
  binding: CommunicationBinding | null,
): string | null {
  return computeCommunicationIneligibility(channel, contact, binding, false);
}

function computeCommunicationIneligibility(
  channel: CommunicationChannel,
  contact: CommunicationContact,
  binding: CommunicationBinding | null,
  requireSmsConsentMetadata: boolean,
): string | null {
  if (!binding) {
    return channel === "email"
      ? "sendgrid_not_configured"
      : "twilio_not_configured";
  }

  if (channel === "email") {
    return contact.email ? null : "missing_contact_email";
  }

  if (!contact.phone) {
    return "missing_contact_phone";
  }
  if (!binding.defaultFromNumber) {
    return "missing_default_sender";
  }
  if (!contact.smsOptIn) {
    return "sms_opt_in_required";
  }
  if (requireSmsConsentMetadata && (!contact.smsOptInAt || !contact.smsOptInSource)) {
    return !contact.smsOptInAt
      ? "sms_opt_in_at_required"
      : "sms_opt_in_source_required";
  }

  return null;
}

export function summarizeBodyPreview(body: string | null): string | null {
  if (!body) return null;
  const squashed = body.replace(/\s+/g, " ").trim();
  return squashed.length > 160 ? `${squashed.slice(0, 157)}...` : squashed;
}

export function normalizePhoneNumber(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, "");
  return digits.length > 0 ? digits : null;
}
