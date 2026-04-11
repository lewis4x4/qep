import type { BranchCommandSummary, BranchServiceJobRow, BranchTrafficRow } from "./branch-command";

export interface BranchChiefRecommendation {
  key: string;
  headline: string;
  confidence: "high" | "medium" | "low";
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface BranchChiefBoard {
  summary: {
    recommendationCount: number;
    urgentCount: number;
    logisticsRisk: boolean;
    readinessRisk: boolean;
    revenueLeak: boolean;
  };
  recommendations: BranchChiefRecommendation[];
}

export function buildBranchChiefBoard(input: {
  branchId: string;
  summary: BranchCommandSummary;
  trafficTickets: BranchTrafficRow[];
  serviceJobs: BranchServiceJobRow[];
}): BranchChiefBoard {
  const recommendations: BranchChiefRecommendation[] = [];

  if (input.summary.readinessBlocked > 0) {
    recommendations.push({
      key: "clear-readiness",
      headline: "Clear intake and readiness blockers before they roll into missed delivery commitments",
      confidence: input.summary.readinessBlocked >= 3 ? "high" : "medium",
      trace: [
        `${input.summary.readinessBlocked} units are currently blocked in readiness.`,
        `${input.summary.readinessInPrep} units remain in branch prep.`,
        "Readiness blockers come from missing PDI completion or photo readiness in the branch intake queue.",
      ],
      actionLabel: "Open intake",
      href: "/ops/intake",
    });
  }

  if (input.summary.logisticsOpen > 0) {
    recommendations.push({
      key: "stabilize-logistics",
      headline: "Stabilize open branch logistics before they create downstream delivery misses",
      confidence: input.summary.logisticsOpen >= 4 ? "high" : "medium",
      trace: [
        `${input.summary.logisticsOpen} open logistics moves are currently touching this branch.`,
        `${input.summary.rentalMoves} of those moves are rental or re-rent traffic.`,
        "The branch command queue already shows these moves as active branch-controlled work.",
      ],
      actionLabel: "Open traffic",
      href: "/ops/traffic",
    });
  }

  if (input.summary.openArBalance > 0) {
    recommendations.push({
      key: "protect-cash",
      headline: "Protect branch cash by pulling down open AR before adding new exposure",
      confidence: input.summary.openArBalance >= 25_000 ? "high" : "medium",
      trace: [
        `Open AR balance is $${Math.round(input.summary.openArBalance).toLocaleString()}.`,
        `Branch-linked invoice revenue totals $${Math.round(input.summary.branchRevenue).toLocaleString()}.`,
        "Branch revenue and AR balance are pulled from live branch-tagged customer invoices.",
      ],
      actionLabel: "Open service invoice",
      href: "/service/invoice",
    });
  }

  if (input.summary.serviceLinkedSalesCount > 0) {
    recommendations.push({
      key: "convert-service",
      headline: "Push service-linked commercial opportunities while customers are already active in the branch",
      confidence: input.summary.serviceLinkedSalesCount >= 2 ? "high" : "medium",
      trace: [
        `${input.summary.serviceLinkedSalesCount} open deals belong to customers with active branch service jobs.`,
        `Those opportunities represent $${Math.round(input.summary.serviceLinkedSalesValue).toLocaleString()} in visible pipeline value.`,
        `${input.serviceJobs.filter((row) => row.current_stage !== "paid_closed").length} active service jobs remain open in this branch.`,
      ],
      actionLabel: "Open branch command",
      href: `/qrm/branches/${input.branchId}/command`,
    });
  }

  if (input.summary.rentalMoves > 0) {
    recommendations.push({
      key: "tighten-rental-motion",
      headline: "Tighten rental movement control before utilization slips into reactive transfers",
      confidence: input.summary.rentalMoves >= 2 ? "medium" : "low",
      trace: [
        `${input.summary.rentalMoves} rental or re-rent moves are still active.`,
        "Rental movement is already included in the branch logistics queue.",
        "Branch Chief should treat rental traffic as a commercial utilization signal, not just an ops issue.",
      ],
      actionLabel: "Open rentals",
      href: "/qrm/rentals",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      key: "steady-branch",
      headline: "Branch posture is stable; keep cadence tight and watch for the next commercial opening",
      confidence: "low",
      trace: [
        "No acute readiness, logistics, AR, service-linked sales, or rental-motion pressure is active.",
        `Branch revenue is $${Math.round(input.summary.branchRevenue).toLocaleString()}.`,
        `${input.summary.activeServiceJobs} active service jobs and ${input.summary.readinessInPrep} units in prep remain the main moving pieces.`,
      ],
      actionLabel: "Open branch command",
      href: `/qrm/branches/${input.branchId}/command`,
    });
  }

  return {
    summary: {
      recommendationCount: recommendations.length,
      urgentCount: recommendations.filter((item) => item.confidence === "high").length,
      logisticsRisk: input.summary.logisticsOpen > 0,
      readinessRisk: input.summary.readinessBlocked > 0,
      revenueLeak: input.summary.openArBalance > 0 || input.summary.serviceLinkedSalesCount > 0,
    },
    recommendations,
  };
}
