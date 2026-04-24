import type { IronRole } from "@/features/qrm/lib/iron-roles";

/**
 * Deterministic role-home copy used when the narrative edge function is stale,
 * offline, or unavailable.
 */
export function buildStaticNarrative(role: IronRole, firstName: string): string {
  const greeting = firstName ? `${firstName}, ` : "";
  switch (role) {
    case "iron_owner":
      return `${greeting}business health is summarized below with the highest-risk work surfaced first.`;
    case "iron_manager":
      return `${greeting}approvals, stale deals, and pipeline pressure are ready for review.`;
    case "iron_advisor":
      return `${greeting}today's selling motion is ordered by the next action most likely to move a deal.`;
    case "iron_woman":
      return `${greeting}deposits, credit apps, and processing blockers are queued for clearing.`;
    case "iron_man":
      return `${greeting}service work is organized around the next job and the open parts blockers.`;
    case "iron_parts_counter":
      return `${greeting}start with serial lookup, then quote and finish the counter request.`;
    case "iron_parts_manager":
      return `${greeting}stock health, demand, and supplier pressure are grouped for review.`;
  }
}
