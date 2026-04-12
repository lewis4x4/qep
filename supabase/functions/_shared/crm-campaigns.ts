import type { RouterCtx } from "./crm-router-service.ts";
import { deliverCrmCommunication } from "./crm-communication-delivery.ts";
import {
  computeCampaignIneligibility,
  fetchCommunicationBinding,
  interpolateCommunicationTemplate,
  type CommunicationChannel,
  type CommunicationContact,
} from "./crm-communication-helpers.ts";
import { decryptCredential } from "./integration-crypto.ts";

export interface CampaignPayload {
  name?: string;
  channel?: CommunicationChannel;
  templateId?: string | null;
  audienceContactIds?: string[];
  archive?: boolean;
}

interface CampaignRow {
  id: string;
  name: string;
  channel: CommunicationChannel;
  template_id: string | null;
  audience_snapshot: Record<string, unknown>;
  state: "draft" | "running" | "completed" | "cancelled";
  execution_summary: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TemplateRow {
  id: string;
  body: string;
}

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
  crm_companies: { name?: string } | null;
}

function cleanText(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toAudienceSnapshot(contactIds: string[]): Record<string, unknown> {
  return {
    contactIds: Array.from(new Set(contactIds.map((id) => id.trim()).filter((id) => id.length > 0))),
  };
}

function readAudienceContactIds(snapshot: Record<string, unknown>): string[] {
  return Array.isArray(snapshot.contactIds)
    ? snapshot.contactIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
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
    companyName: row.crm_companies?.name ?? null,
  };
}

async function fetchCampaignContacts(ctx: RouterCtx, contactIds: string[]): Promise<CommunicationContact[]> {
  if (contactIds.length === 0) return [];
  const { data, error } = await ctx.admin
    .from("crm_contacts")
    .select("id, workspace_id, first_name, last_name, email, phone, title, sms_opt_in, sms_opt_in_at, sms_opt_in_source, crm_companies(name)")
    .eq("workspace_id", ctx.workspaceId)
    .in("id", contactIds)
    .is("deleted_at", null);

  if (error) throw error;
  return ((data ?? []) as ContactRow[]).map(toCommunicationContact);
}

export async function listCampaigns(ctx: RouterCtx): Promise<unknown[]> {
  const { data, error } = await ctx.admin
    .from("crm_campaigns")
    .select("id, name, channel, template_id, audience_snapshot, state, execution_summary, created_by, created_at, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createCampaign(ctx: RouterCtx, payload: CampaignPayload): Promise<unknown> {
  const name = cleanText(payload.name);
  if (!name || !payload.channel) throw new Error("VALIDATION_CAMPAIGN_REQUIRED_FIELDS");

  const { data, error } = await ctx.admin
    .from("crm_campaigns")
    .insert({
      workspace_id: ctx.workspaceId,
      name,
      channel: payload.channel,
      template_id: cleanText(payload.templateId ?? null),
      audience_snapshot: toAudienceSnapshot(payload.audienceContactIds ?? []),
      state: "draft",
      execution_summary: {},
      created_by: ctx.caller.userId,
    })
    .select("id, name, channel, template_id, audience_snapshot, state, execution_summary, created_by, created_at, updated_at")
    .single<CampaignRow>();

  if (error) throw error;
  return data;
}

export async function patchCampaign(ctx: RouterCtx, campaignId: string, payload: CampaignPayload): Promise<unknown> {
  const updates: Record<string, unknown> = {};
  if (payload.name !== undefined) {
    const name = cleanText(payload.name);
    if (!name) throw new Error("VALIDATION_CAMPAIGN_REQUIRED_FIELDS");
    updates.name = name;
  }
  if (payload.templateId !== undefined) updates.template_id = cleanText(payload.templateId ?? null);
  if (payload.audienceContactIds !== undefined) updates.audience_snapshot = toAudienceSnapshot(payload.audienceContactIds);
  if (payload.archive === true) updates.deleted_at = new Date().toISOString();
  if (Object.keys(updates).length === 0) throw new Error("VALIDATION_CAMPAIGN_PATCH_REQUIRED");

  const { data, error } = await ctx.admin
    .from("crm_campaigns")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", campaignId)
    .is("deleted_at", null)
    .select("id, name, channel, template_id, audience_snapshot, state, execution_summary, created_by, created_at, updated_at")
    .maybeSingle<CampaignRow>();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");
  return data;
}

export async function executeCampaign(ctx: RouterCtx, campaignId: string): Promise<unknown> {
  const { data: campaign, error: campaignError } = await ctx.admin
    .from("crm_campaigns")
    .select("id, name, channel, template_id, audience_snapshot, state, execution_summary, created_by, created_at, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", campaignId)
    .is("deleted_at", null)
    .maybeSingle<CampaignRow>();
  if (campaignError) throw campaignError;
  if (!campaign) throw new Error("NOT_FOUND");

  const audienceContactIds = readAudienceContactIds(campaign.audience_snapshot);
  if (audienceContactIds.length === 0 || !campaign.template_id) {
    throw new Error("VALIDATION_CAMPAIGN_EXECUTION_READY");
  }

  const { data: template, error: templateError } = await ctx.admin
    .from("crm_activity_templates")
    .select("id, body")
    .eq("id", campaign.template_id)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .maybeSingle<TemplateRow>();
  if (templateError) throw templateError;
  if (!template) throw new Error("VALIDATION_CAMPAIGN_EXECUTION_READY");

  const contacts = await fetchCampaignContacts(ctx, audienceContactIds);
  const binding = await fetchCommunicationBinding({
    admin: ctx.admin,
    workspaceId: ctx.workspaceId,
    provider: campaign.channel === "email" ? "sendgrid" : "twilio",
    decryptCredential,
  });

  const { error: startError } = await ctx.admin
    .from("crm_campaigns")
    .update({ state: "running", execution_summary: {} })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", campaign.id);
  if (startError) throw startError;

  const summary = { sent: 0, failed: 0, ineligible: 0, delivered: 0, total: contacts.length };

  for (const contact of contacts) {
    const ineligibilityReason = computeCampaignIneligibility(campaign.channel, contact, binding);
    const { data: recipient, error: recipientError } = await ctx.admin
      .from("crm_campaign_recipients")
      .upsert({
        campaign_id: campaign.id,
        workspace_id: ctx.workspaceId,
        contact_id: contact.id,
        status: ineligibilityReason ? "ineligible" : "pending",
        ineligibility_reason: ineligibilityReason,
        metadata: { contactName: `${contact.firstName} ${contact.lastName}`.trim() },
      }, { onConflict: "campaign_id,contact_id" })
      .select("id")
      .single<{ id: string }>();
    if (recipientError || !recipient) throw recipientError ?? new Error("Failed to create campaign recipient.");

    if (ineligibilityReason) {
      summary.ineligible += 1;
      await ctx.admin.from("crm_campaign_recipients").update({ completed_at: new Date().toISOString() }).eq("id", recipient.id);
      continue;
    }

    const activityId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const body = interpolateCommunicationTemplate(template.body, contact);

    const { error: activityError } = await ctx.admin.from("crm_activities").insert({
      id: activityId,
      workspace_id: ctx.workspaceId,
      activity_type: campaign.channel,
      body,
      occurred_at: occurredAt,
      contact_id: contact.id,
      created_by: ctx.caller.userId,
      metadata: {},
    });
    if (activityError) throw activityError;

    try {
      const communication = await deliverCrmCommunication(ctx, {
        activityId,
        activityType: campaign.channel,
        sendNow: true,
        body,
        contactId: contact.id,
        companyId: null,
        dealId: null,
        campaignId: campaign.id,
      });

      const { error: activityMetadataError } = await ctx.admin
        .from("crm_activities")
        .update({ metadata: { communication } })
        .eq("workspace_id", ctx.workspaceId)
        .eq("id", activityId);
      if (activityMetadataError) throw activityMetadataError;

      const status = typeof communication.status === "string" ? communication.status : "failed";
      const providerMessageId = typeof communication.externalMessageId === "string" ? communication.externalMessageId : null;
      await ctx.admin
        .from("crm_campaign_recipients")
        .update({
          activity_id: activityId,
          status: status === "sent" ? "sent" : "failed",
          provider_message_id: providerMessageId,
          error_code: status === "sent" ? null : (typeof communication.reasonCode === "string" ? communication.reasonCode : "delivery_failed"),
          attempted_at: occurredAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", recipient.id);

      if (status === "sent") {
        summary.sent += 1;
      } else {
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      await ctx.admin
        .from("crm_campaign_recipients")
        .update({
          activity_id: activityId,
          status: "failed",
          error_code: error instanceof Error ? error.message : "delivery_failed",
          attempted_at: occurredAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", recipient.id);
    }
  }

  const completedAt = new Date().toISOString();
  const { error: completeError } = await ctx.admin
    .from("crm_campaigns")
    .update({ state: "completed", execution_summary: { ...summary, completedAt } })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", campaign.id);
  if (completeError) throw completeError;

  return { campaignId: campaign.id, state: "completed", executionSummary: { ...summary, completedAt } };
}
