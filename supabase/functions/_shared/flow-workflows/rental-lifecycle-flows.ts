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
      { op: "exists", field: "payload.rental_id" },
      { op: "eq", field: "payload.delivery_required", value: true },
    ],
    actions: [
      {
        action_key: "create_traffic_ticket",
        params: {
          direction: "delivery",
          rental_contract_id: "${payload.rental_id}",
          contract_number: "${payload.contract_number}",
          equipment_id: "${payload.equipment_id}",
          to_location: "${payload.delivery_location}",
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
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      {
        action_key: "create_traffic_ticket",
        params: {
          direction: "pickup",
          rental_contract_id: "${payload.rental_id}",
          contract_number: "${payload.contract_number}",
          equipment_id: "${payload.equipment_id}",
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
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "rental_return_inspection",
          subject: "Return inspection: ${payload.contract_number}",
          body:
            "Contract ${payload.contract_number} returned. Complete the condition inspection, code charges, and dispose any damage in /ops/returns.",
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
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "Overdue rental ${payload.contract_number} (${payload.days_overdue}d)",
          body:
            "Contract ${payload.contract_number} is ${payload.days_overdue} day(s) past ${payload.ends_at}. Call the customer: extend, off-rent, or schedule pickup.",
        },
      },
      {
        action_key: "create_exception",
        params: {
          source: "rental_overdue_return",
          title: "Rental overdue: ${payload.contract_number}",
          severity: "warn",
          detail: "Due ${payload.ends_at}; state ${payload.lifecycle_state}.",
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
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "COI expiring: ${payload.contract_number}",
          body:
            "Certificate of insurance for ${payload.contract_number} expires ${payload.coi_expires_at}. Request the renewed COI from the customer.",
        },
      },
      {
        action_key: "create_exception",
        params: {
          source: "rental_coi_expired",
          title: "COI expiring on live rental ${payload.contract_number}",
          severity: "warn",
          detail: "Expires ${payload.coi_expires_at}.",
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
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "Idle off-rent unit (${payload.idle_days}d): ${payload.contract_number}",
          body:
            "Unit has been off-rent ${payload.idle_days} day(s) awaiting pickup — it is earning nothing in the field. Confirm the haul ticket is scheduled or reassign it.",
        },
      },
    ],
    affects_modules: ["rental", "logistics"],
  },
  {
    slug: "rental-availability-low",
    name: "Low fleet availability → re-source task",
    description:
      "Category fleet headroom is ≤1 unit over the next 14 days. Task rentals ops to re-source, re-rent, or rebalance.",
    owner_role: "rental",
    trigger_event_pattern: "rental.availability.low",
    conditions: [{ op: "exists", field: "payload.category" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "Low availability: ${payload.category} (headroom ${payload.headroom})",
          body:
            "Fleet category ${payload.category} has only ${payload.headroom} unit(s) free against ${payload.overlapping_demand} overlapping demand over the next ${payload.window_days} days (fleet ${payload.fleet_count}). Re-source a re-rent, pull from another branch, or push reservation windows.",
        },
      },
      {
        action_key: "create_exception",
        params: {
          source: "rental_availability_low",
          title: "Low rental availability: ${payload.category}",
          severity: "warn",
          detail:
            "headroom=${payload.headroom} demand=${payload.overlapping_demand} fleet=${payload.fleet_count}",
        },
        on_failure: "continue",
      },
    ],
    affects_modules: ["rental", "ops"],
  },
  {
    slug: "rental-cycle-due",
    name: "Billing cycle due → confirm nightly run",
    description:
      "An on-rent contract is approaching or past a cycle invoice boundary. Ops should confirm the billing runner will pick it up.",
    owner_role: "rental",
    trigger_event_pattern: "rental.cycle.due",
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "Cycle bill due: ${payload.contract_number}",
          body:
            "Contract ${payload.contract_number} has a cycle boundary near ${payload.last_period_end}. Confirm the rental-billing-runner includes it tonight.",
        },
      },
    ],
    affects_modules: ["rental", "finance"],
  },
  {
    slug: "rental-geofence-exit",
    name: "Geofence exit on rented iron → inspection prompt",
    description:
      "An on-rent unit left its jobsite geofence (theft/unauthorized-move exception already queued by the DB trigger): prompt the off-rent inspection decision.",
    owner_role: "rental",
    trigger_event_pattern: "rental.geofence.exit",
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "Geofence exit: ${payload.contract_number}",
          body:
            "Unit on ${payload.contract_number} exited its geofence at ${payload.event_at}. Confirm with the customer: authorized move (update jobsite), off-rent (start the return), or escalate the theft exception.",
        },
      },
    ],
    affects_modules: ["rental", "ops"],
  },
  {
    slug: "rental-telematics-overage",
    name: "Telematics overage early warning → rep task",
    description:
      "Telematics hours already exceed the included-hours allowance (110%) mid-rental: warn the rep before the final invoice surprises the customer.",
    owner_role: "rental",
    trigger_event_pattern: "rental.telematics.overage",
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      {
        action_key: "create_task",
        params: {
          activity_type: "follow_up",
          subject: "Hour overage building: ${payload.contract_number}",
          body:
            "Telematics shows ${payload.hours_used}h used against ${payload.included_hours}h included on ${payload.contract_number}. Call the customer: extend the allowance, upsell the next tier, or set expectations for overage billing.",
        },
      },
    ],
    affects_modules: ["rental", "qrm"],
  },
  {
    slug: "rental-rpo-threshold",
    name: "RPO credit threshold → sales motion",
    description:
      "Accrued rental credit crossed the RPO threshold (emitted by the L5 billing engine on paid RPO invoices): nudge the rep toward conversion.",
    owner_role: "rental",
    trigger_event_pattern: "rental.rpo.threshold_reached",
    conditions: [{ op: "exists", field: "payload.rental_id" }],
    actions: [
      // L9.3: the accrued credit becomes a real deal (amount = buyout −
      // accrued, unit linked as subject, provenance on rental_contract_id).
      // The old create_task here failed on a null activity anchor — the
      // threshold payload carries no company/deal, so the "sales motion"
      // never landed (RF-024).
      {
        action_key: "create_rental_conversion_deal",
        params: { rental_id: "${payload.rental_id}" },
      },
    ],
    affects_modules: ["rental", "qrm"],
  },
];

/* ─── Iron conversational origination (Stream L / L6) ─────────────────────
 * Dispatched synchronously by iron-execute-flow-step (surface below); the
 * trigger pattern is the runner's safety net, same as iron-flows.ts.
 * Drafts only: "put a 320 on rent to Acme for two weeks" becomes a DRAFT
 * counter contract — the 769/770/773 guard stack owns reserve and check-out,
 * so Iron can never bypass security, inspection, or signature gates. */
export const ironOpenRentalContract: FlowWorkflowDefinition = {
  slug: "iron.open_rental_contract",
  name: "Iron · Open a rental contract",
  description:
    "Draft a counter rental contract from voice or chat: customer, dates, optional unit and rate. The draft lands in the Rental Command Center for reserve → inspect → check out.",
  owner_role: "shared",
  conditions: [],
  enabled: true,
  surface: "iron_conversational",
  trigger_event_pattern: "iron.intent.open_rental_contract",
  affects_modules: ["rental"],
  feature_flag: "iron.flow.open_rental_contract",
  roles_allowed: ["rep", "admin", "manager", "owner"],
  actions: [
    {
      action_key: "iron_open_rental_contract",
      params: {},
      description: "Insert a draft rental_contracts row (origination_channel=iron)",
    },
  ],
  iron_metadata: {
    iron_role: "iron_advisor",
    short_label: "Open a rental",
    voice_intent_keywords: [
      "put on rent",
      "rent out",
      "open a rental",
      "rental contract",
      "rent a machine",
      "reserve a rental",
    ],
    voice_open_prompt: "Sure. Which customer is renting?",
    voice_review_prompt:
      "Drafting a ${contract_type} for ${customer_name}, ${start_date} to ${end_date}. Create it?",
    action_key: "iron_open_rental_contract",
    prefill_from_route: {
      qrm_company_id: "route.params.company_id",
    },
    slot_schema: [
      {
        id: "qrm_company_id",
        label: "Customer",
        type: "entity_picker",
        required: true,
        entity_table: "qrm_companies",
        entity_search_column: "name",
        helper_text: "Type to search a company. Iron pre-fills from the page you're on.",
        merge_strategy: "auto_if_unrelated",
      },
      {
        id: "start_date",
        label: "Start date",
        type: "text",
        required: true,
        placeholder: "YYYY-MM-DD",
        helper_text: "Voice: 'starting Tuesday' — Iron normalizes to a date.",
      },
      {
        id: "end_date",
        label: "End date",
        type: "text",
        required: true,
        placeholder: "YYYY-MM-DD",
        helper_text: "Voice: 'for two weeks' — Iron computes the end date.",
      },
      {
        id: "contract_type",
        label: "Type",
        type: "choice",
        required: false,
        default_value: "rental",
        choices: [
          { value: "rental", label: "Rental" },
          { value: "reservation", label: "Reservation" },
          { value: "demo", label: "Demo" },
          { value: "loaner", label: "Loaner" },
        ],
      },
      {
        id: "equipment_id",
        label: "Unit (optional)",
        type: "entity_picker",
        required: false,
        entity_table: "qrm_equipment",
        entity_search_column: "name",
        helper_text: "Pick the exact machine, or leave for later assignment.",
      },
      {
        id: "daily_rate",
        label: "Daily rate (optional)",
        type: "text",
        required: false,
        placeholder: "e.g. 350",
        helper_text: "Dollars per day; rate rules resolve the full book at quote time.",
      },
      {
        id: "notes",
        label: "Notes",
        type: "longtext",
        required: false,
        placeholder: "Anything the counter should know",
      },
      {
        id: "review",
        label: "Review",
        type: "review",
        required: true,
      },
    ],
  },
};

RENTAL_FLOW_DEFINITIONS.push(ironOpenRentalContract);
