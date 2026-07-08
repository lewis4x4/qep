/**
 * Stream L / L4 — rental lifecycle workflows (blueprint §5).
 *
 * These react to the rental.* event fabric (migration 775: row emitters +
 * the 15-minute rental_lifecycle_scan cron). The existing standalone
 * `rental-nearing-end` workflow keeps its file; everything else lives here.
 * rental-rpo-threshold listens for the event the L5 billing engine will emit
 * on paid RPO invoices — registering the listener first is deliberate.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const RENTAL_FLOW_DEFINITIONS: FlowWorkflowDefinition[] = [
  {
    slug: "rental-contract-opened",
    name: "Rental opened → schedule delivery",
    description:
      "When a contract goes on rent with delivery required, put the delivery on the traffic board automatically.",
    owner_role: "rental",
    trigger_event_pattern: "rental.contract.opened",
    conditions: [
      { op: "exists", field: "event.payload.rental_id" },
      { op: "eq", field: "event.payload.delivery_required", value: true },
    ],
    actions: [
      {
        action_key: "create_traffic_ticket",
        params: {
          direction: "delivery",
          rental_contract_id: "${event.payload.rental_id}",
          contract_number: "${event.payload.contract_number}",
          equipment_id: "${event.payload.equipment_id}",
          to_location: "${event.payload.delivery_location}",
        },
      },
      {
        action_key: "create_audit_event",
        params: { tag: "rental_delivery_scheduled" },
        on_failure: "continue",
      },
    ],
    affects_modules: ["rental", "logistics"],
  },
  {
    slug: "rental-off-rent-pickup",
    name: "Off-rent → pickup ticket",
    description:
      "The clock stopped: the unit is idle in the field. Create the pickup haul ticket immediately and audit the stop.",
    owner_role: "rental",
    trigger_event_pattern: "rental.off_rent",
    conditions: [{ op: "exists", field: "event.payload.rental_id" }],
    actions: [
      {
        action_key: "create_traffic_ticket",
        params: {
          direction: "pickup",
          rental_contract_id: "${event.payload.rental_id}",
          contract_number: "${event.payload.contract_number}",
          equipment_id: "${event.payload.equipment_id}",
        },
      },
      {
        action_key: "create_audit_event",
        params: { tag: "rental_clock_stopped" },
        on_failure: "continue",
      },
    ],
    affects_modules: ["rental", "logistics"],
  },
  {
    slug: "rental-returned-inspection",
    name: "Returned → condition inspection task",
    description:
      "Unit physically back: queue the return condition inspection so charges and disposition happen while evidence is fresh.",
    owner_role: "rental",
    trigger_event_pattern: "rental.returned",
    conditions: [{ op: "exists", field: "event.payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "rental_return_inspection",
          subject: "Return inspection: ${event.payload.contract_number}",
          body:
            "Contract ${event.payload.contract_number} returned. Complete the condition inspection, code charges, and dispose any damage in /ops/returns.",
        },
      },
    ],
    affects_modules: ["rental", "ops"],
  },
  {
    slug: "rental-overdue-escalation",
    name: "Overdue rental → rep task + exception",
    description:
      "Contract past its end date with the clock still running: task the rep and put it in the human work queue.",
    owner_role: "rental",
    trigger_event_pattern: "rental.overdue",
    conditions: [{ op: "exists", field: "event.payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "Overdue rental ${event.payload.contract_number} (${event.payload.days_overdue}d)",
          body:
            "Contract ${event.payload.contract_number} is ${event.payload.days_overdue} day(s) past ${event.payload.ends_at}. Call the customer: extend, off-rent, or schedule pickup.",
        },
      },
      {
        action_key: "create_exception",
        params: {
          source: "rental_overdue_return",
          title: "Rental overdue: ${event.payload.contract_number}",
          severity: "warn",
          detail: "Due ${event.payload.ends_at}; state ${event.payload.lifecycle_state}.",
        },
        on_failure: "continue",
      },
    ],
    affects_modules: ["rental", "ops"],
  },
  {
    slug: "rental-coi-expiring",
    name: "COI expiring → renewal chase",
    description:
      "Certificate of insurance lapses within 14 days on a live rental: chase the renewal before the dealership is exposed.",
    owner_role: "rental",
    trigger_event_pattern: "rental.coi.expiring",
    conditions: [{ op: "exists", field: "event.payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "COI expiring: ${event.payload.contract_number}",
          body:
            "Certificate of insurance for ${event.payload.contract_number} expires ${event.payload.coi_expires_at}. Request the renewed COI from the customer.",
        },
      },
      {
        action_key: "create_exception",
        params: {
          source: "rental_coi_expired",
          title: "COI expiring on live rental ${event.payload.contract_number}",
          severity: "warn",
          detail: "Expires ${event.payload.coi_expires_at}.",
        },
        on_failure: "continue",
      },
    ],
    affects_modules: ["rental", "ops"],
  },
  {
    slug: "rental-idle-aging",
    name: "Idle off-rent iron → pickup escalation",
    description:
      "A unit has sat off-rent in the field for 3+ days — non-billable, non-earning. Escalate the pickup.",
    owner_role: "rental",
    trigger_event_pattern: "rental.unit.idle_aging",
    conditions: [{ op: "exists", field: "event.payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "Idle off-rent unit (${event.payload.idle_days}d): ${event.payload.contract_number}",
          body:
            "Unit has been off-rent ${event.payload.idle_days} day(s) awaiting pickup — it is earning nothing in the field. Confirm the haul ticket is scheduled or reassign it.",
        },
      },
    ],
    affects_modules: ["rental", "logistics"],
  },
  {
    slug: "rental-rpo-threshold",
    name: "RPO credit threshold → sales motion",
    description:
      "Accrued rental credit crossed the RPO threshold (emitted by the L5 billing engine on paid RPO invoices): nudge the rep toward conversion.",
    owner_role: "rental",
    trigger_event_pattern: "rental.rpo.threshold_reached",
    conditions: [{ op: "exists", field: "event.payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "RPO conversion window: ${event.payload.contract_number}",
          body:
            "Accrued rental credit reached ${event.payload.accrued_credit} against the purchase option. Open the conversion conversation before the exercise deadline ${event.payload.rpo_exercise_deadline}.",
        },
      },
    ],
    affects_modules: ["rental", "qrm"],
  },
];
