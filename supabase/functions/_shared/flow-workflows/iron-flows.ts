/**
 * Wave 7 Iron Companion — v1 conversational flow definitions.
 *
 * Six flows whose backing tables are verified to exist in the repo today.
 * Each flow is a `FlowWorkflowDefinition` with `surface = 'iron_conversational'`,
 * which the flow-runner auto-syncs into `flow_workflow_definitions` on every
 * tick (carrying iron_metadata, undo_handler, etc.).
 *
 * Iron flows are NOT consumed by the polling runner — they are dispatched
 * synchronously by `iron-execute-flow-step`. Their `trigger_event_pattern`
 * is set to `iron.intent.<slug>` so that even if a stray event lands, the
 * runner can match and execute via the action registry as a safety net.
 *
 * Flagship: iron.pull_part.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

const SHARED: Pick<
  FlowWorkflowDefinition,
  "owner_role" | "conditions" | "enabled" | "surface"
> = {
  owner_role: "shared",
  conditions: [],
  enabled: true,
  surface: "iron_conversational",
};

/* ─── 1. iron.pull_part (FLAGSHIP) ──────────────────────────────────────── */

export const ironPullPart: FlowWorkflowDefinition = {
  ...SHARED,
  slug: "iron.pull_part",
  name: "Iron · Pull a part",
  description:
    "Counter parts pull driven by Iron voice or text. Pre-fills the customer from the current route, accepts one or more line items, and creates a draft parts order via parts_orders + parts_order_lines.",
  trigger_event_pattern: "iron.intent.pull_part",
  affects_modules: ["parts"],
  undo_handler: "iron_pull_part",
  undo_semantic_rule: "select status = 'draft' from public.parts_orders where id = $1",
  feature_flag: "iron.flow.pull_part",
  roles_allowed: ["rep", "admin", "manager", "owner"],
  actions: [
    {
      action_key: "iron_pull_part",
      params: {},
      description: "Insert parts_orders header + parts_order_lines + parts_order_events('created')",
    },
  ],
  iron_metadata: {
    iron_role: "iron_advisor",
    short_label: "Pull a part",
    voice_intent_keywords: [
      "pull a part",
      "pull part",
      "parts order",
      "create parts order",
      "counter sale",
      "need a part",
    ],
    voice_open_prompt: "Sure. Which customer is this for?",
    voice_review_prompt:
      "Got it. ${line_count} line${line_plural} for ${customer_name}, total ${total_display}. Want me to create the order?",
    action_key: "iron_pull_part",
    prefill_from_route: {
      crm_company_id: "route.params.company_id",
    },
    slot_schema: [
      {
        id: "crm_company_id",
        label: "Customer",
        type: "entity_picker",
        required: true,
        entity_table: "qrm_companies",
        entity_search_column: "name",
        helper_text: "Type to search a company. Iron pre-fills from the page you're on.",
        merge_strategy: "auto_if_unrelated",
      },
      {
        id: "line_items",
        label: "Parts",
        type: "line_items",
        required: true,
        helper_text: "Add part numbers, quantities, and prices. Voice: 'add part 4521, two of them, twenty bucks each'.",
      },
      {
        id: "order_source",
        label: "Source",
        type: "choice",
        required: false,
        default_value: "counter",
        choices: [
          { value: "counter", label: "Counter" },
          { value: "phone", label: "Phone" },
          { value: "online", label: "Online" },
          { value: "transfer", label: "Branch transfer" },
        ],
      },
      {
        id: "notes",
        label: "Notes",
        type: "longtext",
        required: false,
        placeholder: "Any context the parts team should see",
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

/* ─── 2. iron.add_customer ──────────────────────────────────────────────── */

export const ironAddCustomer: FlowWorkflowDefinition = {
  ...SHARED,
  slug: "iron.add_customer",
  name: "Iron · Add a customer",
  description: "Add a new CRM contact and optionally link to a company.",
  trigger_event_pattern: "iron.intent.add_customer",
  affects_modules: ["qrm"],
  undo_handler: "iron_add_customer",
  feature_flag: "iron.flow.add_customer",
  roles_allowed: ["rep", "admin", "manager", "owner"],
  actions: [{ action_key: "iron_add_customer", params: {} }],
  iron_metadata: {
    iron_role: "iron_advisor",
    short_label: "Add customer",
    voice_intent_keywords: ["add customer", "new customer", "create contact", "add contact"],
    voice_open_prompt: "What's the customer's first name?",
    voice_review_prompt: "Adding ${first_name} ${last_name}${company_suffix}. Sound good?",
    action_key: "iron_add_customer",
    slot_schema: [
      { id: "first_name", label: "First name", type: "text", required: true },
      { id: "last_name", label: "Last name", type: "text", required: true },
      { id: "email", label: "Email", type: "text", required: false },
      { id: "phone", label: "Phone", type: "text", required: false },
      { id: "title", label: "Title", type: "text", required: false },
      {
        id: "company_id",
        label: "Company (optional)",
        type: "entity_picker",
        required: false,
        entity_table: "qrm_companies",
        entity_search_column: "name",
      },
      { id: "review", label: "Review", type: "review", required: true },
    ],
  },
};

/* ─── 3. iron.add_equipment ─────────────────────────────────────────────── */

export const ironAddEquipment: FlowWorkflowDefinition = {
  ...SHARED,
  slug: "iron.add_equipment",
  name: "Iron · Add equipment",
  description: "Add a new equipment record (make/model/year/serial) to the CRM.",
  trigger_event_pattern: "iron.intent.add_equipment",
  affects_modules: ["qrm"],
  undo_handler: "iron_add_equipment",
  feature_flag: "iron.flow.add_equipment",
  roles_allowed: ["rep", "admin", "manager", "owner"],
  actions: [{ action_key: "iron_add_equipment", params: {} }],
  iron_metadata: {
    iron_role: "iron_advisor",
    short_label: "Add equipment",
    voice_intent_keywords: ["add equipment", "new equipment", "register machine", "log equipment"],
    voice_open_prompt: "What's the equipment make?",
    voice_review_prompt: "Adding ${year} ${make} ${model}${serial_suffix}. Sound right?",
    action_key: "iron_add_equipment",
    slot_schema: [
      { id: "make", label: "Make", type: "text", required: true },
      { id: "model", label: "Model", type: "text", required: true },
      { id: "year", label: "Year", type: "number", required: false },
      { id: "serial_number", label: "Serial number", type: "text", required: false },
      { id: "stock_number", label: "Stock number", type: "text", required: false },
      { id: "hours", label: "Hours", type: "number", required: false },
      {
        id: "condition",
        label: "Condition",
        type: "choice",
        required: false,
        choices: [
          { value: "new", label: "New" },
          { value: "used", label: "Used" },
          { value: "rental", label: "Rental" },
          { value: "demo", label: "Demo" },
        ],
      },
      {
        id: "company_id",
        label: "Owning company",
        type: "entity_picker",
        required: false,
        entity_table: "qrm_companies",
        entity_search_column: "name",
      },
      { id: "review", label: "Review", type: "review", required: true },
    ],
  },
};

/* ─── 4. iron.log_service_call ──────────────────────────────────────────── */

export const ironLogServiceCall: FlowWorkflowDefinition = {
  ...SHARED,
  slug: "iron.log_service_call",
  name: "Iron · Log a service call",
  description: "Open a service job from a field call (intake status).",
  trigger_event_pattern: "iron.intent.log_service_call",
  affects_modules: ["service"],
  undo_handler: "iron_log_service_call",
  feature_flag: "iron.flow.log_service_call",
  roles_allowed: ["rep", "admin", "manager", "owner"],
  actions: [{ action_key: "iron_log_service_call", params: {} }],
  iron_metadata: {
    iron_role: "iron_advisor",
    short_label: "Log service call",
    voice_intent_keywords: ["log service", "service call", "create service job", "open ticket"],
    voice_open_prompt: "Which customer is this for?",
    voice_review_prompt: "Opening a ${priority} priority service job for ${customer_name}. Confirm?",
    action_key: "iron_log_service_call",
    slot_schema: [
      {
        id: "customer_id",
        label: "Customer",
        type: "entity_picker",
        required: true,
        entity_table: "qrm_contacts",
        entity_search_column: "last_name",
      },
      {
        id: "equipment_id",
        label: "Equipment",
        type: "entity_picker",
        required: false,
        entity_table: "qrm_equipment",
        entity_search_column: "stock_number",
      },
      {
        id: "description",
        label: "What's wrong?",
        type: "longtext",
        required: true,
        placeholder: "Describe the issue in the customer's own words",
      },
      {
        id: "priority",
        label: "Priority",
        type: "choice",
        required: false,
        default_value: "normal",
        choices: [
          { value: "low", label: "Low" },
          { value: "normal", label: "Normal" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" },
        ],
      },
      { id: "review", label: "Review", type: "review", required: true },
    ],
  },
};

/* ─── 5. iron.draft_email ───────────────────────────────────────────────── */

export const ironDraftEmail: FlowWorkflowDefinition = {
  ...SHARED,
  slug: "iron.draft_email",
  name: "Iron · Draft a follow-up email",
  description: "Draft an email for a customer awaiting operator review. Never sent automatically.",
  trigger_event_pattern: "iron.intent.draft_email",
  affects_modules: ["communications", "qrm"],
  undo_handler: "iron_draft_email",
  feature_flag: "iron.flow.draft_email",
  roles_allowed: ["rep", "admin", "manager", "owner"],
  actions: [{ action_key: "iron_draft_email", params: {} }],
  iron_metadata: {
    iron_role: "iron_advisor",
    short_label: "Draft email",
    voice_intent_keywords: ["draft email", "follow up", "send email", "compose email", "write email"],
    voice_open_prompt: "Who's the email for?",
    voice_review_prompt: "Drafting an email to ${to_email} subject ${subject_short}. Save as draft?",
    action_key: "iron_draft_email",
    slot_schema: [
      { id: "to_email", label: "To", type: "text", required: true },
      { id: "subject", label: "Subject", type: "text", required: true },
      { id: "body", label: "Body", type: "longtext", required: true, placeholder: "Iron can draft this if you give it a few words" },
      { id: "review", label: "Review", type: "review", required: true },
    ],
  },
};

/* ─── 6. iron.initiate_rental_return ────────────────────────────────────── */

export const ironInitiateRentalReturn: FlowWorkflowDefinition = {
  ...SHARED,
  slug: "iron.initiate_rental_return",
  name: "Iron · Start a rental return",
  description: "Open a rental_returns inspection record. Inspector + condition photos handled in the existing return UI afterwards.",
  trigger_event_pattern: "iron.intent.initiate_rental_return",
  affects_modules: ["rental"],
  owner_role: "rental",
  undo_handler: "iron_initiate_rental_return",
  feature_flag: "iron.flow.initiate_rental_return",
  roles_allowed: ["rep", "admin", "manager", "owner"],
  actions: [{ action_key: "iron_initiate_rental_return", params: {} }],
  iron_metadata: {
    iron_role: "iron_advisor",
    short_label: "Start return",
    voice_intent_keywords: ["return rental", "rental return", "start return", "inspect return"],
    voice_open_prompt: "Which equipment is coming back?",
    voice_review_prompt: "Opening a return inspection for ${equipment_label}. Confirm?",
    action_key: "iron_initiate_rental_return",
    slot_schema: [
      {
        id: "equipment_id",
        label: "Equipment",
        type: "entity_picker",
        required: true,
        entity_table: "qrm_equipment",
        entity_search_column: "stock_number",
      },
      {
        id: "inspector_id",
        label: "Inspector (you)",
        type: "entity_picker",
        required: false,
        entity_table: "profiles",
        entity_search_column: "full_name",
      },
      { id: "review", label: "Review", type: "review", required: true },
    ],
  },
};

/* ─── Manifest: imported by flow-runner ─────────────────────────────────── */

export const IRON_FLOW_DEFINITIONS: FlowWorkflowDefinition[] = [
  ironPullPart,
  ironAddCustomer,
  ironAddEquipment,
  ironLogServiceCall,
  ironDraftEmail,
  ironInitiateRentalReturn,
];
