import { describe, expect, test } from "bun:test";
import { buildMobileFieldPriorityFeed } from "./mobile-field-command";
import type { CommandCenterResponse, RecommendationCardPayload } from "../command-center/api/commandCenter.types";

function card(
  recommendationKey: string,
  lane: RecommendationCardPayload["lane"],
  score: number,
): RecommendationCardPayload {
  return {
    recommendationKey,
    entityType: "deal",
    entityId: recommendationKey,
    headline: recommendationKey,
    rationale: ["Reason"],
    lane,
    confidence: 0.8,
    score,
    primaryAction: { kind: "open_deal", label: "Open", href: `/qrm/deals/${recommendationKey}` },
    amount: 1000,
    companyName: "Acme",
    contactName: "Taylor",
    stageName: "Quote Presented",
    observedAt: "2026-04-10T12:00:00Z",
  };
}

describe("buildMobileFieldPriorityFeed", () => {
  test("dedupes chief-of-staff and lane cards, prioritizing blockers first", () => {
    const payload = {
      aiChiefOfStaff: {
        bestMove: card("best", "revenue_ready", 50),
        biggestRisk: card("dup", "blockers", 80),
        fastestPath: card("fast", "revenue_at_risk", 70),
        additional: [],
        source: "rules" as const,
      },
      actionLanes: {
        revenueReady: [card("best", "revenue_ready", 50)],
        revenueAtRisk: [card("risk", "revenue_at_risk", 60)],
        blockers: [card("dup", "blockers", 80), card("blocker-2", "blockers", 75)],
      },
    } satisfies Pick<CommandCenterResponse, "aiChiefOfStaff" | "actionLanes">;

    const result = buildMobileFieldPriorityFeed(payload);

    expect(result.map((item) => item.recommendationKey)).toEqual([
      "dup",
      "blocker-2",
      "fast",
      "risk",
      "best",
    ]);
  });
});
