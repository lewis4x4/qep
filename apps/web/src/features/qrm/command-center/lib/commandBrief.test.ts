import { describe, expect, test } from "bun:test";
import type { RecommendationCardPayload } from "../api/commandCenter.types";
import {
  containsManifestoRiskCopy,
  deriveCommandCenterRiskIfIgnored,
  getNextMoveActionLabel,
  getNextMoveTargetHref,
  MANIFESTO_RISK_STRINGS,
} from "./commandBrief";

function card(
  overrides: Partial<RecommendationCardPayload> = {},
): RecommendationCardPayload {
  return {
    recommendationKey: "deal:abc:revenue_at_risk",
    entityType: "deal",
    entityId: "abc",
    headline: "Bandit chipper replacement package 01",
    rationale: ["No activity for 86 days (stall threshold 30)."],
    lane: "revenue_at_risk",
    confidence: 0.7,
    score: 2,
    primaryAction: {
      kind: "log_activity",
      label: "Log next touch",
      href: "/qrm/deals/abc",
      payloadId: "abc",
    },
    amount: 125000,
    companyName: "Green Valley Landscaping",
    contactName: "Mike Torres",
    stageName: "Quote Presented",
    observedAt: "2026-04-10T12:00:00Z",
    ...overrides,
  };
}

describe("deriveCommandCenterRiskIfIgnored", () => {
  test("never emits legacy manifesto strings", () => {
    const strip = {
      closableRevenue7d: 0,
      closableRevenue30d: 0,
      atRiskRevenue: 50000,
      blockedDeals: 2,
      overdueFollowUps: 3,
      urgentApprovals: 0,
      narrative: "Pressure on the board.",
    };

    const scenarios = [
      deriveCommandCenterRiskIfIgnored({
        commandStrip: strip,
        bestMove: card(),
        nextMoveDetailLine: card().rationale[0],
      }),
      deriveCommandCenterRiskIfIgnored({
        commandStrip: strip,
        bestMove: null,
        nextMoveDetailLine: null,
      }),
      deriveCommandCenterRiskIfIgnored({
        commandStrip: null,
        bestMove: null,
        nextMoveDetailLine: null,
      }),
    ];

    for (const text of scenarios) {
      expect(containsManifestoRiskCopy(text)).toBe(false);
      for (const snippet of MANIFESTO_RISK_STRINGS) {
        expect(text.toLowerCase()).not.toContain(snippet);
      }
    }
  });

  test("ties risk to named account and stall facts from bestMove", () => {
    const bestMove = card();
    const risk = deriveCommandCenterRiskIfIgnored({
      commandStrip: null,
      bestMove,
      nextMoveDetailLine: bestMove.rationale[0],
    });

    expect(risk).toContain("Green Valley Landscaping");
    expect(risk).toContain("$125K");
    expect(risk).toContain("$125K");
  });

  test("uses strip aggregates when bestMove is absent", () => {
    const risk = deriveCommandCenterRiskIfIgnored({
      commandStrip: {
        closableRevenue7d: 0,
        closableRevenue30d: 0,
        atRiskRevenue: 80000,
        blockedDeals: 0,
        overdueFollowUps: 2,
        urgentApprovals: 0,
        narrative: "",
      },
      bestMove: null,
      nextMoveDetailLine: null,
    });

    expect(risk).toContain("$80K");
    expect(risk).toContain("2 overdue follow-ups");
  });

  test("blocker lane names frozen revenue when rationale is sparse", () => {
    const bestMove = card({
      lane: "blockers",
      rationale: ["Deposit pending — order is gated until verified."],
      primaryAction: {
        kind: "open_deal",
        label: "Resolve blocker",
        href: "/qrm/deals/abc",
      },
    });

    const risk = deriveCommandCenterRiskIfIgnored({
      commandStrip: null,
      bestMove,
      nextMoveDetailLine: bestMove.rationale[0],
    });

    expect(risk).toContain("Green Valley Landscaping");
    expect(risk.toLowerCase()).toContain("deposit");
  });
});

describe("getNextMoveTargetHref", () => {
  test("returns href when entity id and primary action href exist", () => {
    expect(getNextMoveTargetHref(card())).toBe("/qrm/deals/abc");
  });

  test("returns null without entity id or href", () => {
    expect(getNextMoveTargetHref(card({ entityId: "" }))).toBeNull();
    expect(
      getNextMoveTargetHref(
        card({ primaryAction: { kind: "open_deal", label: "Open deal" } }),
      ),
    ).toBeNull();
    expect(getNextMoveTargetHref(null)).toBeNull();
  });
});

describe("getNextMoveActionLabel", () => {
  test("returns primary action label for actionable cards", () => {
    expect(getNextMoveActionLabel(card())).toBe("Log next touch");
  });
});
