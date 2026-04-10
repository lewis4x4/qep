import { describe, expect, test } from "bun:test";
import {
  buildSeamSummaries,
  filterHandoffEvents,
  latestSeamScores,
  summarizeHandoffs,
  type HandoffEventRow,
  type HandoffSeamScoreRow,
} from "./handoff-trust";

const EVENTS: HandoffEventRow[] = [
  {
    id: "1",
    subject_id: "deal-1",
    subject_label: "Deal One",
    handoff_reason: "deposit_verification",
    handoff_at: "2026-04-10T12:00:00Z",
    from_iron_role: "iron_advisor",
    to_iron_role: "iron_manager",
    composite_score: 0.4,
    info_completeness: 0.5,
    recipient_readiness: 0.4,
    outcome_alignment: 0.3,
    outcome: "degraded",
    evidence: { hours_to_first_action: 30 },
  },
  {
    id: "2",
    subject_id: "deal-2",
    subject_label: "Deal Two",
    handoff_reason: "deposit_verification",
    handoff_at: "2026-04-09T12:00:00Z",
    from_iron_role: "iron_advisor",
    to_iron_role: "iron_manager",
    composite_score: 0.9,
    info_completeness: 1,
    recipient_readiness: 1,
    outcome_alignment: 0.7,
    outcome: "improved",
    evidence: { hours_to_first_action: 2 },
  },
  {
    id: "3",
    subject_id: "deal-3",
    subject_label: "Deal Three",
    handoff_reason: "demo_approval",
    handoff_at: "2026-04-08T12:00:00Z",
    from_iron_role: "iron_advisor",
    to_iron_role: "iron_man",
    composite_score: 0.8,
    info_completeness: 0.8,
    recipient_readiness: 0.9,
    outcome_alignment: 0.7,
    outcome: "improved",
    evidence: { hours_to_first_action: 3 },
  },
];

describe("handoff trust helpers", () => {
  test("filters low-score events within the selected window", () => {
    const filtered = filterHandoffEvents(
      EVENTS,
      {
        windowDays: 30,
        fromRole: "all",
        toRole: "all",
        reason: "deposit_verification",
        lowScoreOnly: true,
      },
      new Date("2026-04-10T18:00:00Z"),
    );

    expect(filtered.map((event) => event.id)).toEqual(["1"]);
  });

  test("builds seam summaries and ranks worst seams first", () => {
    const summaries = buildSeamSummaries(EVENTS);

    expect(summaries[0]?.key).toBe("iron_advisor:iron_manager");
    expect(summaries[0]?.handoff_count).toBe(2);
    expect(summaries[0]?.degraded_pct).toBe(0.5);
  });

  test("summarizes best and worst seams for the ledger header", () => {
    const seams = buildSeamSummaries(EVENTS);
    const summary = summarizeHandoffs(EVENTS, seams);

    expect(summary.totalHandoffs).toBe(3);
    expect(summary.degradedPct).toBeCloseTo(1 / 3, 5);
    expect(summary.worstSeam?.key).toBe("iron_advisor:iron_manager");
    expect(summary.bestSeam?.key).toBe("iron_advisor:iron_man");
  });

  test("keeps only the latest seam-score row per seam", () => {
    const latest = latestSeamScores([
      {
        id: "old",
        from_iron_role: "iron_advisor",
        to_iron_role: "iron_manager",
        handoff_count: 2,
        scored_count: 2,
        avg_composite: 0.7,
        avg_info_completeness: 0.7,
        avg_recipient_readiness: 0.7,
        avg_outcome_alignment: 0.7,
        improved_pct: 0.5,
        degraded_pct: 0,
        period_start: "2026-04-01T00:00:00Z",
        period_end: "2026-04-10T00:00:00Z",
      },
      {
        id: "new",
        from_iron_role: "iron_advisor",
        to_iron_role: "iron_manager",
        handoff_count: 3,
        scored_count: 3,
        avg_composite: 0.5,
        avg_info_completeness: 0.5,
        avg_recipient_readiness: 0.5,
        avg_outcome_alignment: 0.5,
        improved_pct: 0.33,
        degraded_pct: 0.33,
        period_start: "2026-04-02T00:00:00Z",
        period_end: "2026-04-11T00:00:00Z",
      },
    ] satisfies HandoffSeamScoreRow[]);

    expect(latest).toHaveLength(1);
    expect(latest[0]?.id).toBe("new");
  });
});
