import { describe, expect, test } from "bun:test";
import {
  normalizeArBlockRow,
  normalizeCrossDepartmentAlerts,
  normalizeCustomerHealthProfiles,
  normalizeCustomerProfileLinkRow,
  normalizeHealthRefreshRunResult,
  normalizeHealthRefreshSummary,
  normalizeHealthScoreDrawerPayload,
  normalizeRevenueByMakeModelRows,
} from "./nervous-system-normalizers";

describe("nervous system normalizers", () => {
  test("normalizes cross-department alerts and filters invalid enums", () => {
    expect(normalizeCrossDepartmentAlerts([
      {
        id: "alert-1",
        workspace_id: "workspace-1",
        source_department: "parts",
        target_department: "service",
        customer_profile_id: "profile-1",
        alert_type: "health_drop",
        severity: "critical",
        title: "Parts spend stopped",
        body: "No spend in 90 days",
        context_entity_type: "customer_profile",
        context_entity_id: "profile-1",
        status: "pending",
        routed_to_user_id: null,
        resolved_at: null,
        created_at: "2026-05-03T12:00:00.000Z",
      },
      {
        id: "bad",
        workspace_id: "workspace-1",
        source_department: "parts",
        target_department: "unknown",
        alert_type: "bad",
        severity: "urgent",
        title: "Bad",
        status: "pending",
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ])).toEqual([
      {
        id: "alert-1",
        workspace_id: "workspace-1",
        source_department: "parts",
        target_department: "service",
        customer_profile_id: "profile-1",
        alert_type: "health_drop",
        severity: "critical",
        title: "Parts spend stopped",
        body: "No spend in 90 days",
        context_entity_type: "customer_profile",
        context_entity_id: "profile-1",
        status: "pending",
        routed_to_user_id: null,
        resolved_at: null,
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes health profiles with component signals", () => {
    expect(normalizeCustomerHealthProfiles([
      {
        id: "profile-1",
        customer_name: "TigerCat",
        company_name: "TigerCat Logistics",
        health_score: "82.5",
        health_score_components: {
          deal_velocity: "20",
          service_engagement: "18",
          parts_revenue: "22",
          financial_health: "21",
          signals: {
            parts_spend_90d: "4500",
            avg_days_to_pay: null,
            quote_close_ratio: "0.34",
          },
        },
        health_score_updated_at: "2026-05-03T12:00:00.000Z",
        pricing_persona: "value_buyer",
        lifetime_value: "250000",
      },
      { id: "bad", company_name: "Missing customer" },
    ])).toEqual([
      {
        id: "profile-1",
        customer_name: "TigerCat",
        company_name: "TigerCat Logistics",
        health_score: 82.5,
        health_score_components: {
          deal_velocity: 20,
          service_engagement: 18,
          parts_revenue: 22,
          financial_health: 21,
          signals: {
            parts_spend_90d: 4500,
            avg_days_to_pay: null,
            quote_close_ratio: 0.34,
          },
        },
        health_score_updated_at: "2026-05-03T12:00:00.000Z",
        pricing_persona: "value_buyer",
        lifetime_value: 250000,
      },
    ]);
  });

  test("normalizes revenue and health refresh edge responses", () => {
    expect(normalizeRevenueByMakeModelRows([
      {
        make: "John Deere",
        model: "333G",
        unit_count: "4",
        total_lifetime_revenue: "100000",
        avg_lifetime_revenue_per_unit: "25000",
      },
      { make: "Bad", unit_count: 1 },
    ])).toEqual([
      {
        make: "John Deere",
        model: "333G",
        unit_count: 4,
        total_lifetime_revenue: 100000,
        avg_lifetime_revenue_per_unit: 25000,
      },
    ]);

    expect(normalizeHealthRefreshSummary({
      total_scored: "10",
      avg_score: "72.5",
      distribution: { excellent: "2", good: "4", fair: "3", at_risk: "1" },
      top_customers: [{ customer_name: "TigerCat", health_score: "91" }, { health_score: 10 }],
    })).toEqual({
      total_scored: 10,
      avg_score: 72.5,
      distribution: { excellent: 2, good: 4, fair: 3, at_risk: 1 },
      top_customers: [{ customer_name: "TigerCat", health_score: 91 }],
    });

    expect(normalizeHealthRefreshRunResult({
      ok: true,
      scores_refreshed: "10",
      alerts_generated: "2",
    })).toEqual({ ok: true, scores_refreshed: 10, alerts_generated: 2 });
  });

  test("normalizes health drawer RPC and blocker lookup payloads", () => {
    expect(normalizeHealthScoreDrawerPayload({
      current_score: "42.5",
      components: {
        financial_health: { score: "12", signals: { avg_days_to_pay: 67 } },
        parts_revenue: "8",
        malformed: { score: "bad" },
      },
      delta_7d: "-2",
      delta_30d: null,
      delta_90d: "5",
    })).toEqual({
      current_score: 42.5,
      components: {
        financial_health: { score: 12, signals: { avg_days_to_pay: 67 } },
        parts_revenue: 8,
        malformed: {},
      },
      delta_7d: -2,
      delta_30d: null,
      delta_90d: 5,
    });

    expect(normalizeCustomerProfileLinkRow({ crm_company_id: "company-1" })).toEqual({ crm_company_id: "company-1" });
    expect(normalizeArBlockRow({
      id: "block-1",
      block_reason: "Over 90",
      current_max_aging_days: "102",
      blocked_at: "2026-05-03T12:00:00.000Z",
    })).toEqual({
      id: "block-1",
      block_reason: "Over 90",
      current_max_aging_days: 102,
      blocked_at: "2026-05-03T12:00:00.000Z",
    });
    expect(normalizeArBlockRow({ id: "bad" })).toBeNull();
  });
});
