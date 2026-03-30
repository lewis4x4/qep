import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  getValidHubSpotAccessToken,
  requestHubSpot,
  resolveCanonicalHubSpotResolution,
} from "./hubspot-client.ts";
import {
  claimWebhookReceipt,
  markReceiptError,
  markReceiptProcessed,
  markReceiptSkippedDuplicate,
} from "./hubspot-webhook-receipts.ts";
import {
  upsertCrmActivity,
  upsertHubSpotCompany,
  upsertHubSpotContact,
  upsertHubSpotDeal,
} from "./crm-hubspot-sync.ts";
import { applyDealStageSequences } from "./hubspot-sequence-enrollment.ts";

export interface HubSpotEvent {
  eventType: string;
  subscriptionType: string;
  portalId: number;
  objectId: number;
  propertyName: string;
  propertyValue: string;
  changeSource: string;
  occurredAt: number;
}

interface HubSpotDealResponse {
  properties?: {
    dealname?: string;
    hubspot_owner_id?: string;
    dealstage?: string;
    amount?: string;
    closedate?: string;
  };
  associations?: {
    contacts?: { results?: Array<{ id: string | number }> };
    companies?: { results?: Array<{ id: string | number }> };
  };
}

interface HubSpotContactResponse {
  properties?: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    jobtitle?: string;
  };
}

interface HubSpotCompanyResponse {
  properties?: {
    name?: string;
    address?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

function parseCloseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && raw.trim() !== "") {
    return new Date(asNumber).toISOString().slice(0, 10);
  }
  const asDate = new Date(raw);
  return Number.isNaN(asDate.getTime())
    ? null
    : asDate.toISOString().slice(0, 10);
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function processHubSpotWebhookEvent(
  supabase: SupabaseClient,
  event: HubSpotEvent,
): Promise<void> {
  if (
    event.subscriptionType !== "deal.propertyChange" ||
    event.propertyName !== "dealstage"
  ) {
    return;
  }

  const hubId = String(event.portalId);
  const dealId = String(event.objectId);
  const receipt = await claimWebhookReceipt(supabase, event);

  if (receipt.kind === "duplicate") {
    await markReceiptSkippedDuplicate(supabase, receipt.receiptKey);
    return;
  }

  try {
    const canonical = await resolveCanonicalHubSpotResolution(supabase, hubId);
    const context = canonical.context;
    if (!context) {
      const code = canonical.code === "ambiguous_active_binding"
        ? "AMBIGUOUS_CANONICAL_PORTAL_BINDING"
        : "NO_CANONICAL_PORTAL_BINDING";
      await markReceiptError(supabase, receipt.receiptId, code);
      return;
    }

    const token = await getValidHubSpotAccessToken(supabase, context);
    if (!token) {
      await markReceiptError(supabase, receipt.receiptId, "TOKEN_UNAVAILABLE");
      return;
    }

    const dealResponse = await requestHubSpot({
      hubId,
      operationKey: "webhook_deal_lookup",
      token,
      path:
        `/crm/v3/objects/deals/${dealId}?properties=dealname,hubspot_owner_id,dealstage,amount,closedate,hs_object_id&associations=contacts,companies`,
    });
    const deal = await dealResponse.json() as HubSpotDealResponse;

    let crmCompanyId: string | null = null;
    const firstCompanyId = deal.associations?.companies?.results?.[0]?.id;
    if (firstCompanyId !== undefined && firstCompanyId !== null) {
      const externalCompanyId = String(firstCompanyId);
      const companyResponse = await requestHubSpot({
        hubId,
        operationKey: "webhook_company_lookup",
        token,
        path:
          `/crm/v3/objects/companies/${externalCompanyId}?properties=name,address,address2,city,state,zip,country`,
      });
      const company = await companyResponse.json() as HubSpotCompanyResponse;
      crmCompanyId = await upsertHubSpotCompany({
        supabase,
        workspaceId: context.workspaceId,
        hubspotCompanyId: externalCompanyId,
        name: company.properties?.name ?? `Company ${externalCompanyId}`,
        addressLine1: company.properties?.address ?? null,
        addressLine2: company.properties?.address2 ?? null,
        city: company.properties?.city ?? null,
        state: company.properties?.state ?? null,
        postalCode: company.properties?.zip ?? null,
        country: company.properties?.country ?? null,
        metadata: { source: "hubspot_webhook" },
      });
    }

    let contactName: string | null = null;
    let crmContactId: string | null = null;
    const firstContactId = deal.associations?.contacts?.results?.[0]?.id;
    if (firstContactId !== undefined && firstContactId !== null) {
      const externalContactId = String(firstContactId);
      const contactResponse = await requestHubSpot({
        hubId,
        operationKey: "webhook_contact_lookup",
        token,
        path:
          `/crm/v3/objects/contacts/${externalContactId}?properties=firstname,lastname,email,phone,jobtitle`,
      });
      const contact = await contactResponse.json() as HubSpotContactResponse;
      contactName =
        [contact.properties?.firstname, contact.properties?.lastname]
          .filter(Boolean)
          .join(" ") || null;
      crmContactId = await upsertHubSpotContact({
        supabase,
        workspaceId: context.workspaceId,
        hubspotContactId: externalContactId,
        firstName: contact.properties?.firstname ?? "Unknown",
        lastName: contact.properties?.lastname ?? "Contact",
        email: contact.properties?.email ?? null,
        phone: contact.properties?.phone ?? null,
        title: contact.properties?.jobtitle ?? null,
        primaryCompanyId: crmCompanyId,
        metadata: { source: "hubspot_webhook" },
      });
    }

    const crmDeal = await upsertHubSpotDeal({
      supabase,
      workspaceId: context.workspaceId,
      hubspotDealId: dealId,
      name: deal.properties?.dealname ?? `Deal ${dealId}`,
      hubspotStageId: event.propertyValue ?? deal.properties?.dealstage ?? null,
      amount: parseAmount(deal.properties?.amount),
      expectedCloseOn: parseCloseDate(deal.properties?.closedate),
      companyId: crmCompanyId,
      primaryContactId: crmContactId,
      metadata: {
        source: "hubspot_webhook",
        hubspot_owner_id: deal.properties?.hubspot_owner_id ?? null,
      },
      mode: "webhook",
    });

    await upsertCrmActivity({
      supabase,
      workspaceId: context.workspaceId,
      externalActivityId: receipt.receiptKey,
      body: `HubSpot stage changed to \"${crmDeal.stageName}\".`,
      occurredAt: new Date(event.occurredAt).toISOString(),
      dealId: crmDeal.id,
      metadata: {
        source: "hubspot_webhook",
        hubspot_stage_id: event.propertyValue,
      },
    });

    await applyDealStageSequences({
      supabase,
      hubId,
      dealId,
      stageValue: event.propertyValue,
      dealName: deal.properties?.dealname ?? `Deal ${dealId}`,
      ownerId: deal.properties?.hubspot_owner_id ?? null,
      contactId: firstContactId !== undefined && firstContactId !== null
        ? String(firstContactId)
        : null,
      contactName,
      token,
    });

    await markReceiptProcessed(supabase, receipt.receiptId);
  } catch (error) {
    await markReceiptError(
      supabase,
      receipt.receiptId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
