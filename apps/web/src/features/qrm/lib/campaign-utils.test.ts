import { describe, expect, test } from "bun:test";
import { readCampaignAudienceCount, readCampaignExecutionCount } from "./campaign-utils";
import type { QrmCampaign } from "./types";

const campaign: QrmCampaign = {
  id: "campaign-1",
  name: "Spring push",
  channel: "email",
  templateId: "template-1",
  audienceSnapshot: { contactIds: ["a", "b", ""] },
  state: "draft",
  executionSummary: { sent: 2, delivered: 1, failed: 0 },
  createdBy: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

describe("campaign-utils", () => {
  test("counts audience ids from snapshot", () => {
    expect(readCampaignAudienceCount(campaign)).toBe(2);
  });

  test("reads numeric execution counts and defaults missing values to zero", () => {
    expect(readCampaignExecutionCount(campaign, "sent")).toBe(2);
    expect(readCampaignExecutionCount(campaign, "total")).toBe(0);
  });
});
