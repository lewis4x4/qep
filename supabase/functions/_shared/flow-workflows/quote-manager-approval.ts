/**
 * Quote approval workflow definition.
 *
 * The quote builder currently creates the approval run directly so the
 * request appears immediately in the manager queue, but this definition
 * is still registered in Flow Admin so the approval path remains visible
 * and editable in the Flow Engine surface.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const quoteManagerApproval: FlowWorkflowDefinition = {
  slug: "quote-manager-approval",
  name: "Quote manager approval",
  description:
    "Routes submitted quotes to the sales manager for approval before they can be sent to the customer.",
  owner_role: "sales",
  trigger_event_pattern: "quote.approval.submitted",
  conditions: [
    { op: "exists", field: "event.properties.quote_package_id" },
  ],
  actions: [
    {
      action_key: "request_approval",
      params: {
        subject: "Quote approval required",
        detail:
          "A quote was submitted from Quote Builder and now requires manager approval before customer delivery.",
        assigned_role: "manager",
        due_in_hours: 24,
        escalate_in_hours: 48,
      },
    },
  ],
  affects_modules: ["sales", "qrm", "governance", "quote_builder"],
};
