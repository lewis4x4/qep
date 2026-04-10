import { describe, expect, test } from "bun:test";
import {
  aggregateTimeBankByAccount,
  aggregateTimeBankByRep,
  summarizeTimeBank,
  type TimeBankRow,
} from "./time-bank";

const ROWS: TimeBankRow[] = [
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
    company_id: "company-1",
    company_name: "Acme Earthworks",
    assigned_rep_id: "rep-1",
    assigned_rep_name: "Ryan",
    stage_id: "stage-2",
    stage_name: "Needs Assessment",
    days_in_stage: 2,
    stage_age_days: 2,
    budget_days: 14,
    has_explicit_budget: false,
    remaining_days: 12,
    pct_used: 0.14,
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
  },
];

describe("time bank helpers", () => {
  test("summarizes overall pressure", () => {
    expect(summarizeTimeBank(ROWS)).toEqual({
      totalDeals: 3,
      overBudgetDeals: 2,
      pressuredAccounts: 2,
      pressuredReps: 2,
    });
  });

  test("aggregates by account and ranks highest pressure first", () => {
    const accounts = aggregateTimeBankByAccount(ROWS);
    expect(accounts[0]).toMatchObject({
      id: "company-2",
      label: "Blue Ridge Sitework",
      dealCount: 1,
      overCount: 1,
      worstDealName: "Excavator financing",
    });
    expect(accounts[1]).toMatchObject({
      id: "company-1",
      label: "Acme Earthworks",
      dealCount: 2,
      overCount: 1,
      worstDealName: "Rental renewal",
    });
  });

  test("aggregates by rep and keeps the hottest deal", () => {
    const reps = aggregateTimeBankByRep(ROWS);
    expect(reps[0]).toMatchObject({
      id: "rep-2",
      label: "Angela",
      dealCount: 1,
      overCount: 1,
      worstDealName: "Excavator financing",
    });
    expect(reps[1]).toMatchObject({
      id: "rep-1",
      label: "Ryan",
      dealCount: 2,
      overCount: 1,
      worstDealName: "Rental renewal",
    });
  });
});
