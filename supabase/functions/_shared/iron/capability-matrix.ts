import { IRON_TOOL_DEFINITIONS } from "./tools.ts";
import { ASK_IRON_TOOLS } from "../qrm-ask-iron.ts";

export type IronSurface = "qrm_ask_iron" | "iron_global";
export type CoverageStatus = "supported" | "partial" | "known_gap";

export interface IronCapability {
  id: string;
  surface: IronSurface;
  question: string;
  expected_tool: string;
  status: CoverageStatus;
  reason: string;
  owner?: string;
  risk?: "low" | "medium" | "high";
  next_tool_guidance?: string;
}

export const IRON_CAPABILITY_MATRIX: IronCapability[] = [
  {
    id: "qrm-quote-pending-approval",
    surface: "qrm_ask_iron",
    question: "Are there any quotes pending approval?",
    expected_tool: "lookup_quote",
    status: "supported",
    reason: "lookup_quote accepts status-only filters and pending approval aliases.",
  },
  {
    id: "global-quote-pending-approval",
    surface: "iron_global",
    question: "Are there any quotes pending approval?",
    expected_tool: "lookup_quote",
    status: "supported",
    reason: "Global lookup_quote supports natural-language status aliases.",
  },
  {
    id: "qrm-equipment-search",
    surface: "qrm_ask_iron",
    question: "Find CAT 320 equipment in my workspace.",
    expected_tool: "search_entities",
    status: "supported",
    reason: "QRM search_entities resolves explicit equipment searches against crm_equipment with workspace + soft-delete scope."
  },
  {
    id: "qrm-rental-search",
    surface: "qrm_ask_iron",
    question: "Find active rental requests for skid steer.",
    expected_tool: "search_entities",
    status: "supported",
    reason: "QRM search_entities resolves explicit rental searches against rental_contracts by requested machine metadata."
  },
  {
    id: "qrm-parts-gap",
    surface: "qrm_ask_iron",
    question: "Which parts are low stock this week?",
    expected_tool: "list_low_stock_parts",
    status: "known_gap",
    reason: "QRM Ask-Iron catalog is CRM/rental focused and has no parts inventory tool.",
    owner: "qrm-platform",
    risk: "high",
    next_tool_guidance: "Add read-only parts tool or route to global Iron with explicit handoff.",
  },
  {
    id: "qrm-service-gap",
    surface: "qrm_ask_iron",
    question: "What service jobs are urgent today?",
    expected_tool: "list_service_jobs",
    status: "known_gap",
    reason: "QRM Ask-Iron lacks service-job listing tool coverage.",
    owner: "service-ai",
    risk: "high",
    next_tool_guidance: "Add service list/summary tool on QRM surface or federated relay.",
  },
  {
    id: "qrm-finance-gap",
    surface: "qrm_ask_iron",
    question: "Show financing payment issues across quotes.",
    expected_tool: "lookup_quote",
    status: "partial",
    reason: "Quote financing fields exist, but no explicit payment/collections tools.",
  },
  {
    id: "qrm-docs-gap",
    surface: "qrm_ask_iron",
    question: "What does our SOP say about rental extensions?",
    expected_tool: "semantic_kb_search",
    status: "known_gap",
    reason: "QRM Ask-Iron has no KB/document retrieval tool.",
    owner: "knowledge-ai",
    risk: "medium",
    next_tool_guidance: "Add scoped semantic KB tool or route docs questions to global Iron.",
  },
  {
    id: "global-rental-contracts-gap",
    surface: "iron_global",
    question: "Show my rental contracts that are awaiting pickup.",
    expected_tool: "search_platform",
    status: "known_gap",
    reason: "Global toolset has equipment and service coverage but no dedicated rental contracts tool.",
    owner: "rentals-platform",
    risk: "high",
    next_tool_guidance: "Add rental contracts list/detail tool with status/date filters.",
  },
  {
    id: "global-signature-approval-payment-gap",
    surface: "iron_global",
    question: "Which quotes are waiting on signature or payment approval?",
    expected_tool: "lookup_quote",
    status: "partial",
    reason: "lookup_quote covers quote status but not signature workflow/payment state lifecycle.",
  },
  {
    id: "global-demo-tradein-gap",
    surface: "iron_global",
    question: "What demos and trade-ins are pending this month?",
    expected_tool: "search_platform",
    status: "known_gap",
    reason: "No dedicated demo/trade-in tool family in global catalog.",
    owner: "sales-ops",
    risk: "medium",
    next_tool_guidance: "Add demo and trade-in tools or extend search_platform sources.",
  },
  {
    id: "global-integrations-gap",
    surface: "iron_global",
    question: "Which integrations are disconnected right now?",
    expected_tool: "search_platform",
    status: "known_gap",
    reason: "Global catalog lacks integration health/status tools.",
    owner: "platform-integrations",
    risk: "medium",
    next_tool_guidance: "Expose integration availability/readiness tool in global surface.",
  },
];

export const IRON_TOOLS_BY_SURFACE: Record<IronSurface, readonly string[]> = {
  qrm_ask_iron: ASK_IRON_TOOLS.map((tool) => tool.name),
  iron_global: IRON_TOOL_DEFINITIONS.map((tool) => tool.name),
};
