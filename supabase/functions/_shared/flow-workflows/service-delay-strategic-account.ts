/**
 * Flagship workflow (approval-gated): service.job.delayed on a strategic
 * account with an open opportunity → manager approval required to release
 * the rep alert + relationship-risk tag.
 *
 * Demonstrates the Slice 3 pattern: condition checks against the
 * flow_resolve_context output (customer_tier, deal, ar_block_status),
 * then a request_approval action that suspends the run until a manager
 * decides via decide_flow_approval RPC.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const serviceDelayStrategicAccount: FlowWorkflowDefinition = {
  slug: "service-delay-strategic-account",
  name: "Service delay on strategic account → manager-approved alert",
  description:
    "When a service job is delayed for a strategic-tier customer with an open opportunity, request manager approval before alerting the rep + tagging the account as a relationship risk.",
  owner_role: "service",
  trigger_event_pattern: "service.job.delayed",
  conditions: [
    { op: "eq", field: "context.customer_tier", value: "strategic" },
    { op: "exists", field: "context.deal" },
    { op: "no_recent_run", workflow_slug: "service-delay-strategic-account", hours: 24 },
  ],
  actions: [
    {
      action_key: "request_approval",
      params: {
        subject: "Service delay on strategic account",
        detail:
          "A service delay was detected on a strategic account with an open deal. Approve to escalate to the rep + tag the account as a relationship risk.",
        assigned_role: "manager",
        due_in_hours: 4,
        escalate_in_hours: 12,
      },
    },
    {
      action_key: "create_task",
      params: {
        activity_type: "follow_up",
        subject: "Strategic account service delay — follow up",
        body:
          "Service job ${event.properties.service_job_id} was delayed. Manager approved escalation. Reach out to the customer today.",
      },
    },
    {
      action_key: "tag_account",
      params: {
        company_id: "${context.company.id}",
        tag: "relationship_risk",
      },
      on_failure: "continue",
    },
  ],
  affects_modules: ["service", "qrm", "governance"],
};
