import { describe, expect, it } from "bun:test";
import {
  normalizeBlockerAnomalyRows,
  normalizeBlockerDealRows,
  normalizeBlockerDepositRows,
} from "./blockerTypes";

describe("blocker row normalizers", () => {
  it("normalizes blocker deal rows and unwraps joined relations", () => {
    expect(normalizeBlockerDealRows([
      {
        id: "deal-1",
        name: "",
        amount: 125000,
        stage_id: "stage-1",
        deposit_status: "pending",
        margin_check_status: "flagged",
        margin_pct: Number.NaN,
        expected_close_on: 42,
        last_activity_at: "2026-04-01T00:00:00.000Z",
        crm_deal_stages: [{ name: "Quote", sort_order: 20 }],
        crm_contacts: [{ first_name: "Casey", last_name: null }],
        crm_companies: [{ name: "TigerCat Logistics" }],
      },
      { id: null, name: "bad" },
      "bad",
    ])).toEqual([
      {
        id: "deal-1",
        name: "Untitled deal",
        amount: 125000,
        stage_id: "stage-1",
        deposit_status: "pending",
        margin_check_status: "flagged",
        margin_pct: null,
        expected_close_on: null,
        last_activity_at: "2026-04-01T00:00:00.000Z",
        crm_deal_stages: { name: "Quote", sort_order: 20 },
        crm_contacts: { first_name: "Casey", last_name: null },
        crm_companies: { name: "TigerCat Logistics" },
      },
    ]);
  });

  it("normalizes deposits and filters malformed rows", () => {
    expect(normalizeBlockerDepositRows([
      {
        id: "deposit-1",
        deal_id: "deal-1",
        amount: "2500",
        status: "pending",
        tier: "tier_one",
        required_amount: 2500,
      },
      { deal_id: "deal-2" },
    ])).toEqual([
      {
        id: "deposit-1",
        deal_id: "deal-1",
        amount: null,
        status: "pending",
        tier: "tier_one",
        required_amount: 2500,
      },
    ]);
  });

  it("normalizes anomalies and requires a usable created_at value", () => {
    expect(normalizeBlockerAnomalyRows([
      {
        id: "anomaly-1",
        entity_id: "deal-1",
        alert_type: "late_deposit",
        severity: "critical",
        title: "Late deposit",
        description: null,
        acknowledged: false,
        created_at: "2026-04-02T00:00:00.000Z",
      },
      { id: "anomaly-2", entity_id: "deal-2" },
    ])).toEqual([
      {
        id: "anomaly-1",
        entity_id: "deal-1",
        alert_type: "late_deposit",
        severity: "critical",
        title: "Late deposit",
        description: null,
        acknowledged: false,
        created_at: "2026-04-02T00:00:00.000Z",
      },
    ]);
  });

  it("returns empty lists for non-array payloads", () => {
    expect(normalizeBlockerDealRows(null)).toEqual([]);
    expect(normalizeBlockerDepositRows({ id: "deposit-1" })).toEqual([]);
    expect(normalizeBlockerAnomalyRows(undefined)).toEqual([]);
  });
});
