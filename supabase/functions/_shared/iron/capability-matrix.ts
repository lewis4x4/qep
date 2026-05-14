import { IRON_TOOL_DEFINITIONS } from "./tools.ts";
import { ASK_IRON_TOOLS } from "../qrm-ask-iron.ts";

export type IronSurface = "qrm_ask_iron" | "iron_global";
export type CoverageStatus = "supported" | "partial" | "known_gap";
export type IronCapabilityDomain =
  | "quote"
  | "customer"
  | "deal"
  | "parts"
  | "service"
  | "rental"
  | "sop"
  | "equipment"
  | "finance"
  | "approval"
  | "integration"
  | "trade_in"
  | "follow_up";
export type IronIntentKind = "answer" | "intake" | "action" | "route";

export interface IronCapability {
  id: string;
  surface: IronSurface;
  domain: IronCapabilityDomain;
  intent_kind: IronIntentKind;
  question: string;
  expected_tool: string;
  status: CoverageStatus;
  reason: string;
  /** Operator-facing next step Iron should give instead of dead-ending. */
  user_next_step: string;
  owner?: string;
  risk?: "low" | "medium" | "high";
  next_tool_guidance?: string;
}

export interface IronOwnerGauntletCase {
  id: string;
  phrase: string;
  domain: IronCapabilityDomain;
  expected_outcome: "answer" | "ask_missing_question" | "open_flow" | "route_with_context" | "explain_gap_with_next_step";
}

export const IRON_NO_DEAD_END_CONTRACT = [
  "Answer with tools or evidence when the capability is supported.",
  "Ask exactly one focused missing-question when required fields are absent.",
  "Open or name the correct flow/page when the task is an action Iron cannot perform in the read-only agent.",
  "If the data source or tool is missing, state that connection gap plainly and give the operator's next best step.",
  "Never reply with only 'I can't', a raw Edge Function error, or a generic rephrase request.",
] as const;

export const IRON_CAPABILITY_MATRIX: IronCapability[] = [
  {
    id: "qrm-quote-pending-approval",
    surface: "qrm_ask_iron",
    domain: "quote",
    intent_kind: "answer",
    question: "Are there any quotes pending approval?",
    expected_tool: "lookup_quote",
    status: "supported",
    reason: "lookup_quote accepts status-only filters and pending approval aliases.",
    user_next_step: "Return the matching pending-approval quotes and tell the operator which quote/customer needs attention next.",
  },
  {
    id: "global-quote-pending-approval",
    surface: "iron_global",
    domain: "quote",
    intent_kind: "answer",
    question: "Are there any quotes pending approval?",
    expected_tool: "lookup_quote",
    status: "supported",
    reason: "Global lookup_quote supports natural-language status aliases.",
    user_next_step: "Return the matching pending-approval quotes and tell the operator which quote/customer needs attention next.",
  },
  {
    id: "global-quote-structured-intake",
    surface: "iron_global",
    domain: "quote",
    intent_kind: "intake",
    question: "I need to quote this piece of equipment for this customer and he wants these options in this timeframe.",
    expected_tool: "quote_intake_client",
    status: "supported",
    reason: "IronBar handles quote creation phrases with structured customer/equipment/options/timeframe intake before Quote Builder handoff.",
    user_next_step: "Ask for missing quote fields, then open Quote Builder with structured starter equipment/options lines.",
  },
  {
    id: "qrm-equipment-search",
    surface: "qrm_ask_iron",
    domain: "equipment",
    intent_kind: "answer",
    question: "Find CAT 320 equipment in my workspace.",
    expected_tool: "search_entities",
    status: "supported",
    reason: "QRM search_entities resolves explicit equipment searches against crm_equipment with workspace + soft-delete scope.",
    user_next_step: "Return the matching equipment rows and offer to narrow by status, branch, or customer.",
  },
  {
    id: "global-equipment-search",
    surface: "iron_global",
    domain: "equipment",
    intent_kind: "answer",
    question: "Show available skid steers.",
    expected_tool: "search_equipment",
    status: "supported",
    reason: "Global search_equipment can filter inventory by make/model/category/availability.",
    user_next_step: "Return available machines with make, model, value/rate, and location; ask one narrowing question if results are broad.",
  },
  {
    id: "qrm-rental-search",
    surface: "qrm_ask_iron",
    domain: "rental",
    intent_kind: "answer",
    question: "Find active rental requests for skid steer.",
    expected_tool: "search_entities",
    status: "supported",
    reason: "QRM search_entities resolves explicit rental searches against rental_contracts by requested machine metadata.",
    user_next_step: "Return matching rental rows and offer the next operational step such as schedule, pickup, or customer follow-up.",
  },
  {
    id: "global-parts-low-stock",
    surface: "iron_global",
    domain: "parts",
    intent_kind: "answer",
    question: "Which parts are low stock this week?",
    expected_tool: "list_low_stock_parts",
    status: "supported",
    reason: "Global Iron has a dedicated low-stock parts inventory tool.",
    user_next_step: "List low-stock parts with quantities and branches, then recommend reorder review.",
  },
  {
    id: "qrm-parts-gap",
    surface: "qrm_ask_iron",
    domain: "parts",
    intent_kind: "route",
    question: "Which parts are low stock this week?",
    expected_tool: "list_low_stock_parts",
    status: "known_gap",
    reason: "QRM Ask-Iron catalog is CRM/rental focused and has no parts inventory tool.",
    user_next_step: "Route the operator to global Iron/parts command and say the QRM panel is not connected to parts inventory yet.",
    owner: "qrm-platform",
    risk: "high",
    next_tool_guidance: "Add read-only parts tool or route to global Iron with explicit handoff.",
  },
  {
    id: "global-service-urgent-jobs",
    surface: "iron_global",
    domain: "service",
    intent_kind: "answer",
    question: "What service jobs are urgent today?",
    expected_tool: "list_service_jobs",
    status: "supported",
    reason: "Global Iron can list service jobs by priority, open status, and recency.",
    user_next_step: "Return urgent/open service jobs and name the first job that needs dispatch attention.",
  },
  {
    id: "qrm-service-gap",
    surface: "qrm_ask_iron",
    domain: "service",
    intent_kind: "route",
    question: "What service jobs are urgent today?",
    expected_tool: "list_service_jobs",
    status: "known_gap",
    reason: "QRM Ask-Iron lacks service-job listing tool coverage.",
    user_next_step: "Route the operator to global Iron/service command and say the QRM panel is not connected to service-job listing yet.",
    owner: "service-ai",
    risk: "high",
    next_tool_guidance: "Add service list/summary tool on QRM surface or federated relay.",
  },
  {
    id: "global-sop-search",
    surface: "iron_global",
    domain: "sop",
    intent_kind: "answer",
    question: "What does our SOP say about rental extensions?",
    expected_tool: "semantic_kb_search",
    status: "supported",
    reason: "Global Iron has semantic KB retrieval for SOP/manual/process questions.",
    user_next_step: "Answer from SOP evidence with citations; if evidence is thin, say what document/source is missing.",
  },
  {
    id: "qrm-docs-gap",
    surface: "qrm_ask_iron",
    domain: "sop",
    intent_kind: "route",
    question: "What does our SOP say about rental extensions?",
    expected_tool: "semantic_kb_search",
    status: "known_gap",
    reason: "QRM Ask-Iron has no KB/document retrieval tool.",
    user_next_step: "Route the operator to global Iron/SOP search and say the QRM panel is not connected to SOP retrieval yet.",
    owner: "knowledge-ai",
    risk: "medium",
    next_tool_guidance: "Add scoped semantic KB tool or route docs questions to global Iron.",
  },
  {
    id: "qrm-finance-gap",
    surface: "qrm_ask_iron",
    domain: "finance",
    intent_kind: "answer",
    question: "Show financing payment issues across quotes.",
    expected_tool: "lookup_quote",
    status: "partial",
    reason: "Quote financing fields exist, but no explicit payment/collections tools.",
    user_next_step: "Show quote financing fields that are available, then explain that payment/collections lifecycle is not connected yet.",
  },
  {
    id: "global-signature-approval-payment-gap",
    surface: "iron_global",
    domain: "approval",
    intent_kind: "answer",
    question: "Which quotes are waiting on signature or payment approval?",
    expected_tool: "lookup_quote",
    status: "partial",
    reason: "lookup_quote covers quote status but not signature workflow/payment state lifecycle.",
    user_next_step: "Show quote status results that are available, then state that signature/payment state needs its workflow source connected.",
  },
  {
    id: "global-rental-contracts-gap",
    surface: "iron_global",
    domain: "rental",
    intent_kind: "answer",
    question: "Show my rental contracts that are awaiting pickup.",
    expected_tool: "search_platform",
    status: "known_gap",
    reason: "Global toolset has equipment and service coverage but no dedicated rental contracts tool.",
    user_next_step: "Search related platform entities if possible, then say rental contract status needs a dedicated connection before Iron can produce a complete queue.",
    owner: "rentals-platform",
    risk: "high",
    next_tool_guidance: "Add rental contracts list/detail tool with status/date filters.",
  },
  {
    id: "global-demo-tradein-gap",
    surface: "iron_global",
    domain: "trade_in",
    intent_kind: "answer",
    question: "What demos and trade-ins are pending this month?",
    expected_tool: "search_platform",
    status: "known_gap",
    reason: "No dedicated demo/trade-in tool family in global catalog.",
    user_next_step: "Search related platform records if possible, then say demo/trade-in workflow status needs a dedicated connection.",
    owner: "sales-ops",
    risk: "medium",
    next_tool_guidance: "Add demo and trade-in tools or extend search_platform sources.",
  },
  {
    id: "global-integrations-gap",
    surface: "iron_global",
    domain: "integration",
    intent_kind: "answer",
    question: "Which integrations are disconnected right now?",
    expected_tool: "search_platform",
    status: "known_gap",
    reason: "Global catalog lacks integration health/status tools.",
    user_next_step: "Say integration health is not connected to Iron yet and direct the operator to the Integration Hub until the health tool exists.",
    owner: "platform-integrations",
    risk: "medium",
    next_tool_guidance: "Expose integration availability/readiness tool in global surface.",
  },
  {
    id: "global-follow-up-intake-gap",
    surface: "iron_global",
    domain: "follow_up",
    intent_kind: "action",
    question: "Schedule a follow-up with Big Oak next Tuesday.",
    expected_tool: "iron_flow_follow_up",
    status: "known_gap",
    reason: "Follow-up scheduling needs a first-class Iron flow or action tool with confirmation and undo.",
    user_next_step: "Ask for missing customer/date/details, then route to the follow-up UI until the write flow exists.",
    owner: "crm-platform",
    risk: "high",
    next_tool_guidance: "Add a safe follow-up scheduling flow backed by crm_reminders/tasks with idempotency and undo.",
  },
];

export const IRON_OWNER_GAUNTLET: IronOwnerGauntletCase[] = [
  {
    id: "owner-start-quote-messy",
    phrase: "I need to quote this piece of equipment for Big Oak, he wants a mulcher and needs it next week.",
    domain: "quote",
    expected_outcome: "ask_missing_question",
  },
  {
    id: "owner-pending-approval",
    phrase: "Are there any quotes pending approval?",
    domain: "quote",
    expected_outcome: "answer",
  },
  {
    id: "owner-low-stock",
    phrase: "Which parts are low stock this week?",
    domain: "parts",
    expected_outcome: "answer",
  },
  {
    id: "owner-service-urgent",
    phrase: "What service jobs are urgent today?",
    domain: "service",
    expected_outcome: "answer",
  },
  {
    id: "owner-sop-rental-extension",
    phrase: "What does our SOP say about rental extensions?",
    domain: "sop",
    expected_outcome: "answer",
  },
  {
    id: "owner-rental-pickup-gap",
    phrase: "Show my rental contracts awaiting pickup.",
    domain: "rental",
    expected_outcome: "explain_gap_with_next_step",
  },
  {
    id: "owner-follow-up-gap",
    phrase: "Schedule a follow-up with Big Oak next Tuesday.",
    domain: "follow_up",
    expected_outcome: "route_with_context",
  },
];

export const IRON_TOOLS_BY_SURFACE: Record<IronSurface, readonly string[]> = {
  qrm_ask_iron: ASK_IRON_TOOLS.map((tool) => tool.name),
  iron_global: [
    ...IRON_TOOL_DEFINITIONS.map((tool) => tool.name),
    // Client/flow capabilities are declared in the matrix so the owner
    // gauntlet can track them alongside server tools.
    "quote_intake_client",
    "iron_flow_follow_up",
  ],
};

export function getIronCapabilities(surface?: IronSurface): IronCapability[] {
  return surface ? IRON_CAPABILITY_MATRIX.filter((item) => item.surface === surface) : [...IRON_CAPABILITY_MATRIX];
}

export function getIronKnownGaps(surface?: IronSurface): IronCapability[] {
  return getIronCapabilities(surface).filter((item) => item.status === "known_gap");
}

export function buildIronCapabilityGuidance(surface: IronSurface): string {
  const capabilities = getIronCapabilities(surface);
  const supported = capabilities.filter((item) => item.status === "supported");
  const partial = capabilities.filter((item) => item.status === "partial");
  const gaps = capabilities.filter((item) => item.status === "known_gap");

  const lines = [
    "## Iron no-dead-end contract",
    ...IRON_NO_DEAD_END_CONTRACT.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    "## Capability outcomes for this surface",
    ...supported.map((item) => `- Supported ${item.domain}: ${item.question} → use ${item.expected_tool}; next step: ${item.user_next_step}`),
    ...partial.map((item) => `- Partial ${item.domain}: ${item.question} → use ${item.expected_tool} for available data; limitation: ${item.reason}; next step: ${item.user_next_step}`),
    ...gaps.map((item) => `- Known gap ${item.domain}: ${item.question} → do not pretend it is connected; next step: ${item.user_next_step}`),
  ];

  return lines.join("\n");
}
