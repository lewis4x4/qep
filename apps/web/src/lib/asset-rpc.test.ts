import { describe, expect, test } from "bun:test";
import { parseAsset360 } from "./asset-rpc";

const basePayload = {
  equipment: {
    id: "33000000-0000-4000-8000-000000000004",
    workspace_id: "workspace-1",
    company_id: "company-1",
    primary_contact_id: null,
    name: "Develon DX235LCR Excavator",
    asset_tag: "EQ-004",
    serial_number: "DX235-FL-004",
    make: "Develon",
    model: "DX235LCR",
    year: 2023,
    condition: "good",
    availability: "in_service",
    ownership: "customer_owned",
    engine_hours: "1234",
    warranty_expires_on: "2027-01-01",
    next_service_due_at: "2026-06-01T00:00:00Z",
    photo_urls: ["https://example.test/asset.jpg", ""],
    metadata: { source: "smoke" },
    created_at: "2026-01-01T00:00:00Z",
  },
  company: {
    id: "company-1",
    name: "Southern Siteworks Group",
    city: "Albany",
    state: "GA",
  },
  badges: {
    open_work_orders: "2",
    open_quotes: 1,
    pending_parts_orders: null,
    overdue_intervals: "0",
    trade_up_score: "87",
    lifetime_parts_spend: "125000",
  },
  recent_service: [
    {
      id: "service-1",
      customer_problem_summary: "Hydraulic leak",
      current_stage: "triage",
      scheduled_start_at: "2026-04-30T14:00:00Z",
      closed_at: null,
    },
  ],
  open_deal: {
    id: "deal-1",
    name: "Replacement option",
    amount: "150000",
    stage_id: "stage-1",
    next_follow_up_at: "2026-05-02T00:00:00Z",
  },
};

describe("parseAsset360", () => {
  test("normalizes the current get_asset_360 JSON payload into the UI contract", () => {
    const parsed = parseAsset360(basePayload);

    expect(parsed?.equipment).toMatchObject({
      id: "33000000-0000-4000-8000-000000000004",
      name: "Develon DX235LCR Excavator",
      availability: "in_service",
      ownership: "customer_owned",
      engine_hours: 1234,
      photo_urls: ["https://example.test/asset.jpg"],
    });
    expect(parsed?.company?.name).toBe("Southern Siteworks Group");
    expect(parsed?.badges).toMatchObject({
      open_work_orders: 2,
      open_quotes: 1,
      pending_parts_orders: 0,
      trade_up_score: 87,
      lifetime_parts_spend: 125000,
    });
    expect(parsed?.recent_service).toEqual([
      {
        id: "service-1",
        summary: "Hydraulic leak",
        status: "triage",
        scheduled_for: "2026-04-30T14:00:00Z",
        completed_at: null,
      },
    ]);
    expect(parsed?.open_deal?.amount).toBe(150000);
  });

  test("keeps legacy service aliases compatible", () => {
    const parsed = parseAsset360({
      ...basePayload,
      recent_service: [
        {
          id: "service-2",
          summary: "Legacy summary",
          status: "scheduled",
          scheduled_for: "2026-05-01T10:00:00Z",
          completed_at: "2026-05-01T12:00:00Z",
        },
      ],
    });

    expect(parsed?.recent_service[0]).toMatchObject({
      id: "service-2",
      summary: "Legacy summary",
      status: "scheduled",
      scheduled_for: "2026-05-01T10:00:00Z",
      completed_at: "2026-05-01T12:00:00Z",
    });
  });

  test("returns null when the required equipment object is missing", () => {
    expect(parseAsset360(null)).toBeNull();
    expect(parseAsset360({ ...basePayload, equipment: null })).toBeNull();
    expect(parseAsset360({ ...basePayload, equipment: { name: "No id" } })).toBeNull();
  });
});
