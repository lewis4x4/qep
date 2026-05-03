import { describe, expect, test } from "bun:test";
import {
  buildQuoteListActionPayload,
  buildQuoteListUrl,
  normalizeClosedDealsAudit,
  normalizeFactorAttributionDeals,
  normalizeFactorVerdicts,
  normalizeQuoteApprovalCaseSummary,
  normalizeQuoteApprovalPolicy,
  normalizeQuoteApprovalSubmitResult,
  normalizeQuoteFinanceScenario,
  normalizeQuoteFinancingPreview,
  normalizeQuoteListActionResponse,
  normalizeQuoteListResponse,
  normalizeQuoteRecommendation,
  normalizeScorerCalibrationObservations,
  normalizeSendQuotePackageResponse,
} from "../quote-api";

describe("normalizeQuoteFinanceScenario", () => {
  test("maps snake_case backend fields into the shared frontend contract", () => {
    const scenario = normalizeQuoteFinanceScenario({
      type: "finance",
      term_months: 60,
      rate: 6.5,
      monthly_payment: 1999.42,
      total_cost: 119_965.2,
      lender: "Preferred lender",
    });

    expect(scenario.label).toBe("Finance 60 mo");
    expect(scenario.termMonths).toBe(60);
    expect(scenario.apr).toBe(6.5);
    expect(scenario.monthlyPayment).toBe(1999.42);
    expect(scenario.totalCost).toBe(119_965.2);
  });
});

describe("quote list API helpers", () => {
  test("buildQuoteListUrl encodes search and omits all status", () => {
    const url = buildQuoteListUrl({ status: "all", search: "QEP 0002 & DFW" });

    expect(url).toContain("/quote-builder-v2/list?");
    expect(url).toContain("search=QEP+0002+%26+DFW");
    expect(url).not.toContain("status=all");
  });

  test("buildQuoteListUrl includes specific status filters", () => {
    const url = buildQuoteListUrl({ status: "sent" });

    expect(url).toContain("/quote-builder-v2/list?");
    expect(url).toContain("status=sent");
  });

  test("buildQuoteListActionPayload uses backend snake_case contract", () => {
    expect(buildQuoteListActionPayload({ quotePackageId: "quote-1", action: "archive" })).toEqual({
      quote_package_id: "quote-1",
      action: "archive",
    });
  });

  test("normalizeQuoteListResponse filters malformed items and preserves valid rows", () => {
    const normalized = normalizeQuoteListResponse({
      items: [
        {
          id: "quote-1",
          quote_number: "Q-1001",
          customer_name: "Sam Green",
          customer_company: "Green Farms",
          contact_name: null,
          status: "sent",
          net_total: "125000",
          equipment_summary: "8R Tractor",
          entry_mode: "manual",
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-02T00:00:00Z",
          accepted_at: null,
          win_probability_score: "81",
        },
        { quote_number: "missing-id" },
        null,
      ],
    });

    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]?.id).toBe("quote-1");
    expect(normalized.items[0]?.net_total).toBe(125000);
    expect(normalized.items[0]?.win_probability_score).toBe(81);
  });

  test("normalizeQuoteListActionResponse normalizes optional quote payload", () => {
    const normalized = normalizeQuoteListActionResponse({
      ok: true,
      quote: {
        id: "quote-2",
        status: "archived",
        equipment_summary: "Compact tractor",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-02T00:00:00Z",
      },
    });

    expect(normalized.ok).toBe(true);
    expect(normalized.quote?.id).toBe("quote-2");
    expect(normalized.quote?.customer_name).toBeNull();
  });
});

describe("quote edge analytics normalizers", () => {
  test("normalizeScorerCalibrationObservations filters bad rows", () => {
    const observations = normalizeScorerCalibrationObservations({
      observations: [
        { score: "74", outcome: "won" },
        { score: 20, outcome: "skipped" },
        { score: "bad", outcome: "lost" },
      ],
    });

    expect(observations).toEqual([{ score: 74, outcome: "won" }]);
  });

  test("normalizeFactorAttributionDeals keeps valid outcomes and cleans factors", () => {
    const deals = normalizeFactorAttributionDeals({
      deals: [
        {
          outcome: "lost",
          factors: [
            { label: "Price pressure", weight: "-8" },
            { label: "", weight: 4 },
            { label: "No weight" },
          ],
        },
        { outcome: "skipped", factors: [{ label: "Ignored", weight: 1 }] },
      ],
    });

    expect(deals).toEqual([
      { outcome: "lost", factors: [{ label: "Price pressure", weight: -8 }] },
    ]);
  });

  test("normalizeFactorVerdicts builds a safe verdict map", () => {
    const verdicts = normalizeFactorVerdicts({
      verdicts: [
        { label: "Fast follow-up", verdict: "proven" },
        { label: "Bad verdict", verdict: "maybe" },
        { label: "", verdict: "suspect" },
      ],
    });

    expect(verdicts.size).toBe(1);
    expect(verdicts.get("Fast follow-up")).toBe("proven");
  });

  test("normalizeClosedDealsAudit supports camel and snake case timestamps", () => {
    const audits = normalizeClosedDealsAudit({
      audits: [
        {
          package_id: "pkg-1",
          score: "88",
          outcome: "expired",
          factors: [{ label: "Aging quote", weight: "7" }],
          captured_at: "2026-05-02T00:00:00Z",
        },
        { packageId: "", score: 20, outcome: "won", factors: [] },
      ],
    });

    expect(audits).toEqual([
      {
        packageId: "pkg-1",
        score: 88,
        outcome: "expired",
        factors: [{ label: "Aging quote", weight: 7 }],
        capturedAt: "2026-05-02T00:00:00Z",
      },
    ]);
  });
});

describe("normalizeQuoteFinancingPreview", () => {
  test("normalizes the full preview envelope", () => {
    const preview = normalizeQuoteFinancingPreview({
      scenarios: [
        { type: "cash", label: "Cash", total_cost: 95_500 },
        { type: "lease", term_months: 48, apr: 5.25, monthly_payment: 1800, total_cost: 110_000 },
      ],
      amount_financed: 75_500,
      tax_total: 4_500,
      customer_total: 95_500,
      discount_total: 11_500,
      margin_check: { flagged: true, message: "Margin below 10%" },
      incentives: {
        applicable: [{ id: "inc-1", name: "Spring Cash", discount_type: "cash", discount_value: 2_500, estimated_savings: 2_500 }],
        total_savings: 2_500,
      },
    });

    expect(preview.scenarios).toHaveLength(2);
    expect(preview.amountFinanced).toBe(75_500);
    expect(preview.taxTotal).toBe(4_500);
    expect(preview.customerTotal).toBe(95_500);
    expect(preview.discountTotal).toBe(11_500);
    expect(preview.margin_check?.message).toBe("Margin below 10%");
    expect(preview.incentives?.total_savings).toBe(2_500);
  });
});

describe("quote recommendation and send normalizers", () => {
  test("normalizes AI recommendation envelopes and filters malformed nested rows", () => {
    const recommendation = normalizeQuoteRecommendation({
      recommendation: {
        machine: "  8R 310  ",
        attachments: ["Loader", "", 42, "Bale spear"],
        reasoning: "Fits acreage and loader work.",
        trigger: {
          triggerType: "unexpected",
          sourceField: "voice_transcript",
          excerpt: "Customer needs hay handling",
          createdAt: "2026-05-03T12:00:00Z",
        },
        alternative: {
          machine: "6R 250",
          attachments: ["Mower", null],
          reasoning: "Lower price point.",
          whyNotChosen: "Less fit for heavy loader work.",
        },
        jobConsiderations: ["Hay", "", "Loader work"],
        jobFacts: [
          { label: "Acreage", value: "400" },
          { label: "", value: "ignored" },
        ],
        transcriptHighlights: [
          { quote: "Need to move round bales", supports: "loader spec" },
          { quote: "", supports: "ignored" },
        ],
      },
    });

    expect(recommendation.machine).toBe("8R 310");
    expect(recommendation.attachments).toEqual(["Loader", "Bale spear"]);
    expect(recommendation.trigger?.triggerType).toBe("voice_transcript");
    expect(recommendation.alternative?.attachments).toEqual(["Mower"]);
    expect(recommendation.jobConsiderations).toEqual(["Hay", "Loader work"]);
    expect(recommendation.jobFacts).toEqual([{ label: "Acreage", value: "400" }]);
    expect(recommendation.transcriptHighlights).toEqual([
      { quote: "Need to move round bales", supports: "loader spec" },
    ]);
  });

  test("normalizes send-package edge responses", () => {
    expect(normalizeSendQuotePackageResponse({ sent: true, toEmail: "buyer@example.com" })).toEqual({
      sent: true,
      to_email: "buyer@example.com",
    });
    expect(normalizeSendQuotePackageResponse({ sent: "yes", to_email: 42 })).toEqual({
      sent: false,
      to_email: "",
    });
  });
});

describe("quote approval normalizers", () => {
  test("normalizes submit approval responses from snake case payloads", () => {
    const result = normalizeQuoteApprovalSubmitResult({
      approval_case_id: "case-1",
      approval_id: "flow-1",
      quote_package_version_id: "version-1",
      version_number: "7",
      branch_name: "Raleigh",
      assigned_to_name: "Sales Manager",
      route_mode: "owner_direct",
      already_pending: true,
    });

    expect(result).toEqual({
      approvalCaseId: "case-1",
      approvalId: "flow-1",
      quotePackageVersionId: "version-1",
      versionNumber: 7,
      status: "pending_approval",
      branchName: "Raleigh",
      assignedToName: "Sales Manager",
      routeMode: "owner_direct",
      alreadyPending: true,
    });
  });

  test("normalizes approval case summaries and drops malformed nested rows", () => {
    const summary = normalizeQuoteApprovalCaseSummary({
      id: "case-1",
      quote_package_id: "quote-1",
      quote_package_version_id: "version-1",
      version_number: "3",
      deal_id: "deal-1",
      branch_slug: "raleigh",
      branch_name: "Raleigh",
      submitted_by_name: "Rep",
      assigned_role: "manager",
      route_mode: "unknown",
      policy_snapshot: { floor: 12 },
      reason_summary: { margin: "low" },
      status: "approved_with_conditions",
      decision_note: "Fix cash down",
      due_at: "2026-05-04T12:00:00Z",
      flow_approval_id: "flow-1",
      conditions: [
        {
          id: "condition-1",
          approval_case_id: "case-1",
          condition_type: "required_cash_down",
          condition_payload: { amount: 5000 },
          sort_order: "2",
          created_at: "2026-05-03T12:00:00Z",
        },
        { condition_type: "min_margin_pct" },
      ],
      evaluations: [
        {
          id: "evaluation-1",
          condition_type: "bad-type",
          label: "Cash down",
          satisfied: true,
          detail: "Met",
          blocking: false,
        },
        { label: "missing id" },
      ],
      can_send: true,
    });

    expect(summary?.routeMode).toBe("manager_queue");
    expect(summary?.status).toBe("approved_with_conditions");
    expect(summary?.versionNumber).toBe(3);
    expect(summary?.conditions).toEqual([
      {
        id: "condition-1",
        approvalCaseId: "case-1",
        conditionType: "required_cash_down",
        conditionPayload: { amount: 5000 },
        sortOrder: 2,
        createdAt: "2026-05-03T12:00:00Z",
      },
    ]);
    expect(summary?.evaluations).toEqual([
      {
        id: "evaluation-1",
        conditionType: "min_margin_pct",
        label: "Cash down",
        satisfied: true,
        detail: "Met",
        blocking: false,
      },
    ]);
    expect(summary?.canSend).toBe(true);
  });

  test("rejects incomplete approval case summaries", () => {
    expect(normalizeQuoteApprovalCaseSummary({ id: "case-1" })).toBeNull();
  });

  test("normalizes approval policies from camel and snake case payloads", () => {
    const policy = normalizeQuoteApprovalPolicy({
      workspace_id: "workspace-1",
      branch_manager_min_margin_pct: "9.5",
      standard_margin_floor_pct: 12,
      branch_manager_max_quote_amount: "250000",
      submit_sla_hours: "8",
      escalation_sla_hours: "24",
      owner_escalation_role: "admin",
      named_branch_sales_manager_primary: true,
      named_branch_general_manager_fallback: false,
      allowed_condition_types: ["required_cash_down", "bad-type", "expiry_hours"],
      updated_at: "2026-05-03T12:00:00Z",
      updated_by: "admin-1",
    });

    expect(policy.workspaceId).toBe("workspace-1");
    expect(policy.branchManagerMinMarginPct).toBe(9.5);
    expect(policy.branchManagerMaxQuoteAmount).toBe(250000);
    expect(policy.ownerEscalationRole).toBe("admin");
    expect(policy.allowedConditionTypes).toEqual([
      "required_cash_down",
      "min_margin_pct",
      "expiry_hours",
    ]);
    expect(policy.updatedBy).toBe("admin-1");
  });
});
