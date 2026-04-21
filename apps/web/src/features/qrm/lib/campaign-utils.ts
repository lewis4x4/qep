import type { QrmCampaign } from "./types";

export function readCampaignAudienceCount(campaign: QrmCampaign): number {
  const ids = campaign.audienceSnapshot.contactIds;
  return Array.isArray(ids) ? ids.filter((value) => typeof value === "string" && value.trim().length > 0).length : 0;
}

export function readCampaignExecutionCount(campaign: QrmCampaign, key: "sent" | "delivered" | "failed" | "ineligible" | "total"): number {
  const value = campaign.executionSummary[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
