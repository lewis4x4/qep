import { describe, expect, it } from "bun:test";
import {
  normalizeDealStageRows,
  normalizeRepSafeDealRows,
  normalizeWeightedDealRows,
} from "./qrm-deals-api";

describe("qrm deal row normalizers", () => {
  it("normalizes deal stage rows and filters malformed records", () => {
    expect(normalizeDealStageRows([
      {
        id: "stage-1",
        workspace_id: "",
        name: "",
        sort_order: Number.NaN,
        probability: 0.6,
        is_closed_won: true,
        is_closed_lost: null,
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      },
      { id: null, name: "bad" },
    ])).toEqual([
      {
        id: "stage-1",
        workspaceId: "default",
        name: "Unnamed stage",
        sortOrder: 0,
        probability: 0.6,
        isClosedWon: true,
        isClosedLost: false,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    ]);
  });

  it("normalizes rep-safe deal rows with migration fallback fields", () => {
    expect(normalizeRepSafeDealRows([
      {
        id: "deal-1",
        workspace_id: "workspace-1",
        name: "",
        stage_id: "stage-1",
        primary_contact_id: "contact-1",
        company_id: "company-1",
        assigned_rep_id: null,
        amount: 125000,
        expected_close_on: "2026-05-01",
        next_follow_up_at: 42,
        last_activity_at: null,
        closed_at: null,
        hubspot_deal_id: "hs-1",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
        sla_deadline_at: "2026-04-10T00:00:00.000Z",
        deposit_status: "pending",
        deposit_amount: Number.NaN,
        sort_position: 3,
        margin_pct: 11.5,
      },
      "bad",
    ])).toEqual([
      {
        id: "deal-1",
        workspaceId: "workspace-1",
        name: "Untitled deal",
        stageId: "stage-1",
        primaryContactId: "contact-1",
        companyId: "company-1",
        assignedRepId: null,
        amount: 125000,
        expectedCloseOn: "2026-05-01",
        nextFollowUpAt: null,
        lastActivityAt: null,
        closedAt: null,
        hubspotDealId: "hs-1",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
        slaDeadlineAt: "2026-04-10T00:00:00.000Z",
        depositStatus: "pending",
        depositAmount: null,
        sortPosition: 3,
        marginPct: 11.5,
      },
    ]);
  });

  it("normalizes weighted deal rows", () => {
    expect(normalizeWeightedDealRows([
      {
        id: "deal-1",
        workspace_id: "workspace-1",
        name: "Excavator deal",
        stage_id: "stage-1",
        stage_name: "",
        stage_probability: Number.NaN,
        primary_contact_id: null,
        company_id: "company-1",
        assigned_rep_id: "rep-1",
        amount: 100000,
        weighted_amount: 65000,
        expected_close_on: null,
        next_follow_up_at: null,
        last_activity_at: "2026-04-01T00:00:00.000Z",
        closed_at: null,
        hubspot_deal_id: null,
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      },
    ])).toEqual([
      {
        id: "deal-1",
        workspaceId: "workspace-1",
        name: "Excavator deal",
        stageId: "stage-1",
        stageName: "Unknown",
        stageProbability: null,
        primaryContactId: null,
        companyId: "company-1",
        assignedRepId: "rep-1",
        amount: 100000,
        weightedAmount: 65000,
        expectedCloseOn: null,
        nextFollowUpAt: null,
        lastActivityAt: "2026-04-01T00:00:00.000Z",
        closedAt: null,
        hubspotDealId: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    ]);
  });

  it("returns empty lists for non-array payloads", () => {
    expect(normalizeDealStageRows(null)).toEqual([]);
    expect(normalizeRepSafeDealRows({ id: "deal-1" })).toEqual([]);
    expect(normalizeWeightedDealRows(undefined)).toEqual([]);
  });
});
