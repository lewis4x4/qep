import { describe, expect, it } from "bun:test";
import { buildRepSkuBoard } from "./rep-sku";
import type { PipelineDealRow, DealStageRow, RepProfileRow } from "@/features/dashboards/lib/pipeline-health";
import type { TimeBankRow } from "./time-bank";

const stages: DealStageRow[] = [
  { id: "lead", sort_order: 3, name: "Lead" },
  { id: "credit", sort_order: 14, name: "Credit" },
  { id: "post", sort_order: 18, name: "Won" },
];

const profiles: RepProfileRow[] = [
  { id: "rep-1", full_name: "Alex Stone", email: "alex@example.com" },
  { id: "rep-2", full_name: "Casey Brown", email: "casey@example.com" },
];

const deals: PipelineDealRow[] = [
  { id: "d1", stage_id: "lead", amount: 40000, assigned_rep_id: "rep-1", last_activity_at: new Date().toISOString() },
  { id: "d2", stage_id: "lead", amount: 60000, assigned_rep_id: "rep-1", last_activity_at: new Date().toISOString() },
  { id: "d3", stage_id: "credit", amount: 180000, assigned_rep_id: "rep-2", last_activity_at: new Date().toISOString() },
];

const timeBankRows: TimeBankRow[] = [
  {
    deal_id: "d1",
    deal_name: "Loader lead",
    company_id: "c1",
    company_name: "Oak Ridge",
    assigned_rep_id: "rep-1",
    assigned_rep_name: "Alex Stone",
    stage_id: "lead",
    stage_name: "Lead",
    days_in_stage: 6,
    stage_age_days: 6,
    budget_days: 14,
    has_explicit_budget: false,
    remaining_days: 8,
    pct_used: 0.43,
    is_over: false,
  },
  {
    deal_id: "d3",
    deal_name: "Excavator close",
    company_id: "c2",
    company_name: "Pine Hill",
    assigned_rep_id: "rep-2",
    assigned_rep_name: "Casey Brown",
    stage_id: "credit",
    stage_name: "Credit",
    days_in_stage: 20,
    stage_age_days: 20,
    budget_days: 14,
    has_explicit_budget: false,
    remaining_days: -6,
    pct_used: 1.42,
    is_over: true,
  },
];

describe("buildRepSkuBoard", () => {
  it("packages rep operating signatures from live pipeline and rhythm signals", () => {
    const board = buildRepSkuBoard({
      deals,
      stages,
      repProfiles: profiles,
      timeBankRows,
      kpis: [
        { repId: "rep-1", positiveVisits: 11, targetMet: true, opportunitiesCreated: 5, quotesGenerated: 1 },
        { repId: "rep-2", positiveVisits: 2, targetMet: false, opportunitiesCreated: 1, quotesGenerated: 3 },
      ],
      voiceByRepId: new Map([["rep-1", 5], ["rep-2", 1]]),
      activityByRepId: new Map([["rep-1", 10], ["rep-2", 4]]),
    });

    expect(board.summary.reps).toBe(2);
    expect(board.summary.loadedReps).toBe(2);
    expect(board.summary.overloadedReps).toBe(1);
    expect(board.summary.fieldSignalReps).toBe(2);
    expect(board.reps.some((row) => row.packageLabel.includes("Prospecting"))).toBe(true);
    expect(board.reps.some((row) => row.packageLabel.includes("Closer"))).toBe(true);
  });

  it("falls back cleanly when there are no rep signals", () => {
    const board = buildRepSkuBoard({
      deals: [],
      stages,
      repProfiles: [],
      timeBankRows: [],
      kpis: [],
      voiceByRepId: new Map(),
      activityByRepId: new Map(),
    });

    expect(board.summary.reps).toBe(0);
    expect(board.reps).toHaveLength(0);
  });
});
