import type { NeedsAssessment } from "./deal-composite-types";
import type { RelationshipMapBoard, RelationshipMapContact } from "./relationship-map";

export type DecisionRoomConfidence = "high" | "medium" | "low";

export interface DecisionRoomScenario {
  key: string;
  title: string;
  confidence: DecisionRoomConfidence;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface DecisionRoomSeat {
  key: string;
  label: string;
  confidence: DecisionRoomConfidence;
  roleSummary: string;
  trace: string[];
}

export interface DecisionRoomBoard {
  summary: {
    namedParticipants: number;
    ghostParticipants: number;
    blockerCount: number;
    scenarioCount: number;
  };
  seats: DecisionRoomSeat[];
  scenarios: DecisionRoomScenario[];
}

function strongestConfidence(values: DecisionRoomConfidence[]): DecisionRoomConfidence {
  if (values.includes("high")) return "high";
  if (values.includes("medium")) return "medium";
  return "low";
}

function roleLabel(contact: RelationshipMapContact): string {
  return contact.roles
    .map((role) => role.replace(/_/g, " "))
    .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
    .join(" · ");
}

export function buildDecisionRoomBoard(input: {
  dealId: string;
  relationship: RelationshipMapBoard;
  needsAssessment: NeedsAssessment | null;
  blockerPresent: boolean;
  openTaskCount: number;
  overdueTaskCount: number;
  pendingApprovalCount: number;
  quotePresented: boolean;
}): DecisionRoomBoard {
  const roomHref = `/qrm/deals/${input.dealId}/room`;
  const detailHref = `/qrm/deals/${input.dealId}`;
  const coachHref = `/qrm/deals/${input.dealId}/coach`;

  const seats: DecisionRoomSeat[] = input.relationship.contacts.map((contact) => ({
    key: contact.contactId,
    label: contact.name,
    confidence: contact.roles.includes("decider") || contact.roles.includes("signer")
      ? "high"
      : contact.roles.includes("blocker") || contact.roles.includes("influencer")
        ? "medium"
        : "low",
    roleSummary: roleLabel(contact),
    trace: contact.evidence.slice(0, 3),
  }));

  const scenarios: DecisionRoomScenario[] = [];
  const deciders = input.relationship.summary.deciders;
  const signers = input.relationship.summary.signers;
  const blockers = input.relationship.summary.blockers + (input.blockerPresent ? 1 : 0);
  const operators = input.relationship.summary.operators;
  const ghosts = input.relationship.unmatchedStakeholders.length;
  const monthlyTarget = input.needsAssessment?.monthly_payment_target;
  const budgetType = input.needsAssessment?.budget_type;
  const financingPreference = input.needsAssessment?.financing_preference;
  const urgency = input.needsAssessment?.timeline_urgency;
  const equipmentPain = input.needsAssessment?.current_equipment_issues;

  if (deciders === 0 || ghosts > 0) {
    scenarios.push({
      key: "hidden-decider",
      title: "A hidden decider can still change the outcome outside the visible room",
      confidence: deciders === 0 ? "high" : "medium",
      trace: [
        `${deciders} mapped decider${deciders === 1 ? "" : "s"} are currently resolved.`,
        `${ghosts} named stakeholder${ghosts === 1 ? "" : "s"} remain outside CRM contact resolution.`,
        input.needsAssessment?.decision_maker_name
          ? `Latest assessment named ${input.needsAssessment.decision_maker_name} as decision maker evidence.`
          : "No explicit decision-maker name is locked in the latest assessment.",
      ],
      actionLabel: "Open deal room",
      href: roomHref,
    });
  }

  if (blockers > 0 || input.pendingApprovalCount > 0) {
    scenarios.push({
      key: "procurement-stall",
      title: "A blocker or approval step can stall procurement even if the rep conversation looks warm",
      confidence: blockers > 0 ? "high" : "medium",
      trace: [
        `${blockers} blocker signal${blockers === 1 ? "" : "s"} are active across relationship and deal state.`,
        `${input.pendingApprovalCount} pending approval${input.pendingApprovalCount === 1 ? "" : "s"} remain in the room.`,
        input.overdueTaskCount > 0
          ? `${input.overdueTaskCount} overdue task${input.overdueTaskCount === 1 ? "" : "s"} can slow the room down further.`
          : "No overdue room tasks are currently visible.",
      ],
      actionLabel: "Open deal coach",
      href: coachHref,
    });
  }

  if (operators > 0 || equipmentPain || urgency) {
    scenarios.push({
      key: "operator-pressure",
      title: "Operators can force an uptime-first decision if machine pain is real enough",
      confidence: equipmentPain || urgency ? "high" : "medium",
      trace: [
        `${operators} mapped operator${operators === 1 ? "" : "s"} are already in the room.`,
        equipmentPain ? `Equipment pain captured: ${equipmentPain}.` : "No explicit equipment issue was captured.",
        urgency ? `Timeline urgency: ${urgency}.` : "No explicit urgency level is recorded.",
      ],
      actionLabel: "Open detail",
      href: detailHref,
    });
  }

  if (signers > 0 || monthlyTarget != null || budgetType || financingPreference) {
    scenarios.push({
      key: "finance-frame",
      title: "The room can shift to payment framing before it shifts to machine preference",
      confidence: monthlyTarget != null || financingPreference ? "high" : "medium",
      trace: [
        `${signers} signer${signers === 1 ? "" : "s"} are already visible in the room.`,
        monthlyTarget != null ? `Monthly target captured at $${Math.round(monthlyTarget).toLocaleString()}.` : "No monthly payment target is recorded.",
        budgetType ? `Budget type: ${budgetType}.` : "Budget type is not recorded.",
        financingPreference ? `Financing preference: ${financingPreference}.` : "Financing preference is not recorded.",
      ],
      actionLabel: "Open deal room",
      href: roomHref,
    });
  }

  if (scenarios.length === 0) {
    scenarios.push({
      key: "stable-room",
      title: "The visible decision room is relatively stable right now",
      confidence: "low",
      trace: [
        "No hidden decider, blocker, or payment-framing signal is elevated right now.",
        input.quotePresented ? "A quote has already been presented into the room." : "No quote has been presented yet.",
        `${input.openTaskCount} open task${input.openTaskCount === 1 ? "" : "s"} remain attached to the deal.`,
      ],
      actionLabel: "Open deal room",
      href: roomHref,
    });
  }

  return {
    summary: {
      namedParticipants: input.relationship.summary.contacts,
      ghostParticipants: ghosts,
      blockerCount: blockers,
      scenarioCount: scenarios.length,
    },
    seats,
    scenarios: scenarios.slice(0, 4),
  };
}
