import type { IronRole } from "@/features/qrm/lib/iron-roles";
import type { FloorLayout } from "./layout-types";

export const DEFAULT_FLOOR_LAYOUTS: Record<IronRole, FloorLayout> = {
  iron_owner: {
    widgets: [
      { id: "exec.owner-brief", order: 0 },
      { id: "nervous.customer-health", order: 1 },
      { id: "iron.approval-queue", order: 2 },
      { id: "iron.inventory-aging", order: 3 },
      { id: "exec.revenue-pace", order: 4 },
      { id: "exec.deal-velocity", order: 5 },
    ],
    quickActions: [
      { id: "ask_iron", label: "ASK IRON", route: "/iron", icon: "sparkles" },
      { id: "open_pipeline", label: "OPEN PIPELINE", route: "/qrm", icon: "activity" },
      { id: "monthly_report", label: "MONTHLY REPORT", route: "/admin/deal-economics", icon: "trending" },
    ],
    showNarrative: true,
  },
  iron_manager: {
    widgets: [
      { id: "exec.morning-brief", order: 0 },
      { id: "iron.approval-queue", order: 1 },
      { id: "iron.pipeline-by-rep", order: 2 },
      { id: "sales.commission-to-date", order: 3 },
      { id: "iron.inventory-aging", order: 4 },
      { id: "crm.customer-search", order: 5 },
    ],
    quickActions: [
      { id: "open_approvals", label: "OPEN APPROVALS", route: "/qrm/approvals", icon: "approve" },
      { id: "new_quote", label: "NEW QUOTE", route: "/quote-v2", icon: "quote" },
      { id: "search_customer", label: "SEARCH CUSTOMER", route: "/qrm/companies", icon: "search" },
    ],
    showNarrative: true,
  },
  iron_advisor: {
    widgets: [
      { id: "sales.ai-briefing", order: 0 },
      { id: "qrm.follow-up-queue", order: 1 },
      { id: "sales.action-items", order: 2 },
      { id: "sales.commission-to-date", order: 3 },
      { id: "quote.deal-copilot-summary", order: 4 },
      { id: "crm.customer-search", order: 5 },
    ],
    quickActions: [
      { id: "new_quote", label: "NEW QUOTE", route: "/quote-v2", icon: "quote" },
      { id: "voice_capture", label: "VOICE", route: "/voice", icon: "voice" },
      { id: "log_visit", label: "LOG VISIT", route: "/qrm/visits/new", icon: "visit" },
    ],
    showNarrative: true,
  },
  iron_woman: {
    widgets: [
      { id: "iron.order-processing", order: 0 },
      { id: "iron.deposit-tracker", order: 1 },
      { id: "iron.credit-applications", order: 2 },
      { id: "iron.intake-progress", order: 3 },
      { id: "iron-woman.pending-invoices", order: 4 },
      { id: "crm.customer-search", order: 5 },
    ],
    quickActions: [
      { id: "new_credit_app", label: "CREDIT APP", route: "/credit/new", icon: "credit" },
      { id: "deposit_entry", label: "DEPOSIT", route: "/deposits/new", icon: "money" },
      { id: "search_customer", label: "SEARCH CUSTOMER", route: "/qrm/companies", icon: "search" },
    ],
    showNarrative: true,
  },
  iron_man: {
    widgets: [
      { id: "iron.prep-queue", order: 0 },
      { id: "iron.pdi-checklists", order: 1 },
      { id: "iron.demo-schedule", order: 2 },
      { id: "iron-man.open-service-tickets", order: 3 },
      { id: "service.parts-hub-strip", order: 4 },
      { id: "iron.return-inspections", order: 5 },
    ],
    quickActions: [
      { id: "next_job", label: "NEXT JOB", route: "/service/wip", icon: "wrench" },
      { id: "pdi_checklist", label: "PDI CHECKLIST", route: "/service/inspections", icon: "check" },
      { id: "parts_pickup", label: "PARTS PICKUP", route: "/parts/orders?status=ready", icon: "parts" },
    ],
    showNarrative: true,
  },
  iron_parts_counter: {
    widgets: [
      { id: "parts.serial-first", order: 0 },
      { id: "parts.quote-drafts", order: 1 },
      { id: "parts.order-status", order: 2 },
      { id: "parts.customer-intel", order: 3 },
      { id: "parts.replenish-queue", order: 4 },
      { id: "crm.customer-search", order: 5 },
    ],
    quickActions: [
      { id: "new_parts_quote", label: "NEW PARTS QUOTE", route: "/parts/orders/new", icon: "parts" },
      { id: "lookup_serial", label: "LOOKUP SERIAL", route: "/parts/companion/lookup", icon: "search" },
      { id: "open_drafts", label: "OPEN DRAFTS", route: "/parts/orders?status=draft", icon: "drafts" },
    ],
    showNarrative: true,
  },
  iron_parts_manager: {
    widgets: [
      { id: "parts.demand-forecast", order: 0 },
      { id: "parts.inventory-health", order: 1 },
      { id: "parts.replenish-queue", order: 2 },
      { id: "parts.order-status", order: 3 },
      { id: "parts.lost-sales", order: 4 },
      { id: "parts.supplier-health", order: 5 },
    ],
    quickActions: [
      { id: "review_replen", label: "REVIEW REPLEN", route: "/parts/companion/replenish", icon: "parts" },
      { id: "inventory_health", label: "INVENTORY", route: "/parts/inventory", icon: "box" },
      { id: "supplier_status", label: "SUPPLIER STATUS", route: "/parts/companion/suppliers", icon: "activity" },
    ],
    showNarrative: true,
  },
};
