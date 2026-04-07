/**
 * Flagship workflow (approval-gated): ar.block.created → controller
 * approval required to allow continued financing.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const arOverrideRequest: FlowWorkflowDefinition = {
  slug: "ar-override-request",
  name: "AR block override request → controller approval",
  description:
    "When an AR block is created on an account, automatically request a controller approval (escalating to owner if unresolved within 12 hours) so the business does not stall waiting for manual intake.",
  owner_role: "accounting",
  trigger_event_pattern: "ar.block.created",
  conditions: [
    { op: "exists", field: "event.payload.company_id" },
  ],
  actions: [
    {
      action_key: "request_approval",
      params: {
        subject: "AR override decision needed",
        detail:
          "Account has an active AR block. Approve to allow continued financing pending resolution; reject to maintain the block and prompt collections.",
        assigned_role: "accounting",
        due_in_hours: 4,
        escalate_in_hours: 12,
      },
    },
    {
      action_key: "create_audit_event",
      params: {
        tag: "ar_override_requested",
        metadata: {
          company_id: "${event.payload.company_id}",
          amount_outstanding: "${event.payload.amount_outstanding}",
        },
      },
    },
  ],
  affects_modules: ["accounting", "governance"],
};
