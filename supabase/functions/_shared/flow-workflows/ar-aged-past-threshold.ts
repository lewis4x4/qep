/**
 * Flagship workflow: A/R aged past threshold → block + tag + exception.
 *
 * Trigger: invoice.aged_past_threshold (will be emitted by a future
 *   nightly aging check; manually testable via emit_event in the meantime).
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const arAgedPastThreshold: FlowWorkflowDefinition = {
  slug: "ar-aged-past-threshold",
  name: "A/R aged past threshold → block + escalate",
  description:
    "When a customer's A/R crosses the aging threshold, tag the company, create an exception in the inbox, and request controller approval to lift any auto-block.",
  owner_role: "accounting",
  trigger_event_pattern: "invoice.aged_past_threshold",
  conditions: [
    { op: "gte", field: "event.payload.days_overdue", value: 60 },
  ],
  actions: [
    {
      action_key: "tag_account",
      params: {
        company_id: "${event.payload.company_id}",
        tag: "ar_block_pending",
      },
    },
    {
      action_key: "create_exception",
      params: {
        source: "ar_override_pending",
        title: "A/R aging threshold exceeded",
        severity: "error",
        detail:
          "Account is ${event.payload.days_overdue} days past due on $${event.payload.amount_outstanding}. Block financing until resolved.",
      },
    },
    {
      action_key: "request_approval",
      params: {
        subject: "AR override decision",
        detail:
          "Controller approval required to allow continued financing on ${event.payload.company_id}.",
        assigned_role: "accounting",
      },
      on_failure: "continue",
    },
  ],
  affects_modules: ["accounting", "qrm"],
};
