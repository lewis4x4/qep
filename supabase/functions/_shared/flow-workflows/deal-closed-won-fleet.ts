/**
 * N4.1 customer-fleet writer: deal closed-won with a subject unit →
 * create/link the customer_fleet row.
 *
 * Consumes the m801-enriched deal.stage.changed payload (is_closed_won +
 * equipment_id). link_customer_fleet resolves a company-anchored portal
 * identity (real contact or shadow) via qep_find_or_create_portal_identity
 * and upserts customer_fleet on (workspace_id, equipment_id) — un-starving
 * the ~12 consumers (predictive kitter/failure/AI, upsell scanner, portal
 * notifications, Asset 360 parts tab) that scanned zero rows since m082.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const dealClosedWonFleet: FlowWorkflowDefinition = {
  slug: "deal-closed-won-fleet",
  name: "Closed won → customer fleet row",
  description:
    "When a deal closes won with a subject unit attached, record the machine in the customer's fleet so predictive parts, upsell, and portal surfaces see real ownership.",
  owner_role: "sales",
  trigger_event_pattern: "deal.stage.changed",
  // Field root note: conditions resolve against `payload.*` (the event's
  // properties) — `payload.*` silently resolves undefined.
  conditions: [
    { op: "eq", field: "payload.is_closed_won", value: true },
    { op: "exists", field: "payload.equipment_id" },
  ],
  actions: [
    {
      action_key: "link_customer_fleet",
      params: {
        equipment_id: "${payload.equipment_id}",
        company_id: "${payload.company_id}",
        deal_id: "${payload.deal_id}",
        closed_at: "${payload.closed_at}",
      },
    },
    {
      action_key: "create_audit_event",
      params: {
        tag: "customer_fleet_linked",
        metadata: {
          deal_id: "${payload.deal_id}",
          equipment_id: "${payload.equipment_id}",
          company_id: "${payload.company_id}",
        },
      },
    },
  ],
  affects_modules: ["qrm", "parts", "service"],
};
