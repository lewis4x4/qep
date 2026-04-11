import type { CustomerOperatingProfileBoard } from "./customer-operating-profile";
import type { WhiteSpaceMapBoard, WhiteSpaceOpportunity } from "./white-space-map";
import type { RelationshipMapBoard } from "./relationship-map";
import type { FleetIntelligenceBoard } from "./fleet-intelligence";

export type CrossDealerMirrorConfidence = "high" | "medium" | "low";

export interface CrossDealerMirrorRow {
  key: string;
  title: string;
  confidence: CrossDealerMirrorConfidence;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface CrossDealerMirrorBoard {
  summary: {
    visibleSignals: number;
    attackPaths: number;
    buyerGaps: number;
    urgencyScore: number;
  };
  theirView: CrossDealerMirrorRow[];
  likelyPlays: CrossDealerMirrorRow[];
  counterMoves: CrossDealerMirrorRow[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function strongestConfidence(
  values: CrossDealerMirrorConfidence[],
): CrossDealerMirrorConfidence {
  if (values.includes("high")) return "high";
  if (values.includes("medium")) return "medium";
  return "low";
}

function opportunityByType(
  board: WhiteSpaceMapBoard,
  type: WhiteSpaceOpportunity["type"],
): WhiteSpaceOpportunity | null {
  return board.opportunities.find((item) => item.type === type) ?? null;
}

export function buildCrossDealerMirrorBoard(input: {
  accountId: string;
  operatingProfile: CustomerOperatingProfileBoard;
  whiteSpace: WhiteSpaceMapBoard;
  relationships: RelationshipMapBoard;
  fleet: FleetIntelligenceBoard;
  openServiceJobs: number;
  openQuoteCount: number;
  expiringQuoteCount: number;
  competitorMentionCount: number;
  matchingListings: number;
  staleListings: number;
}): CrossDealerMirrorBoard {
  const whiteSpaceHref = `/qrm/accounts/${input.accountId}/white-space`;
  const relationshipHref = `/qrm/accounts/${input.accountId}/relationship-map`;
  const operatingHref = `/qrm/accounts/${input.accountId}/operating-profile`;
  const strategistHref = `/qrm/accounts/${input.accountId}/strategist`;
  const fleetHref = `/qrm/accounts/${input.accountId}/fleet-intelligence`;

  const replacement = opportunityByType(input.whiteSpace, "replacement");
  const attachmentGap = opportunityByType(input.whiteSpace, "attachment");
  const serviceCoverage = opportunityByType(input.whiteSpace, "service_coverage");
  const partsGap = opportunityByType(input.whiteSpace, "parts_penetration");

  const deciderGap = input.relationships.summary.deciders === 0;
  const blockerCount = input.relationships.summary.blockers;
  const unmatchedStakeholders = input.relationships.unmatchedStakeholders.length;
  const buyerGaps = (deciderGap ? 1 : 0) + blockerCount + unmatchedStakeholders;

  const theirView: CrossDealerMirrorRow[] = [];
  const likelyPlays: CrossDealerMirrorRow[] = [];
  const counterMoves: CrossDealerMirrorRow[] = [];

  if (replacement || input.fleet.summary.replacementWindowMachines > 0) {
    theirView.push({
      key: "visible-replacement-pressure",
      title: "A replacement window is visible without a locked replacement path",
      confidence: replacement?.confidence ?? (input.fleet.summary.replacementWindowMachines > 1 ? "high" : "medium"),
      trace: [
        `${input.fleet.summary.replacementWindowMachines} fleet unit${input.fleet.summary.replacementWindowMachines === 1 ? "" : "s"} are already in a near replacement window.`,
        ...(replacement?.evidence ?? []).slice(0, 2),
      ],
      actionLabel: "Open white-space",
      href: whiteSpaceHref,
    });

    likelyPlays.push({
      key: "play-trade-up-roi",
      title: "Lead with trade-up ROI on the oldest or highest-risk machines",
      confidence: replacement?.confidence ?? "medium",
      trace: [
        replacement?.detail ?? "Replacement timing is visible from the installed fleet.",
        `Competitors can frame a faster trade-up path against ${input.fleet.summary.replacementWindowMachines} time-sensitive unit${input.fleet.summary.replacementWindowMachines === 1 ? "" : "s"}.`,
      ],
      actionLabel: "Open fleet intelligence",
      href: fleetHref,
    });
  }

  if (serviceCoverage || input.openServiceJobs > 0) {
    theirView.push({
      key: "visible-service-friction",
      title: "Service friction is visible on the account",
      confidence: input.openServiceJobs >= 2 ? "high" : serviceCoverage?.confidence ?? "medium",
      trace: [
        `${input.openServiceJobs} open service job${input.openServiceJobs === 1 ? "" : "s"} are active on the account.`,
        ...(serviceCoverage?.evidence ?? []).slice(0, 2),
      ],
      actionLabel: "Open white-space",
      href: whiteSpaceHref,
    });

    likelyPlays.push({
      key: "play-uptime-promise",
      title: "Sell uptime discipline and planned coverage before the next major failure",
      confidence: strongestConfidence([
        serviceCoverage?.confidence ?? "low",
        input.openServiceJobs >= 2 ? "high" : "medium",
      ]),
      trace: [
        serviceCoverage?.detail ?? "Coverage gaps are visible from fleet and service behavior.",
        `${input.openServiceJobs} open service job${input.openServiceJobs === 1 ? "" : "s"} make a service-first message credible.`,
      ],
      actionLabel: "Open white-space",
      href: whiteSpaceHref,
    });
  }

  if (buyerGaps > 0) {
    theirView.push({
      key: "visible-decision-room-gap",
      title: "The decision room is still incomplete in CRM",
      confidence: deciderGap || blockerCount > 0 ? "high" : "medium",
      trace: [
        `${input.relationships.summary.deciders} decider${input.relationships.summary.deciders === 1 ? "" : "s"} are currently mapped.`,
        `${blockerCount} blocker${blockerCount === 1 ? "" : "s"} and ${unmatchedStakeholders} unmatched stakeholder${unmatchedStakeholders === 1 ? "" : "s"} remain in the account record.`,
      ],
      actionLabel: "Open relationship map",
      href: relationshipHref,
    });

    likelyPlays.push({
      key: "play-decision-room-workaround",
      title: "Find the real decider and operator path while the current contact map is still incomplete",
      confidence: deciderGap || blockerCount > 0 ? "high" : "medium",
      trace: [
        `A competitor can route around the current contact path because ${buyerGaps} buyer-risk signal${buyerGaps === 1 ? "" : "s"} are still open.`,
        `${input.relationships.summary.signers} signer${input.relationships.summary.signers === 1 ? "" : "s"} are known, but the committee is not fully closed.`,
      ],
      actionLabel: "Open relationship map",
      href: relationshipHref,
    });
  }

  if (input.competitorMentionCount > 0 || input.matchingListings > 0) {
    theirView.push({
      key: "visible-competitive-signal",
      title: "Competitive signal is already visible in the account narrative",
      confidence: input.competitorMentionCount > 0 ? "high" : "medium",
      trace: [
        `${input.competitorMentionCount} recent competitor mention${input.competitorMentionCount === 1 ? "" : "s"} were captured on this account.`,
        `${input.matchingListings} active competitor listing${input.matchingListings === 1 ? "" : "s"} match the fleet profile, including ${input.staleListings} stale listing${input.staleListings === 1 ? "" : "s"}.`,
      ],
      actionLabel: "Open threat map",
      href: "/qrm/competitive-threat-map",
    });
  }

  if (attachmentGap || partsGap) {
    likelyPlays.push({
      key: "play-productivity-bundle",
      title: "Bundle attachments, parts, and productivity claims around under-equipped iron",
      confidence: strongestConfidence([
        attachmentGap?.confidence ?? "low",
        partsGap?.confidence ?? "low",
      ]),
      trace: [
        ...(attachmentGap?.evidence ?? []),
        ...(partsGap?.evidence ?? []),
      ].slice(0, 3),
      actionLabel: "Open white-space",
      href: whiteSpaceHref,
    });
  }

  likelyPlays.push({
    key: "play-buying-rhythm",
    title: "Time outreach to how this customer actually budgets and buys",
    confidence: "medium",
    trace: [
      `Budget behavior: ${input.operatingProfile.budgetBehavior.primary}.`,
      `Buying style: ${input.operatingProfile.buyingStyle.primary}.`,
      `Work type: ${input.operatingProfile.workType.primary}.`,
    ],
    actionLabel: "Open operating profile",
    href: operatingHref,
  });

  if (buyerGaps > 0) {
    counterMoves.push({
      key: "counter-fix-decision-room",
      title: "Resolve the real decision room before the next quote or field visit",
      confidence: deciderGap || blockerCount > 0 ? "high" : "medium",
      trace: [
        `${buyerGaps} buyer-risk signal${buyerGaps === 1 ? "" : "s"} are still open on the account.`,
        "Close stakeholder ambiguity before a competitor gets a cleaner path than we do.",
      ],
      actionLabel: "Open relationship map",
      href: relationshipHref,
    });
  }

  if (replacement || serviceCoverage || attachmentGap || partsGap) {
    counterMoves.push({
      key: "counter-open-whitespace",
      title: "Open the strongest whitespace lane ourselves before it becomes a competitor wedge",
      confidence: strongestConfidence([
        replacement?.confidence ?? "low",
        serviceCoverage?.confidence ?? "low",
        attachmentGap?.confidence ?? "low",
        partsGap?.confidence ?? "low",
      ]),
      trace: [
        `${input.whiteSpace.summary.total} whitespace lane${input.whiteSpace.summary.total === 1 ? "" : "s"} are already visible from this account.`,
        `The strongest lane is ${replacement?.title ?? serviceCoverage?.title ?? attachmentGap?.title ?? partsGap?.title ?? "already exposed"}.`,
      ],
      actionLabel: "Open white-space",
      href: whiteSpaceHref,
    });
  }

  counterMoves.push({
    key: "counter-run-strategist",
    title: "Run the account plan as one response, not isolated follow-up tasks",
    confidence: input.openQuoteCount > 0 || input.expiringQuoteCount > 0 ? "high" : "medium",
    trace: [
      `${input.openQuoteCount} open quote${input.openQuoteCount === 1 ? "" : "s"} are active on the account.`,
      `${input.expiringQuoteCount} quote${input.expiringQuoteCount === 1 ? "" : "s"} are nearing expiry, so timing matters now.`,
      "Use the strategist plan to coordinate whitespace, relationship, and timing response.",
    ],
    actionLabel: "Open strategist",
    href: strategistHref,
  });

  const urgencyScore = clamp(
    (replacement?.confidence === "high" ? 35 : replacement?.confidence === "medium" ? 25 : replacement ? 15 : 0) +
      Math.min(20, input.openServiceJobs * 6) +
      (deciderGap ? 15 : 0) +
      Math.min(10, blockerCount * 5) +
      Math.min(10, unmatchedStakeholders * 3) +
      (input.competitorMentionCount > 0 ? 20 : input.matchingListings > 0 ? 10 : 0) +
      (input.expiringQuoteCount > 0 ? 10 : 0),
    0,
    100,
  );

  return {
    summary: {
      visibleSignals: theirView.length,
      attackPaths: likelyPlays.length,
      buyerGaps,
      urgencyScore,
    },
    theirView: theirView.slice(0, 4),
    likelyPlays: likelyPlays.slice(0, 4),
    counterMoves: counterMoves.slice(0, 4),
  };
}
