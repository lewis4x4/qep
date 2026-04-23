/**
 * Iron role → short display name for UI chrome. Mirrors
 * `IRON_ROLE_INFO[...].display` but keeps the strings terse enough to
 * fit in role selectors and the top bar badge.
 */
import type { IronRole } from "@/features/qrm/lib/iron-roles";

export const IRON_ROLE_DISPLAY_NAMES: Record<IronRole, string> = {
  iron_manager: "Sales Manager",
  iron_advisor: "Sales Rep",
  iron_woman: "Deal Desk",
  iron_man: "Prep / Service",
  iron_owner: "Owner",
  iron_parts_counter: "Parts Counter",
  iron_parts_manager: "Parts Manager",
};
