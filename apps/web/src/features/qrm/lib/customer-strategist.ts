import type { CustomerOperatingProfileBoard } from "./customer-operating-profile";
import type { WhiteSpaceMapBoard } from "./white-space-map";
import type { RelationshipMapBoard } from "./relationship-map";
import type { RentalConversionBoard } from "./rental-conversion";

export type StrategistConfidence = "high" | "medium" | "low";
export type StrategistHorizon = "30d" | "60d" | "90d";

export interface StrategistPlay {
  key: string;
  title: string;
  confidence: StrategistConfidence;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface StrategistPlan {
  horizon: StrategistHorizon;
  headline: string;
  objective: string;
  confidence: StrategistConfidence;
  plays: StrategistPlay[];
}

export interface CustomerStrategistBoard {
  summary: {
    totalPlays: number;
    immediatePlays: number;
    expansionPlays: number;
    strategicPlays: number;
  };
  plans: StrategistPlan[];
}

function strongestConfidence(values: StrategistConfidence[]): StrategistConfidence {
  if (values.includes("high")) return "high";
  if (values.includes("medium")) return "medium";
  return "low";
}

function clampPlays(plays: StrategistPlay[]): StrategistPlay[] {
  return plays.slice(0, 3);
}

export function buildCustomerStrategistBoard(input: {
  accountId: string;
  operatingProfile: CustomerOperatingProfileBoard;
  whiteSpace: WhiteSpaceMapBoard;
  relationships: RelationshipMapBoard;
  rentalConversion: RentalConversionBoard;
}): CustomerStrategistBoard {
  const plan30: StrategistPlay[] = [];
  const plan60: StrategistPlay[] = [];
  const plan90: StrategistPlay[] = [];

  const replacement = input.whiteSpace.opportunities.find((item) => item.type === "replacement") ?? null;
  const serviceCoverage = input.whiteSpace.opportunities.find((item) => item.type === "service_coverage") ?? null;
  const attachmentGap = input.whiteSpace.opportunities.find((item) => item.type === "attachment") ?? null;
  const partsGap = input.whiteSpace.opportunities.find((item) => item.type === "parts_penetration") ?? null;
  const rentalCandidate = input.rentalConversion.candidates[0] ?? null;
  const blockerCount = input.relationships.summary.blockers;
  const deciderCount = input.relationships.summary.deciders;
  const influencerCount = input.relationships.summary.influencers;

  if (replacement) {
    plan30.push({
      key: "30d-replacement",
      title: "Convert the highest-confidence replacement lane now",
      confidence: replacement.confidence,
      trace: replacement.evidence,
      actionLabel: "Open white-space",
      href: `/qrm/accounts/${input.accountId}/white-space`,
    });
  }

  if (blockerCount > 0 || ((input.relationships.summary.contacts > 0 || input.relationships.unmatchedStakeholders.length > 0) && deciderCount === 0)) {
    plan30.push({
      key: "30d-buyer-map",
      title: blockerCount > 0 ? "Resolve blocker stakeholders before pushing harder" : "Lock down the real decision maker before escalation",
      confidence: blockerCount > 0 ? "high" : "medium",
      trace: [
        `${blockerCount} blocker contact${blockerCount === 1 ? "" : "s"} are mapped on this account.`,
        `${deciderCount} decider contact${deciderCount === 1 ? "" : "s"} are currently resolved.`,
        `${input.relationships.unmatchedStakeholders.length} named stakeholder${input.relationships.unmatchedStakeholders.length === 1 ? "" : "s"} are still unmatched.`,
      ],
      actionLabel: "Open relationship map",
      href: `/qrm/accounts/${input.accountId}/relationship-map`,
    });
  }

  if (rentalCandidate) {
    plan30.push({
      key: "30d-rental-convert",
      title: "Pull the strongest rental-to-purchase candidate into active commercial motion",
      confidence: rentalCandidate.confidence,
      trace: rentalCandidate.reasons,
      actionLabel: "Open rental conversion",
      href: `/qrm/accounts/${input.accountId}/rental-conversion`,
    });
  }

  if (serviceCoverage) {
    plan60.push({
      key: "60d-service",
      title: "Expand planned service coverage across the installed fleet",
      confidence: serviceCoverage.confidence,
      trace: serviceCoverage.evidence,
      actionLabel: "Open white-space",
      href: `/qrm/accounts/${input.accountId}/white-space`,
    });
  }

  if (attachmentGap || partsGap) {
    plan60.push({
      key: "60d-attachments-parts",
      title: "Capture accessory and parts revenue the fleet should already be generating",
      confidence: strongestConfidence([
        attachmentGap?.confidence ?? "low",
        partsGap?.confidence ?? "low",
      ]),
      trace: [
        ...(attachmentGap?.evidence ?? []),
        ...(partsGap?.evidence ?? []),
      ].slice(0, 4),
      actionLabel: "Open white-space",
      href: `/qrm/accounts/${input.accountId}/white-space`,
    });
  }

  if (influencerCount > 0 || input.relationships.unmatchedStakeholders.length > 0) {
    plan60.push({
      key: "60d-committee",
      title: "Turn the buying committee into an operating map, not a hidden risk",
      confidence: "medium",
      trace: [
        `${influencerCount} influencer contact${influencerCount === 1 ? "" : "s"} are mapped.`,
        `${input.relationships.unmatchedStakeholders.length} named stakeholder${input.relationships.unmatchedStakeholders.length === 1 ? "" : "s"} still need CRM resolution.`,
        `${input.relationships.summary.signers} signer contact${input.relationships.summary.signers === 1 ? "" : "s"} are already known.`,
      ],
      actionLabel: "Open relationship map",
      href: `/qrm/accounts/${input.accountId}/relationship-map`,
    });
  }

  plan90.push({
    key: "90d-operating-plan",
    title: "Build the 90-day account plan around how this customer actually buys and works",
    confidence: "medium",
    trace: [
      `Work type: ${input.operatingProfile.workType.primary}.`,
      `Terrain: ${input.operatingProfile.terrain.primary}.`,
      `Buying style: ${input.operatingProfile.buyingStyle.primary}.`,
      `Budget behavior: ${input.operatingProfile.budgetBehavior.primary}.`,
    ],
    actionLabel: "Open operating profile",
    href: `/qrm/accounts/${input.accountId}/operating-profile`,
  });

  if (replacement || rentalCandidate) {
    plan90.push({
      key: "90d-fleet-shape",
      title: "Shape the fleet roadmap before replacement and rental motion fragment across teams",
      confidence: strongestConfidence([
        replacement?.confidence ?? "low",
        rentalCandidate?.confidence ?? "low",
      ]),
      trace: [
        ...(replacement?.evidence ?? []),
        ...(rentalCandidate?.reasons ?? []),
      ].slice(0, 4),
      actionLabel: "Open fleet intelligence",
      href: `/qrm/accounts/${input.accountId}/fleet-intelligence`,
    });
  }

  const plans: StrategistPlan[] = [
    {
      horizon: "30d",
      headline: "Stabilize and convert active motion",
      objective: "Remove current blockers, capitalize on replacement pressure, and turn near-term rental or buyer intent into committed revenue.",
      confidence: strongestConfidence(plan30.map((play) => play.confidence)),
      plays: clampPlays(plan30.length > 0 ? plan30 : [{
        key: "30d-steady",
        title: "No immediate rescue move is active; keep direct cadence tight",
        confidence: "low",
        trace: ["No replacement, blocker, or rental-conversion signal is elevated right now."],
        actionLabel: "Open account command",
        href: `/qrm/accounts/${input.accountId}/command`,
      }]),
    },
    {
      horizon: "60d",
      headline: "Expand coverage and tighten the buying committee",
      objective: "Capture service, parts, and attachment revenue while making the stakeholder map explicit enough to support a larger close.",
      confidence: strongestConfidence(plan60.map((play) => play.confidence)),
      plays: clampPlays(plan60.length > 0 ? plan60 : [{
        key: "60d-steady",
        title: "No expansion gap is dominant; keep monitoring whitespace and stakeholder drift",
        confidence: "low",
        trace: ["No service, attachment, parts, or committee-expansion signal is elevated right now."],
        actionLabel: "Open white-space",
        href: `/qrm/accounts/${input.accountId}/white-space`,
      }]),
    },
    {
      horizon: "90d",
      headline: "Shape the account strategy around operating reality",
      objective: "Turn the customer’s buying behavior, fleet shape, and whitespace into a coherent account-growth plan.",
      confidence: strongestConfidence(plan90.map((play) => play.confidence)),
      plays: clampPlays(plan90),
    },
  ];

  return {
    summary: {
      totalPlays: plans.reduce((sum, plan) => sum + plan.plays.length, 0),
      immediatePlays: plans[0]?.plays.length ?? 0,
      expansionPlays: plans[1]?.plays.length ?? 0,
      strategicPlays: plans[2]?.plays.length ?? 0,
    },
    plans,
  };
}
