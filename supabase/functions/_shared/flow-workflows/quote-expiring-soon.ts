/**
 * Flagship workflow: Quote expiring soon → rep task + email draft.
 *
 * Trigger: quote.expiring_soon (fired by a future cron checker that scans
 *   quote_packages where expires_at < now() + 7 days; for Slice 2 the
 *   trigger can also be invoked manually via emit_event for testing).
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const quoteExpiringSoon: FlowWorkflowDefinition = {
  slug: "quote-expiring-soon",
  name: "Quote expiring soon → rep task + email draft",
  description:
    "When a quote is within 7 days of expiry, create a rep follow-up task and a customer email draft awaiting send.",
  owner_role: "sales",
  trigger_event_pattern: "quote.expiring_soon",
  conditions: [
    { op: "exists", field: "event.properties.quote_id" },
    { op: "neq", field: "event.properties.status", value: "expired" },
  ],
  actions: [
    {
      action_key: "create_task",
      params: {
        activity_type: "follow_up",
        subject: "Quote ${event.properties.quote_id} expires soon",
        body: "Reach out to the customer before the quote expires. Net total: $${event.properties.net_total}.",
      },
    },
    {
      action_key: "send_email_draft",
      params: {
        to_email: "${event.properties.customer_email}",
        subject: "Your quote is expiring soon",
        body: "We wanted to remind you that your quote is set to expire on ${event.properties.expires_at}. Let us know how you would like to proceed.",
      },
      on_failure: "continue",
    },
  ],
  affects_modules: ["qrm", "communications"],
};
