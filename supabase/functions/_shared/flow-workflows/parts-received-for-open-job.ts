/**
 * Flagship workflow: Parts received for an open service job → service writer notification.
 *
 * Trigger: parts.item.received (will be wired in Slice 3+ when parts_orders
 *   triggers are added to migration 195+).
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const partsReceivedForOpenJob: FlowWorkflowDefinition = {
  slug: "parts-received-for-open-job",
  name: "Parts received → service job update",
  description:
    "When parts arrive for an open service job, notify the assigned service writer so they can release the job from parts_waiting.",
  owner_role: "service",
  trigger_event_pattern: "parts.item.received",
  conditions: [
    { op: "exists", field: "event.properties.linked_service_job_id" },
  ],
  actions: [
    {
      action_key: "notify_service_recipient",
      params: {
        service_job_id: "${event.properties.linked_service_job_id}",
        title: "Parts arrived",
        body: "Parts for stock ${event.properties.stock_number} have arrived. The job is ready to move out of parts_waiting.",
        severity: "info",
      },
    },
    {
      action_key: "create_audit_event",
      params: {
        tag: "parts_to_service_handoff",
        metadata: {
          parts_order_id: "${event.properties.parts_order_id}",
          service_job_id: "${event.properties.linked_service_job_id}",
        },
      },
    },
  ],
  affects_modules: ["service", "parts"],
};
