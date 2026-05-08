import { describe, expect, test } from "bun:test";
import {
  aggregateTimeBankByAccount,
  aggregateTimeBankByRep,
  buildTimeBankInterventions,
  normalizeTimeBankRows,
  summarizeTimeBank,
} from "./time-bank";

const ROWS = normalizeTimeBankRows([
  {
    deal_id: "deal-1",
    deal_name: "Rental renewal",
    company_id: "company-1",
    company_name: "Acme Earthworks",
    assigned_rep_id: "rep-1",
    assigned_rep_name: "Ryan",
    stage_id: "stage-1",
    stage_name: "Quote Presented",
    days_in_stage: 10,
    stage_age_days: 10,
    budget_days: 7,
    has_explicit_budget: true,
    remaining_days: 0,
    pct_used: 1.43,
    is_over: true,
  },
  {
    deal_id: "deal-2",
    deal_name: "Wheel loader follow-up",
    company_id: null,
    company_name: null,
    assigned_rep_id: null,
    assigned_rep_name: null,
    stage_id: "stage-2",
    stage_name: "Needs Assessment",
    days_in_stage: 10,
    stage_age_days: 10,
    budget_days: 14,
    has_explicit_budget: false,
    remaining_days: 4,
    pct_used: 0.71,
    is_over: false,
  },
  {
    deal_id: "deal-3",
    deal_name: "Excavator financing",
    company_id: "company-2",
    company_name: "Blue Ridge Sitework",
    assigned_rep_id: "rep-2",
    assigned_rep_name: "Angela",
    stage_id: "stage-3",
    stage_name: "Credit Submitted",
    days_in_stage: 4,
    stage_age_days: 4,
    budget_days: 3,
    has_explicit_budget: true,
    remaining_days: 0,
    pct_used: 1.33,
    is_over: true,
    overrun_days: 1,
    budget_source: "stage_sla",
    pressure_tier: "over",
  },
]);

describe("time bank helpers", () => {
  test("normalizes old and new backend rows", () => {
    expect(ROWS.find((row) => row.deal_id === "deal-1")).toMatchObject({
      overrun_days: 3,
      budget_source: "stage_sla",
      pressure_tier: "over",
    });
    expect(ROWS.find((row) => row.deal_id === "deal-2")).toMatchObject({
      overrun_days: 0,
      budget_source: "fallback",
      pressure_tier: "watch",
    });
  });

  test("summarizes overall pressure", () => {
    expect(summarizeTimeBank(ROWS)).toEqual({
      totalDeals: 3,
      overBudgetDeals: 2,
      criticalDeals: 0,
      watchDeals: 1,
      pressuredAccounts: 3,
      pressuredReps: 3,
      unassignedDeals: 1,
      noAccountDeals: 1,
      fallbackBudgetDeals: 1,
      totalOverrunDays: 4,
    });
  });

  test("aggregates include missing account and rep buckets", () => {
    const accounts = aggregateTimeBankByAccount(ROWS);
    const reps = aggregateTimeBankByRep(ROWS);

    expect(accounts.find((row) => row.id === "__no_account__")).toMatchObject({
      entityId: null,
      label: "No account",
      isMissingEntity: true,
      fallbackBudgetCount: 1,
    });
    expect(reps.find((row) => row.id === "__unassigned_rep__")).toMatchObject({
      entityId: null,
      label: "Unassigned",
      isMissingEntity: true,
      watchCount: 1,
    });
  });

  test("builds sorted interventions with trace and actions", () => {
    const interventions = buildTimeBankInterventions(ROWS);

    expect(interventions[0]?.dealId).toBe("deal-1");
    expect(interventions[0]?.trace.join(" ")).toContain("Overrun: 3d");
    expect(interventions.some((row) => row.trace.some((line) => line.includes("Owner: Unassigned.")))).toBe(true);
    expect(interventions.some((row) => row.secondaryActions.some((action) => action.href === "/qrm/command/blockers"))).toBe(true);
  });
});
