/**
 * QRM Command Center — role-variant section ordering.
 *
 * Per the spec (§9 "Role-based variants") every Iron role sees the same
 * sections, but the **order and emphasis** differs. The backend payload is
 * identical across roles; this module is the single source of truth for how
 * the sections are arranged on the page for each role.
 *
 * Section keys map 1:1 to the SectionKey union in commandCenter.types.ts.
 * Slice 1 ships only four sections; the other section identifiers will be
 * folded in by Slice 2/3 without changing the role-variant contract.
 */

import type { IronRole, SectionKey } from "../api/commandCenter.types";

export type RoleVariantSection = SectionKey;

const ADVISOR_ORDER: RoleVariantSection[] = [
  "commandStrip",
  "aiChiefOfStaff",
  "actionLanes",
  "relationshipEngine",
  "revenueRealityBoard",
  "dealerRealityGrid",
  "pipelinePressure",
  "knowledgeGaps",
  "executiveIntel",
];

const MANAGER_ORDER: RoleVariantSection[] = [
  "commandStrip",
  "executiveIntel",
  "revenueRealityBoard",
  "dealerRealityGrid",
  "relationshipEngine",
  "pipelinePressure",
  "aiChiefOfStaff",
  "actionLanes",
  "knowledgeGaps",
];

const WOMAN_ORDER: RoleVariantSection[] = [
  "commandStrip",
  "actionLanes",
  "revenueRealityBoard",
  "dealerRealityGrid",
  "relationshipEngine",
  "aiChiefOfStaff",
  "pipelinePressure",
  "knowledgeGaps",
  "executiveIntel",
];

const MAN_ORDER: RoleVariantSection[] = [
  "commandStrip",
  "actionLanes",
  "revenueRealityBoard",
  "dealerRealityGrid",
  "relationshipEngine",
  "pipelinePressure",
  "aiChiefOfStaff",
  "knowledgeGaps",
  "executiveIntel",
];

export function getSectionOrder(role: IronRole): RoleVariantSection[] {
  switch (role) {
    case "iron_advisor":
      return ADVISOR_ORDER;
    case "iron_manager":
      return MANAGER_ORDER;
    case "iron_woman":
      return WOMAN_ORDER;
    case "iron_man":
      return MAN_ORDER;
  }
}

export function getRoleHeadline(role: IronRole): { title: string; subtitle: string } {
  switch (role) {
    case "iron_advisor":
      return {
        title: "QRM Command Center",
        subtitle: "Best move now, biggest risk now, fastest path to revenue now.",
      };
    case "iron_manager":
      return {
        title: "QRM Command Center",
        subtitle: "Pipeline pressure, blocked deals, and approvals waiting on you.",
      };
    case "iron_woman":
      return {
        title: "QRM Command Center",
        subtitle: "Deposits, credit, processing — clear today's blockers.",
      };
    case "iron_man":
      return {
        title: "QRM Command Center",
        subtitle: "Equipment readiness and prep tasks driving today's revenue.",
      };
  }
}
